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

import ipaddress
import json
from typing import Any

from services import DB_DSN
from yara_engine import scan_artifacts_with_yara

IMPERSONATED_WIN_BINARIES = {
    "svchost.exe",
    "lsass.exe",
    "csrss.exe",
    "winlogon.exe",
    "services.exe",
    "smss.exe",
    "wmiutils.dll",
    "taskhostw.exe",
    "conhost.exe",
    "dllhost.exe",
    "agentservice.exe",
}

LEGIT_WIN_PATH_MARKERS = (
    "\\windows\\system32\\",
    "\\windows\\syswow64\\",
    "\\windows\\winsxs\\",
    "\\windows\\systemapps\\",
)

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
                "control": "SmartScreen / Filtro de aplicaciones",
                "value": "ACTIVO" if smart else "DESACTIVADO",
                "status": "OK" if smart else "WARN",
                "detail": (
                    "SmartScreen verifica reputación de ejecutables y sitios web."
                    if smart
                    else "Conviene activar SmartScreen para frenar ejecutables desconocidos."
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
        import psycopg

        with psycopg.connect(DB_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT ON (LOWER(i.ioc_value), COALESCE(c.spyware_family, 'Spyware Comercial'))
                        i.ioc_value,
                        i.ioc_type,
                        COALESCE(c.spyware_family, 'Spyware Comercial'),
                        COALESCE(c.name, 'Catálogo OMEGA'),
                        COALESCE(r.title, '')
                    FROM iocs i
                    LEFT JOIN campaigns c ON i.campaign_id = c.id
                    LEFT JOIN reports r ON c.report_id = r.id
                    WHERE LOWER(i.ioc_value) = ANY(%s)
                    ORDER BY LOWER(i.ioc_value), COALESCE(c.spyware_family, 'Spyware Comercial');
                    """,
                    (candidates,),
                )
                return [
                    {
                        "ioc_value": row[0],
                        "ioc_type": row[1],
                        "spyware_family": row[2],
                        "campaign": row[3],
                        "source_report": row[4],
                        "artifact_origin": f"Host Live Audit ({row[1]})",
                        "context": f"Coincidencia directa detectada en memoria del equipo ({row[1]}).",
                    }
                    for row in cur.fetchall()
                ]
    except Exception:
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
        signer = str(proc.get("signer") or "").strip()
        sha = str(proc.get("sha256") or "").strip()
        pid = int(proc.get("pid") or 0)

        if pname:
            proc_names.append(pname)
        if sha:
            sha256_candidates.append(sha)

        pname_low = pname.lower()
        ppath_low = ppath.lower()
        sig_low = sig_status.lower()
        is_unsigned = bool(sig_low) and sig_low not in ("valid", "signed", "ok")

        # 2a. Suplantación de binarios del sistema Windows (Candiru / Trojans)
        base_exe = pname_low if pname_low.endswith((".exe", ".dll")) else f"{pname_low}.exe"
        if base_exe in IMPERSONATED_WIN_BINARIES or pname_low == "wmiutils":
            in_legit_dir = any(m in ppath_low for m in LEGIT_WIN_PATH_MARKERS) if ppath_low else True
            non_ms_signer = bool(signer) and "microsoft" not in signer.lower()
            if (ppath_low and not in_legit_dir) or is_unsigned or non_ms_signer:
                ind = ppath or pname
                if ind not in seen_indicators:
                    seen_indicators.add(ind)
                    behavioral_anomalies.append({
                        "category": "HOST_SYSTEM_BINARY_MASQUERADE",
                        "severity": "CRITICAL",
                        "indicator": ind,
                        "artifact": f"Proceso PID {pid} ({pname})",
                        "detail": (
                            f"El proceso '{pname}' imita un componente crítico de Windows fuera de la ruta oficial o sin firma válida de Microsoft "
                            f"(Firma: {sig_status or 'Desconocida'}). Técnica documentada en Candiru / DevilsTongue."
                        ),
                    })

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
        verdict_label = "Sin Indicadores de Spyware en esta Computadora"
        rationale = (
            f"Se auditaron {len(live_sockets)} conexiones públicas salientes, procesos activos, tareas programadas y "
            "suscripciones WMI sin detectar persistencia oculta, firmas YARA ni coincidencias CTI conocidas."
        )
        recommended_actions = [
            "Mantén actualizados Windows Update / macOS y el navegador principal para cerrar vulnerabilidades de día cero.",
        ]

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
        "triage": {
            "total_files": 4,
            "total_indicators_analyzed": len(external_ips) + len(proc_names) + len(sha256_candidates) + len(wmi_subscriptions),
            "total_matches": len(cti_matches),
            "behavioral_anomalies": behavioral_anomalies,
            "yara_hits": yara_hits,
            "timeline": [],
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
