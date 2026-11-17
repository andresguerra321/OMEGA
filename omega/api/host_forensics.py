"""Motor forense local de escritorio en RAM (Pilar 3: Auditoría Windows / macOS / Linux).

Analiza telemetría de solo lectura recolectada por OMEGA Desktop sin leer documentos
personales ni guardar rastros en disco (RNF4):
- Endurecimiento del sistema operativo (Defender, Firewall, UAC, SmartScreen / SIP, Gatekeeper)
- Persistencia sin archivos en WMI (root\\subscription — TTP clásica de Candiru / DevilsTongue)
- Suplantación de binarios del sistema (svchost, lsass, wmiutils fuera de System32/wbem o sin firma Microsoft)
- Ejecutables no firmados en rutas temporales con red saliente activa o tareas programadas anómalas
- Cruce de IPs remotas, procesos y hashes SHA-256 contra PostgreSQL CTI y motor YARA en RAM.
"""

from __future__ import annotations

from datetime import datetime, timezone
import ipaddress
import json
import logging
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from typing import Any

from host_runtime import powershell, run_command

from cti_db import get_catalog_freshness, lookup_iocs_detailed
from forensic_scope import (
    OS_SCOPE_LIMITATION_NOTICE,
    format_clean_verdict_texts,
    get_platform_mitigations,
)
from yara_engine import scan_artifacts_with_yara

logger = logging.getLogger(__name__)

_SIGNATURE_CACHE: dict[tuple, tuple[float, dict]] = {}
_SIGNATURE_LOCK = threading.Lock()


def prime_windows_signature_cache(paths: list[str]):
    """One PowerShell launch per audit, instead of one per executable."""
    if sys.platform != 'win32':
        return
    pending = {}
    with _SIGNATURE_LOCK:
        for path in dict.fromkeys(paths):
            try:
                stat = Path(path).stat()
                key = (str(Path(path).resolve()), stat.st_mtime_ns, stat.st_size)
                cached = _SIGNATURE_CACHE.get(key)
                if not cached or time.monotonic() - cached[0] >= 300:
                    pending[path] = key
            except OSError:
                continue
    if not pending:
        return
    try:
        result = powershell("$paths=([Console]::In.ReadToEnd()|ConvertFrom-Json); $out=@(); foreach($p in $paths){try{"
                            "$s=Get-AuthenticodeSignature -LiteralPath $p -ErrorAction Stop;"
                            "$out+=@{path=$p;status=[string]$s.Status;publisher=[string]$s.SignerCertificate.Subject}"
                            "}catch{}}; ConvertTo-Json -InputObject @($out) -Compress", input_text=json.dumps(list(pending)))
        if result.returncode:
            return
        rows = json.loads(result.stdout.lstrip('\ufeff') or '[]')
        with _SIGNATURE_LOCK:
            for row in rows:
                key = pending.get(row['path'])
                stat = Path(row['path']).stat()
                if key and (stat.st_mtime_ns, stat.st_size) == key[1:]:
                    _SIGNATURE_CACHE[key] = (time.monotonic(), {'status': {'Valid': 'Valid', 'NotSigned': 'Unsigned', 'HashMismatch': 'Tampered'}.get(row['status'], 'Unknown'),
                                                             'publisher': row['publisher'], 'teamIdentifier': '', 'verificationType': 'Authenticode', 'detail': row['status']})
            while len(_SIGNATURE_CACHE) > 1024:
                _SIGNATURE_CACHE.pop(next(iter(_SIGNATURE_CACHE)))
    except (OSError, ValueError, subprocess.SubprocessError):
        return


def sha256_file(path: str) -> str:
    """Hash regular files only, with a size bound and mutation detection."""
    target = Path(path)
    before = target.stat()
    if not target.is_file() or before.st_size > 512 * 1024 * 1024:
        raise ValueError('Archivo no regular o superior a 512 MiB')
    digest = hashlib.sha256()
    with target.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    after = target.stat()
    if (before.st_mtime_ns, before.st_size, before.st_ino) != (after.st_mtime_ns, after.st_size, after.st_ino):
        raise ValueError('El archivo cambió durante la lectura')
    return digest.hexdigest()


def verify_binary_signature(path: str, platform_name: str | None = None) -> dict:
    """Unknown is distinct from unsigned. Linux checks package integrity, not Authenticode."""
    platform_name = platform_name or sys.platform
    unknown = {'status': 'Unknown', 'publisher': '', 'teamIdentifier': '', 'verificationType': '', 'detail': ''}
    if path.endswith(' (deleted)'):
        return {**unknown, 'status': 'Deleted', 'detail': 'El ejecutable ya no existe en disco.'}
    if platform_name != sys.platform:
        return {**unknown, 'detail': 'La firma requiere un recolector nativo del sistema de origen.'}
    try:
        stat = Path(path).stat()
        if not Path(path).is_file():
            return {**unknown, 'detail': 'No es un archivo regular.'}
        key = (str(Path(path).resolve()), stat.st_mtime_ns, stat.st_size)
    except OSError:
        return {**unknown, 'detail': 'Archivo ausente o sin permiso de lectura.'}
    with _SIGNATURE_LOCK:
        cached = _SIGNATURE_CACHE.get(key)
        if cached and time.monotonic() - cached[0] < 300:
            return dict(cached[1])
    result = dict(unknown)
    try:
        if platform_name == 'win32':
            env = dict(os.environ, OMEGA_VERIFY_PATH=path)
            output = powershell("$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:OMEGA_VERIFY_PATH; "
                                "@{status=[string]$s.Status;publisher=[string]$s.SignerCertificate.Subject}|ConvertTo-Json -Compress", env=env)
            if output.returncode == 0:
                data = json.loads(output.stdout.lstrip('\ufeff'))
                state = {'Valid': 'Valid', 'NotSigned': 'Unsigned', 'HashMismatch': 'Tampered'}.get(data.get('status'), 'Unknown')
                result.update(status=state, publisher=data.get('publisher', ''), verificationType='Authenticode', detail=data.get('status', ''))
        elif platform_name == 'darwin':
            check = run_command(['codesign', '--verify', '-vv', '--deep', '--strict', path])
            info = run_command(['codesign', '-d', '--verbose=4', path])
            text = info.stderr + info.stdout
            authorities = re.findall(r'^Authority=(.+)$', text, re.M)
            team = re.search(r'^TeamIdentifier=(.+)$', text, re.M)
            state = 'Valid' if check.returncode == 0 else 'Unsigned' if 'not signed at all' in check.stderr else 'Unknown'
            if 'invalid signature' in check.stderr or 'modified' in check.stderr:
                state = 'Tampered'
            result.update(status=state, publisher='; '.join(authorities), teamIdentifier=team[1] if team else '', verificationType='codesign', detail=check.stderr[:500])
            if state == 'Valid':
                apple = run_command(['codesign', '--verify', '--strict', '-R', '=anchor apple', path])
                result['osVendorVerified'] = apple.returncode == 0
        else:
            import shutil
            if shutil.which('dpkg-query'):
                owner = run_command(['dpkg-query', '-S', path])
                if owner.returncode == 0 and ': ' in owner.stdout:
                    package = owner.stdout.split(': ', 1)[0].strip()
                    check = run_command(['dpkg', '-V', package])
                    relevant = [line for line in check.stdout.splitlines() if line.split() and line.split()[-1] == path]
                    # dpkg does not cover every installed file; require a stored checksum for this exact file.
                    sums = run_command(['dpkg-query', '--control-show', package, 'md5sums'])
                    covered = any(line.split(maxsplit=1)[-1].lstrip('/') == path.lstrip('/') for line in sums.stdout.splitlines())
                    state = 'Tampered' if relevant else 'Valid' if check.returncode in (0, 1) and sums.returncode == 0 and covered else 'Unknown'
                    result.update(status=state, publisher=package, verificationType='dpkg-integrity', detail='Integridad de paquete; no es una firma del fabricante.')
                elif owner.returncode == 1:
                    result.update(status='Unmanaged', verificationType='dpkg-integrity')
            elif shutil.which('rpm'):
                owner = run_command(['rpm', '-qf', '--', path])
                if owner.returncode == 0:
                    check = run_command(['rpm', '-Vf', '--', path])
                    relevant = [line for line in check.stdout.splitlines() if line.split() and line.split()[-1] == path]
                    result.update(status='Tampered' if relevant else 'Valid' if check.returncode in (0, 1) else 'Unknown',
                                  publisher=owner.stdout.strip(), verificationType='rpm-integrity', detail='Integridad de paquete; no es una firma del fabricante.')
                elif owner.returncode == 1:
                    result.update(status='Unmanaged', verificationType='rpm-integrity')
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        result['detail'] = f'Verificación no disponible: {type(exc).__name__}'
    try:
        after = Path(path).stat()
        if (after.st_mtime_ns, after.st_size) != (stat.st_mtime_ns, stat.st_size):
            return {**unknown, 'detail': 'El archivo cambió durante la verificación.'}
    except OSError:
        return unknown
    with _SIGNATURE_LOCK:
        if len(_SIGNATURE_CACHE) >= 512:
            _SIGNATURE_CACHE.pop(next(iter(_SIGNATURE_CACHE)))
        _SIGNATURE_CACHE[key] = (time.monotonic(), result)
    return dict(result)


def inspect_process_identity(proc: dict, platform_name: str) -> list[dict]:
    """Evaluate measured process metadata; unavailable signatures never prove tampering."""
    name = str(proc.get('name', '')).lower()
    path = str(proc.get('exe_path', ''))
    normalized = path.replace('\\', '/').lower()
    signature = proc.get('signature') or {'status': proc.get('signature_status', 'Unknown'), 'publisher': proc.get('signer', '')}
    critical = {
        'svchost.exe': ('/windows/system32/svchost.exe',), 'lsass.exe': ('/windows/system32/lsass.exe',),
        'csrss.exe': ('/windows/system32/csrss.exe',), 'services.exe': ('/windows/system32/services.exe',),
        'winlogon.exe': ('/windows/system32/winlogon.exe',), 'smss.exe': ('/windows/system32/smss.exe',),
        'taskhostw.exe': ('/windows/system32/taskhostw.exe',), 'conhost.exe': ('/windows/system32/conhost.exe',),
        'dllhost.exe': ('/windows/system32/dllhost.exe',),
        'launchd': ('/sbin/launchd',), 'windowserver': ('/system/library/privateframeworks/skylight.framework/versions/a/resources/windowserver',),
        'springboard': ('/system/library/coreservices/springboard.app/springboard',),
        'sshd': ('/usr/sbin/sshd',), 'systemd': ('/usr/lib/systemd/systemd', '/lib/systemd/systemd'),
    }
    findings = []
    def add(category, severity, title, detail):
        findings.append({'category': category, 'severity': severity, 'indicator': path or name,
                         'artifact': f"Proceso PID {proc.get('pid', '')}", 'detail': detail,
                         'userFriendlyTitle': title, 'userFriendlyExplanation': detail,
                         'recommendedAction': 'Verifica el origen del programa y conserva el resultado para revisión técnica.',
                         'targetPath': path, 'sha256': proc.get('sha256', ''), 'signatureStatus': signature.get('status', 'Unknown'), 'publisher': signature.get('publisher', '')})
    if name in critical and path:
        canonical = any(normalized == candidate or (platform_name == 'win32' and normalized == os.environ.get('SystemRoot', 'C:/Windows').replace('\\', '/').lower() + '/system32/' + name) for candidate in critical[name])
        publisher = signature.get('publisher', '').lower()
        bad_vendor = signature.get('status') == 'Valid' and ((platform_name == 'win32' and 'microsoft' not in publisher) or (platform_name == 'darwin' and 'apple' not in publisher))
        if signature.get('status') == 'Valid' and platform_name == 'darwin' and signature.get('osVendorVerified') is False:
            bad_vendor = True
        if signature.get('status') == 'Valid' and platform_name.startswith('linux'):
            allowed_packages = ('openssh', 'openssh-server') if name == 'sshd' else ('systemd',)
            bad_vendor = not any(re.match(r'^' + re.escape(package) + r'(?:$|[-:])', publisher) for package in allowed_packages)
        if not canonical or signature.get('status') in ('Tampered', 'Unsigned', 'Deleted', 'Unmanaged') or bad_vendor:
            add('HOST_SYSTEM_BINARY_MASQUERADE', 'CRITICAL', 'Un programa parece hacerse pasar por un componente del sistema',
                f"Nombre: {name}. Ruta canónica: {canonical}. Verificación: {signature.get('status', 'Unknown')}. Requiere investigación; no atribuye una familia de spyware.")
    if path.endswith(' (deleted)') or normalized.startswith(('/tmp/', '/var/tmp/', '/dev/shm/')):
        add('HOST_VOLATILE_EXECUTABLE', 'HIGH', 'Programa ejecutándose desde una ubicación temporal o eliminada', 'Esta ubicación dificulta verificar su origen y merece revisión; no demuestra infección por sí sola.')
    privileged = proc.get('privileged') is True
    if privileged:
        env = proc.get('environment') or {}
        injected = [key for key in ('LD_PRELOAD', 'DYLD_INSERT_LIBRARIES') if env.get(key)]
        modules = [str(m) for m in proc.get('modules', []) if str(m).startswith(('/tmp/', '/var/tmp/', '/dev/shm/'))
                   or str(m).endswith(' (deleted)') or any(marker in str(m).replace('\\', '/').lower()
                   for marker in ('/appdata/local/temp/', '/windows/temp/', '/users/public/'))]
        if injected or modules:
            add('HOST_LIBRARY_INJECTION', 'HIGH', 'Un programa privilegiado carga bibliotecas que requieren revisión',
                f"Variables de carga: {', '.join(injected) or 'ninguna'}. Módulos anómalos: {', '.join(modules[:10])}.")
    return findings

STRICT_TEMP_MARKERS = (
    "\\appdata\\local\\temp\\",
    "\\users\\public\\",
    "\\windows\\temp\\",
    "/tmp/",
    "/var/tmp/",
    "/dev/shm/",
)

HIGH_RISK_TEMP_MARKERS = (
    *STRICT_TEMP_MARKERS,
    "\\programdata\\",
)

ENCODED_SCRIPT_MARKERS = (
    "-encodedcommand",
    "-enc ",
    "frombase64string",
    "mshta ",
    "wscript ",
    "cscript ",
    "regsvr32 ",
    "rundll32 ",
    "invoke-expression",
    "iex(",
    "downloadstring(",
)

BUILTIN_WMI_NAMES = frozenset({
    "scm event log consumer",
    "scm event log filter",
    "bvtconsumer",
    "bvtfilter",
    "tslogonfilter",
    "tslogonevents",
    "raeventconsumer",
})


def _is_public_ip(ip_str: str) -> bool:
    try:
        ip_obj = ipaddress.ip_address(ip_str.strip())
        return not (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
        )
    except ValueError:
        return False


def _evaluate_host_posture(platform_name: str, host: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    if platform_name == "win32":
        def_rt = host.get("defender_realtime")
        if def_rt is True:
            checks.append({
                "control": "Protección en tiempo real (Windows Defender)",
                "value": "ACTIVA",
                "status": "OK",
                "detail": "La protección residente de Windows Defender está encendida bloqueando código malicioso.",
            })
        elif def_rt is False:
            checks.append({
                "control": "Protección en tiempo real (Windows Defender)",
                "value": "DESACTIVADA",
                "status": "CRITICAL",
                "detail": "La protección en tiempo real está apagada; el equipo queda expuesto a implantes sin detección.",
            })
        else:
            checks.append({
                "control": "Protección en tiempo real (Windows Defender)",
                "value": "SIN DATO",
                "status": "WARN",
                "detail": "No se pudo confirmar Defender (puede haber otro antivirus o requerir permisos).",
            })

        fw = host.get("firewall_enabled")
        checks.append({
            "control": "Firewall de Windows",
            "value": "ACTIVO" if fw else "INACTIVO" if fw is False else "SIN DATO",
            "status": "OK" if fw else "CRITICAL" if fw is False else "WARN",
            "detail": (
                "El firewall filtra conexiones entrantes y salientes."
                if fw
                else "El firewall está desactivado en todos los perfiles de red."
                if fw is False
                else "Estado del firewall no disponible."
            ),
        })

        uac = host.get("uac_enabled")
        checks.append({
            "control": "Control de Cuentas de Usuario (UAC)",
            "value": "ACTIVO" if uac else "DESACTIVADO" if uac is False else "SIN DATO",
            "status": "OK" if uac else "WARN",
            "detail": (
                "Windows exige confirmación antes de que un programa eleve privilegios."
                if uac
                else "UAC desactivado facilita escalamiento silencioso de privilegios."
            ),
        })

        smart = host.get("smartscreen_enabled")
        if smart is not None:
            checks.append({
                "control": "SmartScreen / Filtro de aplicaciones [CIS 18.9.80]",
                "value": "ACTIVO" if smart else "DESACTIVADO",
                "status": "OK" if smart else "WARN",
                "detail": (
                    "SmartScreen evalúa reputación de descargas y ejecutables desconocidos."
                    if smart
                    else "SmartScreen desactivado reduce la barrera frente a ejecutables maliciosos."
                ),
            })

        smbv1 = host.get("smbv1_enabled")
        if smbv1 is not None:
            checks.append({
                "control": "Protocolo legado SMBv1 [CIS Benchmark 18.3.1]",
                "value": "ACTIVO (RIESGO)" if smbv1 else "DESHABILITADO",
                "status": "CRITICAL" if smbv1 else "OK",
                "detail": (
                    "SMBv1 está habilitado; protocolo obsoleto explotado por ransomware (EternalBlue/WannaCry)."
                    if smbv1
                    else "SMBv1 deshabilitado conforme a endurecimiento CIS."
                ),
            })

        bitlocker = host.get("bitlocker_protected")
        if bitlocker is not None:
            checks.append({
                "control": "Cifrado de disco BitLocker [CIS Benchmark 18.10.9]",
                "value": "PROTEGIDO" if bitlocker else "SIN CIFRADO",
                "status": "OK" if bitlocker else "WARN",
                "detail": (
                    "El volumen del sistema está cifrado con BitLocker."
                    if bitlocker
                    else "El volumen del sistema no tiene protección BitLocker activa ante robo o extracción física."
                ),
            })

        rdp = host.get("rdp_enabled")
        if rdp is not None:
            checks.append({
                "control": "Escritorio Remoto (RDP / fDenyTSConnections) [CIS Benchmark 18.9.65.3]",
                "value": "HABILITADO" if rdp else "DESHABILITADO",
                "status": "WARN" if rdp else "OK",
                "detail": (
                    "RDP está habilitado (fDenyTSConnections=0); verifica NLA y restricción por VPN/firewall."
                    if rdp
                    else "Escritorio Remoto deshabilitado conforme a CIS."
                ),
            })

        pwd_min = host.get("password_policy_min_len")
        if isinstance(pwd_min, int):
            checks.append({
                "control": "Política local: longitud mínima de contraseña [CIS Benchmark 1.1.4]",
                "value": f"{pwd_min} caracteres",
                "status": "OK" if pwd_min >= 8 else "WARN",
                "detail": (
                    "Longitud mínima de contraseña acorde a política base."
                    if pwd_min >= 8
                    else "Longitud mínima inferior a 8 caracteres (CIS recomienda >= 14 en entornos corporativos)."
                ),
            })

        patch_date = str(host.get("last_security_patch_date") or "").strip()
        patch_id = str(host.get("last_security_patch_id") or "").strip()
        if patch_date:
            patch_status = "OK"
            try:
                days_old = (datetime.now(timezone.utc).date() - datetime.strptime(patch_date, "%Y-%m-%d").date()).days
                if days_old > 60:
                    patch_status = "WARN"
            except ValueError:
                days_old = None
            checks.append({
                "control": "Último parche de seguridad instalado [CIS Control 7]",
                "value": f"{patch_id or 'KB'} ({patch_date})",
                "status": patch_status,
                "detail": (
                    "Actualizaciones de seguridad recientes."
                    if patch_status == "OK"
                    else f"El último parche registrado tiene más de 60 días ({patch_date}); revisa Windows Update."
                ),
            })
    elif platform_name == "darwin":
        sip = host.get("sip_enabled")
        gk = host.get("gatekeeper_enabled")
        checks.append({
            "control": "System Integrity Protection (SIP)",
            "value": "ACTIVO" if sip else "DESACTIVADO",
            "status": "OK" if sip else "CRITICAL",
            "detail": (
                "Protección de integridad del núcleo macOS habilitada."
                if sip
                else "SIP desactivado deja el sistema expuesto a implantes en nivel kernel."
            ),
        })
        checks.append({
            "control": "Apple Gatekeeper",
            "value": "ACTIVO" if gk else "DESACTIVADO",
            "status": "OK" if gk else "WARN",
            "detail": (
                "Gatekeeper valida firmas de desarrollador antes de abrir apps."
                if gk
                else "Gatekeeper apagado permite ejecutar software no firmado."
            ),
        })
    else:
        checks.append({
            "control": f"Sistema de Escritorio ({platform_name or 'Host'})",
            "value": str(host.get("os_version") or "Linux/Desktop"),
            "status": "OK",
            "detail": "Auditoría de procesos, sockets y persistencia ejecutada en solo lectura.",
        })
    return checks


def _lookup_host_cti_matches(
    remote_ips: list[str],
    proc_names: list[str],
    sha256_list: list[str],
) -> list[dict[str, Any]]:
    candidates = sorted(
        {
            *(ip.strip().lower() for ip in remote_ips if ip and ip.strip()),
            *(p.strip().lower() for p in proc_names if p and len(p.strip()) >= 4),
            *(h.strip().lower() for h in sha256_list if h and len(h.strip()) == 64),
        }
    )[:200]
    if not candidates:
        return []

    try:
        rows = lookup_iocs_detailed(candidates)
        return [
            {
                "ioc_value": row["ioc_value"],
                "ioc_type": row["ioc_type"],
                "spyware_family": row["spyware_family"],
                "campaign": row["campaign"],
                "source_report": row["source_report"],
                "artifact_origin": f"Host Live Audit ({row['ioc_type']})",
                "context": f"Coincidencia directa detectada en memoria del equipo ({row['ioc_type']}).",
            }
            for row in rows
        ]
    except Exception as exc:
        logger.debug("Error consultando IOCs de host en PostgreSQL: %s", exc)
        return []


def run_host_live_audit(payload: dict[str, Any]) -> dict[str, Any]:
    """Ejecuta auditoría forense completa del PC local en memoria volátil."""
    platform_name = str(payload.get("platform") or "win32").lower()
    host = payload.get("host") or {}
    tcp_connections = payload.get("tcp_connections") or []
    processes = payload.get("processes") or []
    wmi_subscriptions = payload.get("wmi_subscriptions") or []
    scheduled_tasks = payload.get("scheduled_tasks") or []
    startup_items = payload.get("startup_items") or []
    file_hashes = payload.get("file_hashes") or []

    hardening_checks = _evaluate_host_posture(platform_name, host)
    abuse_alerts: list[dict[str, Any]] = []
    behavioral_anomalies: list[dict[str, Any]] = []
    seen_indicators: set[str] = set()

    # 1. Sockets externos activos (PID -> proceso -> ruta -> firma)
    live_sockets: list[dict[str, Any]] = []
    external_ips: list[str] = []
    pids_with_public_sockets: set[int] = set()

    for sock in tcp_connections:
        if not isinstance(sock, dict):
            continue
        r_ip = str(sock.get("remote_ip") or "").strip()
        if not _is_public_ip(r_ip):
            continue
        external_ips.append(r_ip)
        pid = int(sock.get("pid") or 0)
        if pid:
            pids_with_public_sockets.add(pid)
        live_sockets.append(
            {
                "remote_ip": r_ip,
                "remote_port": int(sock.get("remote_port") or 0),
                "local_port": int(sock.get("local_port") or 0),
                "state": str(sock.get("state") or "ESTABLISHED"),
                "uid": pid,
                "process_name": str(sock.get("process_name") or ""),
                "exe_path": str(sock.get("exe_path") or ""),
                "cti_match": False,
                "spyware_family": "",
            }
        )

    # 2. Auditoría de procesos (suplantación System32 / no firmados en rutas temporales)
    proc_names: list[str] = []
    sha256_candidates: list[str] = [str(fh.get("sha256") or "") for fh in file_hashes if isinstance(fh, dict)]

    for proc in processes:
        if not isinstance(proc, dict):
            continue
        pname = str(proc.get("name") or "").strip()
        ppath = str(proc.get("exe_path") or "").strip()
        cmdline = str(proc.get("command_line") or "").strip()
        sig_status = str(proc.get("signature_status") or "").strip()
        sha = str(proc.get("sha256") or "").strip()
        pid = int(proc.get("pid") or 0)

        if pname:
            proc_names.append(pname)
        if sha:
            sha256_candidates.append(sha)

        ppath_low = ppath.lower()
        sig_low = sig_status.lower()
        is_unsigned = sig_low in ('unsigned', 'notsigned', 'tampered', 'hashmismatch', 'unmanaged')

        # An unavailable signature alone does not establish masquerading.
        for finding in inspect_process_identity(proc, platform_name):
            if finding['indicator'] not in seen_indicators:
                seen_indicators.add(finding['indicator'])
                behavioral_anomalies.append(finding)

        # 2b. Ejecutable no firmado en rutas temporales / públicas
        in_risky_path = any(m in ppath_low for m in HIGH_RISK_TEMP_MARKERS)
        if in_risky_path and is_unsigned:
            has_net = pid in pids_with_public_sockets
            sev = "CRITICAL" if has_net else "HIGH"
            ind = ppath or pname
            if ind not in seen_indicators:
                seen_indicators.add(ind)
                behavioral_anomalies.append({
                    "category": "HOST_UNSIGNED_TEMP_EXECUTABLE",
                    "severity": sev,
                    "indicator": ind,
                    "artifact": f"Proceso PID {pid}",
                    "detail": (
                        f"Programa sin firma digital ejecutándose desde una carpeta temporal o pública ({ppath})"
                        + (" con conexión de red externa activa." if has_net else ".")
                    ),
                })

        # 2c. PowerShell/script codificado en ejecución
        if cmdline and any(mk in cmdline.lower() for mk in ENCODED_SCRIPT_MARKERS):
            ind = f"{pname}:{cmdline[:80]}"
            if ind not in seen_indicators:
                seen_indicators.add(ind)
                abuse_alerts.append({
                    "category": "HOST_OBFUSCATED_SCRIPT_EXEC",
                    "severity": "HIGH",
                    "indicator": pname,
                    "detail": f"Línea de comandos ofuscada en ejecución: {cmdline[:140]}",
                })

    # 3. Persistencia WMI (root\subscription — Candiru / DevilsTongue sin archivos)
    for sub in wmi_subscriptions:
        if not isinstance(sub, dict):
            continue
        w_name = str(sub.get("name") or "").strip()
        w_target = str(sub.get("query_or_target") or sub.get("detail") or "").strip()
        if w_name.lower() in BUILTIN_WMI_NAMES:
            continue
        ind = w_name or w_target[:60]
        if ind and ind not in seen_indicators:
            seen_indicators.add(ind)
            behavioral_anomalies.append({
                "category": "HOST_WMI_EVENT_PERSISTENCE",
                "severity": "CRITICAL",
                "indicator": ind,
                "artifact": "WMI root\\subscription",
                "detail": (
                    f"Suscripción persistente en WMI no estándar ('{w_name}' -> {w_target[:140]}). "
                    "Esta persistencia sin archivos permite re-ejecutar spyware como Candiru tras reiniciar."
                ),
            })

    # 4. Tareas programadas / entradas de inicio sospechosas
    for task in scheduled_tasks:
        if not isinstance(task, dict):
            continue
        t_path = str(task.get("task_path") or "")
        t_name = str(task.get("name") or "")
        t_exec = str(task.get("execute") or "").strip()
        exec_cmd = f"{t_exec} {task.get('arguments') or ''}".strip()
        exec_low = t_exec.lower()
        cmd_low = exec_cmd.lower()
        has_suspicious_exec = "\\programdata\\" in exec_low
        has_suspicious_cmd = any(m in cmd_low for m in (*STRICT_TEMP_MARKERS, *ENCODED_SCRIPT_MARKERS))
        if t_path.lower().startswith("\\microsoft\\") and not (has_suspicious_exec or any(m in cmd_low for m in STRICT_TEMP_MARKERS)):
            continue
        if has_suspicious_exec or has_suspicious_cmd:
            ind = t_name or exec_cmd[:60]
            if ind not in seen_indicators:
                seen_indicators.add(ind)
                abuse_alerts.append({
                    "category": "HOST_SUSPICIOUS_SCHEDULED_TASK",
                    "severity": "HIGH",
                    "indicator": t_name,
                    "detail": f"Tarea programada ejecuta comando desde ruta temporal u ofuscada: {exec_cmd[:140]}",
                })

    for st in startup_items:
        if not isinstance(st, dict):
            continue
        s_name = str(st.get("name") or "")
        s_cmd = str(st.get("command") or "").strip()
        low = s_cmd.lower()
        if s_cmd.startswith('"') and '"' in s_cmd[1:]:
            startup_exe_low = s_cmd[1 : s_cmd.index('"', 1)].strip().lower()
        else:
            startup_exe_low = low.split(" -", 1)[0].split(" /", 1)[0].strip()
        if ("\\programdata\\" in startup_exe_low) or any(m in low for m in (*STRICT_TEMP_MARKERS, *ENCODED_SCRIPT_MARKERS)):
            ind = f"run:{s_name}"
            if ind not in seen_indicators:
                seen_indicators.add(ind)
                abuse_alerts.append({
                    "category": "HOST_SUSPICIOUS_STARTUP_RUN",
                    "severity": "HIGH",
                    "indicator": s_name,
                    "detail": f"Entrada de inicio automático sospechosa: {s_cmd[:140]}",
                })

    # 5. Correlación CTI en PostgreSQL + YARA nativo en RAM
    cti_matches = _lookup_host_cti_matches(external_ips, proc_names, sha256_candidates)
    matched_ips = {m["ioc_value"].lower(): m["spyware_family"] for m in cti_matches if m["ioc_type"] == "ip"}
    for sock in live_sockets:
        fam = matched_ips.get(sock["remote_ip"].lower())
        if fam:
            sock["cti_match"] = True
            sock["spyware_family"] = fam

    synthetic_artifacts = [
        {
            "filename": "host_processes.json",
            "content": json.dumps(processes, ensure_ascii=False),
        },
        {
            "filename": "host_wmi_persistence.json",
            "content": json.dumps(wmi_subscriptions, ensure_ascii=False),
        },
        {
            "filename": "host_tasks_startup.json",
            "content": json.dumps(
                {"scheduled_tasks": scheduled_tasks, "startup_items": startup_items},
                ensure_ascii=False,
            ),
        },
    ]
    yara_hits = scan_artifacts_with_yara(synthetic_artifacts)

    # 6. Veredicto unificado comprensible
    has_cti = len(cti_matches) > 0
    has_yara = len(yara_hits) > 0
    crit_behavioral = [a for a in behavioral_anomalies if a.get("severity") == "CRITICAL"]
    has_risk_posture = any(c.get("status") == "CRITICAL" for c in hardening_checks)

    if has_cti or has_yara or crit_behavioral:
        verdict_code = "DETECTED" if (has_cti or has_yara) else "BEHAVIORAL_ZERO_DAY_SUSPICION"
        families = sorted({
            *(m["spyware_family"] for m in cti_matches),
            *(y["spyware_family"] for y in yara_hits),
        })
        verdict_label = (
            "Coincidencia Crítica de Spyware de Escritorio"
            if (has_cti or has_yara)
            else "Anomalía Crítica de Persistencia o Proceso en PC"
        )
        rationale = (
            (f"OMEGA detectó indicadores compatibles con {', '.join(families)} en tu computadora. " if families else "")
            + f"Se identificaron {len(cti_matches)} coincidencia(s) CTI, {len(yara_hits)} firma(s) YARA y "
            f"{len(behavioral_anomalies)} anomalía(s) crítica(s) de comportamiento."
        )
        recommended_actions = [
            "Desconecta la computadora de Wi-Fi / cable Ethernet sin apagarla ni formatearla todavía.",
            "Conserva la evidencia actual (exporta el reporte de OMEGA desde el botón Exportar).",
            "Revisa con un especialista las suscripciones WMI, tareas programadas y procesos señalados.",
        ]
    elif behavioral_anomalies or abuse_alerts or has_risk_posture:
        verdict_code = "SUSPICIOUS_ACTIVITY"
        verdict_label = "Sin Spyware Conocido · Revisar Alertas o Endurecimiento"
        rationale = (
            "No hay coincidencias con Candiru, Predator ni Helios en las conexiones ni hashes revisados, "
            f"pero se detectaron {len(behavioral_anomalies) + len(abuse_alerts)} aviso(s) o controles de seguridad apagados."
        )
        recommended_actions = [
            "Activa Windows Defender, Firewall y SmartScreen si alguno aparece desactivado.",
            "Verifica que las tareas programadas o entradas de inicio listadas pertenezcan a programas que tú instalaste.",
        ]
    else:
        verdict_code = "CLEAN"
        freshness = get_catalog_freshness()
        verdict_label, clean_rationale = format_clean_verdict_texts(freshness.get("catalog_cutoff_date"))
        rationale = (
            f"Se auditaron {len(live_sockets)} conexiones públicas salientes, procesos activos, tareas programadas y "
            f"suscripciones WMI sin detectar persistencia oculta. {clean_rationale}"
        )
        recommended_actions = [
            "Mantener actualizados Windows Update / macOS y navegadores (ninguna app en espacio de usuario detiene 0-clicks de kernel).",
            "Asegurar cifrado de disco completo (BitLocker / FileVault / LUKS) y rotación de cuentas si existiera exposición física.",
        ]

    # Reutilizar metadata de frescura para todos los veredictos
    catalog_freshness = get_catalog_freshness()
    mitigations = get_platform_mitigations(platform_name)

    # Ordena sockets poniendo los de red activa / match primero
    sorted_sockets = sorted(live_sockets, key=lambda s: (not s["cti_match"], s["remote_ip"]))

    return {
        "ram_only": True,
        "platform": platform_name,
        "device_summary": {
            "platform": "pc",
            "host_os": platform_name,
            "hostname": str(host.get("hostname") or "Esta computadora"),
            "os_version": str(host.get("os_version") or "Escritorio"),
        },
        "hardening_checks": hardening_checks,
        "abuse_alerts": abuse_alerts,
        "live_sockets_total": len(live_sockets),
        "live_sockets": sorted_sockets[:30],
        "yara_hits": yara_hits,
        "timeline": [],
        "timeline_summary": {"events_total": 0, "crashes_detected": 0, "chains_detected": 0},
        "catalog_freshness": catalog_freshness,
        "os_scope_notice": OS_SCOPE_LIMITATION_NOTICE,
        "platform_mitigations": mitigations,
        "triage": {
            "total_files": 4,
            "total_indicators_analyzed": len(external_ips) + len(proc_names) + len(sha256_candidates) + len(wmi_subscriptions),
            "total_matches": len(cti_matches),
            "behavioral_anomalies": behavioral_anomalies,
            "yara_hits": yara_hits,
            "timeline": [],
            "catalog_freshness": catalog_freshness,
            "os_scope_notice": OS_SCOPE_LIMITATION_NOTICE,
            "platform_mitigations": mitigations,
            "diagnosis": {
                "verdict_code": verdict_code,
                "verdict_label": verdict_label,
                "rationale": rationale,
                "recommended_actions": recommended_actions,
            },
            "subagents": [
                {
                    "agent_id": "HostNet",
                    "agent_name": "Red Externa y Sockets del Equipo",
                    "files_processed": 1,
                    "indicators_extracted": len(external_ips),
                    "matches_count": len([m for m in cti_matches if m["ioc_type"] in ("ip", "domain", "url")]),
                    "matches": [m for m in cti_matches if m["ioc_type"] in ("ip", "domain", "url")],
                    "notes": "Conexiones TCP salientes y cruces CTI en memoria",
                },
                {
                    "agent_id": "HostProc",
                    "agent_name": "Procesos, Firmas Digitales y Hashes",
                    "files_processed": 1,
                    "indicators_extracted": len(proc_names) + len(sha256_candidates),
                    "matches_count": len([m for m in cti_matches if m["ioc_type"] not in ("ip", "domain", "url")]),
                    "matches": [m for m in cti_matches if m["ioc_type"] not in ("ip", "domain", "url")],
                    "notes": "Ejecución en memoria y verificación de firmas digitales",
                },
                {
                    "agent_id": "HostPersist",
                    "agent_name": "Persistencia WMI y Tareas de Inicio",
                    "files_processed": 2,
                    "indicators_extracted": len(wmi_subscriptions) + len(scheduled_tasks) + len(startup_items),
                    "matches_count": 0,
                    "matches": [],
                    "notes": "WMI root\\subscription, tareas programadas y llaves Run",
                },
            ],
        },
    }
