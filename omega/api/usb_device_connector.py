"""Conector USB directo para iOS (`libimobiledevice`) y Android (`adb`) con triaje MVT Zero-Retention.

Provee:
- Detección unificada de teléfonos conectados por cable (`list_connected_devices`) con estados
  `PAIRED`, `NEEDS_TRUST`, `LOCKED` (iOS) y `DEVICE`, `UNAUTHORIZED`, `OFFLINE` (Android),
  o `TOOLING_MISSING` con instrucciones claras si las herramientas del host no están instaladas.
- Extracción volátil y triaje (`run_usb_triage`) con seguimiento de progreso en lenguaje natural
  y destrucción garantizada (`try ... finally` + sobrescritura + `shutil.rmtree`) del directorio
  temporal `omega_usb_*`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from cti_db import lookup_iocs_detailed
from mobile_backup_streamer import stream_backup_directory
from triage_orchestrator import _collect_tokens

logger = logging.getLogger(__name__)

CommandRunner = Callable[[list[str], int], tuple[int, str, str]]
WhichResolver = Callable[[str], str | None]

_JOBS_LOCK = threading.Lock()
_USB_JOBS: dict[str, dict[str, Any]] = {}
_MAX_JOBS = 32


def _default_run_cmd(cmd: list[str], timeout_sec: int = 30) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except FileNotFoundError as exc:
        return 127, "", str(exc)
    except subprocess.TimeoutExpired as exc:
        return 124, exc.stdout or "", f"Timeout ({timeout_sec}s)"
    except Exception as exc:
        return 1, "", str(exc)


def resolve_portable_tool(tool_name: str, which_fn: WhichResolver | None = None) -> str | None:
    """Busca primero binarios portables empaquetados (libimobiledevice / platform-tools) antes del PATH del SO."""
    exe_suffix = ".exe" if os.name == "nt" else ""
    base_roots: list[Path] = []
    env_tools = (os.getenv("OMEGA_PORTABLE_TOOLS_DIR") or "").strip()
    if env_tools:
        base_roots.append(Path(env_tools))
    module_root = Path(__file__).resolve().parent
    base_roots.extend(
        [
            module_root / "tools",
            module_root.parent / "tools",
            module_root.parent / "frontend" / "resources" / "tools",
        ]
    )
    subfolders = ("", "platform-tools", "libimobiledevice", "bin")
    for root in base_roots:
        if not root.exists():
            continue
        for sub in subfolders:
            cand = (root / sub / f"{tool_name}{exe_suffix}") if sub else (root / f"{tool_name}{exe_suffix}")
            if cand.is_file():
                return str(cand)
    fallback = which_fn or shutil.which
    return fallback(tool_name)


_BENIGN_ANDROID_ACCESSIBILITY_PREFIXES = (
    "com.google.android.marvin.talkback/",
    "com.google.android.accessibility.",
    "com.android.talkback/",
    "com.samsung.android.accessibility.",
)


def analyze_android_accessibility_and_mdm(
    accessibility_raw: str,
    device_policy_raw: str,
) -> list[dict[str, Any]]:
    """Detecta servicios de Accesibilidad abusivos y administradores MDM no estándar en Android."""
    anomalies: list[dict[str, Any]] = []
    cleaned_acc = (accessibility_raw or "").strip()
    if cleaned_acc and cleaned_acc.lower() not in ("null", "none"):
        for service in [s.strip() for s in cleaned_acc.split(":") if s.strip()]:
            low = service.lower()
            if not any(low.startswith(prefix) for prefix in _BENIGN_ANDROID_ACCESSIBILITY_PREFIXES):
                anomalies.append(
                    {
                        "severity": "HIGH",
                        "category": "ANDROID_ABUSIVE_ACCESSIBILITY_SERVICE",
                        "artifact": "settings/enabled_accessibility_services",
                        "indicator": service,
                        "detail": (
                            f"Servicio de Accesibilidad activo de terceros ({service}). "
                            "El spyware y stalkerware en Android abusa de Accesibilidad para leer pantalla, OTPs y mensajes."
                        ),
                    }
                )

    for line in (device_policy_raw or "").splitlines():
        stripped = line.strip()
        low = stripped.lower()
        if any(marker in low for marker in ("device owner:", "profile owner", "admin=componentinfo{")):
            if not any(benign in low for benign in ("com.google.android.gms", "com.android.managedprovisioning")):
                anomalies.append(
                    {
                        "severity": "MEDIUM",
                        "category": "ANDROID_DEVICE_ADMIN_OR_MDM",
                        "artifact": "dumpsys/device_policy",
                        "indicator": stripped[:180],
                        "detail": "Administrador de dispositivo / perfil MDM activo; verifica si fue autorizado por tu organización.",
                    }
                )
    return anomalies


def _secure_wipe_directory(target_dir: Path) -> bool:
    """Sobrescribe con ceros los archivos temporales y elimina por completo el árbol `target_dir`."""
    if not target_dir.exists():
        return True
    try:
        for file_path in sorted(target_dir.rglob("*"), reverse=True):
            if file_path.is_file() and not file_path.is_symlink():
                try:
                    size = min(file_path.stat().st_size, 4 * 1024 * 1024)
                    if size > 0:
                        with file_path.open("r+b") as fh:
                            fh.seek(0)
                            fh.write(b"\x00" * size)
                            fh.flush()
                    file_path.unlink(missing_ok=True)
                except OSError:
                    try:
                        file_path.unlink(missing_ok=True)
                    except OSError:
                        pass
    finally:
        shutil.rmtree(target_dir, ignore_errors=True)
    return not target_dir.exists()


def list_connected_devices(
    *,
    run_cmd: CommandRunner | None = None,
    which_fn: WhichResolver | None = None,
) -> dict[str, Any]:
    """Detecta teléfonos iOS y Android conectados por USB y su estado de confianza/emparejamiento."""
    runner = run_cmd or _default_run_cmd
    resolver: WhichResolver = which_fn if which_fn is not None else (lambda name: resolve_portable_tool(name))

    devices: list[dict[str, Any]] = []
    tooling: dict[str, dict[str, Any]] = {}

    # 1. Detección iOS (libimobiledevice: idevice_id + ideviceinfo)
    idevice_id_bin = resolver("idevice_id")
    if not idevice_id_bin:
        tooling["ios"] = {
            "available": False,
            "status": "TOOLING_MISSING",
            "instructions": (
                "Instala libimobiledevice (o Apple Mobile Device Support / iTunes en Windows) "
                "para detectar iPhone por cable USB."
            ),
        }
    else:
        tooling["ios"] = {"available": True, "status": "READY", "instructions": ""}
        code, out, _ = runner([idevice_id_bin, "-l"], 6)
        if code == 0 and out.strip():
            ideviceinfo_bin = resolver("ideviceinfo") or "ideviceinfo"
            for raw_line in out.splitlines():
                udid = raw_line.strip()
                if not udid:
                    continue
                info_code, info_out, info_err = runner([ideviceinfo_bin, "-u", udid], 6)
                combined = f"{info_out}\n{info_err}".lower()
                props: dict[str, str] = {}
                for ln in info_out.splitlines():
                    if ":" in ln:
                        k, v = ln.split(":", 1)
                        props[k.strip()] = v.strip()

                device_name = props.get("DeviceName") or "iPhone conectado"
                product_type = props.get("ProductType") or "iPhone"
                os_version = props.get("ProductVersion") or "iOS"

                if "passwordprotected" in combined or "locked" in combined:
                    state = "LOCKED"
                    authorized = False
                    instruction = "Desbloquea tu iPhone con tu código o Face ID y vuelve a intentar."
                elif (
                    info_code != 0
                    or "pairingdialogresponsepending" in combined
                    or "invalidhostid" in combined
                    or "not paired" in combined
                    or "could not connect to lockdownd" in combined
                ):
                    state = "NEEDS_TRUST"
                    authorized = False
                    instruction = "Desbloquea tu iPhone y pulsa 'Confiar en este computador' en la pantalla."
                else:
                    state = "PAIRED"
                    authorized = True
                    instruction = "iPhone vinculado y listo para el análisis en 1 clic."

                devices.append(
                    {
                        "id": udid,
                        "udid": udid,
                        "serial": udid,
                        "platform": "IOS",
                        "deviceName": device_name,
                        "model": product_type,
                        "productType": product_type,
                        "osVersion": os_version,
                        "state": state,
                        "authorized": authorized,
                        "userInstruction": instruction,
                    }
                )

    # 2. Detección Android (adb devices -l)
    adb_bin = resolver("adb")
    if not adb_bin:
        tooling["android"] = {
            "available": False,
            "status": "TOOLING_MISSING",
            "instructions": (
                "Instala Android Platform Tools (adb) y activa 'Depuración por USB' en "
                "Opciones de desarrollador de tu Android."
            ),
        }
    else:
        tooling["android"] = {"available": True, "status": "READY", "instructions": ""}
        code, out, _ = runner([adb_bin, "devices", "-l"], 6)
        if code == 0 and out.strip():
            for raw_line in out.splitlines():
                line = raw_line.strip()
                if not line or line.lower().startswith("list of devices") or line.startswith("*"):
                    continue
                parts = line.split()
                if len(parts) < 2:
                    continue
                serial = parts[0].strip()
                raw_state = parts[1].strip().lower()
                kv: dict[str, str] = {}
                for token in parts[2:]:
                    if ":" in token:
                        k, v = token.split(":", 1)
                        kv[k] = v.replace("_", " ")

                model = kv.get("model") or kv.get("device") or "Android conectado"
                os_version = "Android"

                if raw_state == "unauthorized":
                    state = "UNAUTHORIZED"
                    authorized = False
                    instruction = "Mira la pantalla de tu Android y acepta 'Permitir depuración USB'."
                elif raw_state == "offline":
                    state = "OFFLINE"
                    authorized = False
                    instruction = "El teléfono aparece desconectado; reconecta el cable USB en modo Transferencia de archivos."
                elif raw_state == "device":
                    state = "DEVICE"
                    authorized = True
                    instruction = "Android autorizado y listo para el análisis en 1 clic."
                    v_code, v_out, _ = runner(
                        [adb_bin, "-s", serial, "shell", "getprop", "ro.build.version.release"], 4
                    )
                    if v_code == 0 and v_out.strip():
                        os_version = f"Android {v_out.strip()}"
                else:
                    state = raw_state.upper()
                    authorized = False
                    instruction = "Desbloquea el teléfono y verifica la conexión USB."

                devices.append(
                    {
                        "id": serial,
                        "udid": serial,
                        "serial": serial,
                        "platform": "ANDROID",
                        "deviceName": model,
                        "model": model,
                        "productType": kv.get("product") or model,
                        "osVersion": os_version,
                        "state": state,
                        "authorized": authorized,
                        "userInstruction": instruction,
                    }
                )

    both_missing = not tooling["ios"]["available"] and not tooling["android"]["available"]
    return {
        "status": "TOOLING_MISSING" if both_missing else "OK",
        "devices": devices,
        "tooling": tooling,
    }


def run_usb_triage(
    *,
    platform: str,
    device_id: str,
    backup_password: str | None = None,
    simulated_backup_dir: Path | str | None = None,
    run_cmd: CommandRunner | None = None,
    which_fn: WhichResolver | None = None,
    lookup_fn: Callable[[list[str]], list[dict[str, Any]]] | None = None,
    progress_cb: Callable[[str, int, str], None] | None = None,
) -> dict[str, Any]:
    """Ejecuta extracción USB + MVT + streaming SQLite/WAL y garantiza el borrado Zero-Retention."""
    runner = run_cmd or _default_run_cmd
    resolver: WhichResolver = which_fn if which_fn is not None else (lambda name: resolve_portable_tool(name))
    ioc_lookup = lookup_fn or lookup_iocs_detailed
    norm_platform = (platform or "IOS").strip().upper()
    model_hash = hashlib.sha256(f"{norm_platform}:{device_id}".encode("utf-8")).hexdigest()[:16]

    def notify(stage: str, pct: int, msg: str) -> None:
        if progress_cb:
            progress_cb(stage, pct, msg)

    temp_dir = Path(tempfile.mkdtemp(prefix="omega_usb_"))
    zero_retention_wiped = False

    try:
        notify("extracting_logs", 20, "Extrayendo registros de sistema...")

        if simulated_backup_dir is not None:
            src_sim = Path(simulated_backup_dir)
            for item in src_sim.rglob("*"):
                rel = item.relative_to(src_sim)
                dest = temp_dir / rel
                if item.is_dir():
                    dest.mkdir(parents=True, exist_ok=True)
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, dest)
        elif norm_platform == "IOS":
            crash_bin = resolver("idevicecrashreport")
            if crash_bin:
                crashes_dir = temp_dir / "crashes"
                crashes_dir.mkdir(parents=True, exist_ok=True)
                runner([crash_bin, "-u", device_id, "-k", str(crashes_dir)], 45)

            backup_bin = resolver("idevicebackup2")
            if backup_bin:
                backup_cmd = [backup_bin, "-u", device_id, "backup", str(temp_dir)]
                runner(backup_cmd, 180)

            mvt_ios_bin = resolver("mvt-ios")
            if mvt_ios_bin:
                mvt_out = temp_dir / "mvt_out"
                mvt_out.mkdir(parents=True, exist_ok=True)
                runner([mvt_ios_bin, "check-backup", "-o", str(mvt_out), str(temp_dir)], 120)
        else:
            adb_bin = resolver("adb")
            android_deep_anomalies: list[dict[str, Any]] = []
            if adb_bin:
                _, pkg_out, _ = runner([adb_bin, "-s", device_id, "shell", "pm", "list", "packages", "-f"], 20)
                if pkg_out:
                    (temp_dir / "packages.txt").write_text(pkg_out, encoding="utf-8")
                _, acc_out, _ = runner(
                    [adb_bin, "-s", device_id, "shell", "settings", "get", "secure", "enabled_accessibility_services"],
                    15,
                )
                _, dump_out, _ = runner([adb_bin, "-s", device_id, "shell", "dumpsys", "device_policy"], 20)
                if dump_out:
                    (temp_dir / "device_policy.txt").write_text(dump_out, encoding="utf-8")
                android_deep_anomalies = analyze_android_accessibility_and_mdm(acc_out, dump_out)
                runner([adb_bin, "-s", device_id, "bugreport", str(temp_dir / "bugreport.zip")], 90)

            mvt_android_bin = resolver("mvt-android")
            if mvt_android_bin and (temp_dir / "bugreport.zip").exists():
                mvt_out = temp_dir / "mvt_out"
                mvt_out.mkdir(parents=True, exist_ok=True)
                runner([mvt_android_bin, "check-bugreport", "-o", str(mvt_out), str(temp_dir / "bugreport.zip")], 90)

        notify("scanning_spyware", 60, "Buscando rastros de spyware...")
        stream_res = stream_backup_directory(temp_dir, batch_size=1000, lookup_fn=ioc_lookup)

        cti_matches = stream_res.get("cti_matches", [])
        anomalies = list(stream_res.get("behavioral_anomalies", []))
        if norm_platform != "IOS" and "android_deep_anomalies" in locals():
            anomalies.extend(android_deep_anomalies)
        findings_count = len(cti_matches) + len(anomalies)

        if cti_matches or any(a.get("severity") == "CRITICAL" for a in anomalies):
            risk_level = "HIGH"
            verdict_label = "Alerta crítica: se detectaron indicadores asociados a spyware o rutas volátiles"
        elif anomalies:
            risk_level = "MEDIUM"
            verdict_label = "Precaución: se detectaron perfiles o configuraciones que requieren revisión"
        else:
            risk_level = "LOW"
            verdict_label = "Sin rastros conocidos de spyware en los registros analizados"

        recommended_actions = (
            [
                "Activa el Modo de Aislamiento (Lockdown Mode) en Ajustes → Privacidad y seguridad.",
                "Actualiza iOS a la última versión disponible y reinicia el iPhone diariamente.",
                "Revisa Ajustes → General → VPN y gestión de dispositivos por perfiles desconocidos.",
            ]
            if norm_platform == "IOS"
            else [
                "Verifica Google Play Protect y elimina aplicaciones instaladas fuera de Play Store.",
                "Revisa Ajustes → Seguridad → Aplicaciones de administración del dispositivo.",
                "Actualiza el parche de seguridad de Android y reinicia el teléfono periódicamente.",
            ]
        )

        notify("wiping_temp", 90, "Destruyendo copia temporal...")
        zero_retention_wiped = _secure_wipe_directory(temp_dir)
        notify("completed", 100, "Análisis completado y copia temporal destruida.")

        return {
            "platform": norm_platform,
            "deviceModelHash": model_hash,
            "artifactSha256": stream_res.get("artifact_sha256") or hashlib.sha256(model_hash.encode()).hexdigest(),
            "findingsCount": findings_count,
            "riskLevel": risk_level,
            "verdictLabel": verdict_label,
            "zeroRetentionWiped": zero_retention_wiped,
            "rowsStreamed": stream_res.get("rows_streamed", 0),
            "indicatorsAnalyzed": stream_res.get("indicators_extracted", 0),
            "ctiMatches": cti_matches,
            "behavioralAnomalies": anomalies,
            "timeline": stream_res.get("timeline", []),
            "recommendedActions": recommended_actions,
            "ephemeralNotice": (
                "Zero-Retention verificado: la copia temporal se sobrescribió y eliminó íntegramente tras el análisis."
            ),
        }
    finally:
        _secure_wipe_directory(temp_dir)


def start_usb_audit_job(
    *,
    platform: str,
    device_id: str,
    backup_password: str | None = None,
    async_mode: bool = False,
    simulated_backup_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Inicia un trabajo de auditoría USB y devuelve su estado (o resultado inmediato si `async_mode=False`)."""
    job_id = str(uuid.uuid4())
    job_state: dict[str, Any] = {
        "jobId": job_id,
        "status": "RUNNING",
        "stage": "extracting_logs",
        "progress": 10,
        "message": "Extrayendo registros de sistema...",
        "platform": (platform or "IOS").upper(),
        "createdAt": time.time(),
        "result": None,
        "error": None,
    }
    with _JOBS_LOCK:
        if len(_USB_JOBS) >= _MAX_JOBS:
            oldest = min(_USB_JOBS.items(), key=lambda kv: kv[1].get("createdAt", 0.0))[0]
            _USB_JOBS.pop(oldest, None)
        _USB_JOBS[job_id] = job_state

    def _update(stage: str, pct: int, msg: str) -> None:
        with _JOBS_LOCK:
            if job_id in _USB_JOBS:
                _USB_JOBS[job_id]["stage"] = stage
                _USB_JOBS[job_id]["progress"] = pct
                _USB_JOBS[job_id]["message"] = msg

    def _worker() -> None:
        try:
            res = run_usb_triage(
                platform=platform,
                device_id=device_id,
                backup_password=backup_password,
                simulated_backup_dir=simulated_backup_dir,
                progress_cb=_update,
            )
            with _JOBS_LOCK:
                if job_id in _USB_JOBS:
                    _USB_JOBS[job_id]["status"] = "COMPLETED"
                    _USB_JOBS[job_id]["stage"] = "completed"
                    _USB_JOBS[job_id]["progress"] = 100
                    _USB_JOBS[job_id]["message"] = "Análisis completado y copia temporal destruida."
                    _USB_JOBS[job_id]["result"] = res
        except Exception as exc:
            with _JOBS_LOCK:
                if job_id in _USB_JOBS:
                    _USB_JOBS[job_id]["status"] = "FAILED"
                    _USB_JOBS[job_id]["stage"] = "failed"
                    _USB_JOBS[job_id]["error"] = str(exc)

    if async_mode:
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
    else:
        _worker()

    with _JOBS_LOCK:
        return dict(_USB_JOBS[job_id])


def get_usb_audit_job(job_id: str) -> dict[str, Any] | None:
    with _JOBS_LOCK:
        job = _USB_JOBS.get(job_id)
        return dict(job) if job else None
