"""Motor forense profundo en RAM (Kernel Android, Accessibility/DeviceAdmin, iOS Manifest.db y Caza YARA).

Opera íntegramente en memoria volátil (RNF4) sin persistencia en disco ni root en el dispositivo.
"""

from __future__ import annotations

import base64
from datetime import datetime
import ipaddress
import json
import re
import sqlite3
from typing import Any
import psycopg
from cti_ingestor_core import DB_DSN

# Firmas YARA / Patrones binarios defensivos de cadenas de explotación conocidas
BUILTIN_DETECTION_SIGNATURES: list[dict[str, Any]] = [
    {
        "rule": "Omega_iOS_FORCEDENTRY_JBIG2_Exploit",
        "family": "Pegasus (NSO Group)",
        "cve": "CVE-2021-30860",
        "description": "Estructura JBIG2 anómala incrustada en contenedor PDF/GIF (vector zero-click iMessage).",
        "byte_patterns": [b"/JBIG2Decode", b"com.apple.IMTranscoderAgent"],
        "min_matches": 2,
    },
    {
        "rule": "Omega_iOS_BLASTPASS_PassKit_WebP",
        "family": "Pegasus (NSO Group)",
        "cve": "CVE-2023-41064",
        "description": "Artefacto PassKit (.pkpass) combinado con payload WebP VP8L en mensajería.",
        "byte_patterns": [b"pass.json", b"VP8L", b"com.apple.MobileSMS"],
        "min_matches": 2,
    },
    {
        "rule": "Omega_iOS_Pegasus_Volatile_Staging",
        "family": "Pegasus (NSO Group)",
        "cve": "Persistencia volátil",
        "description": "Rutas de ejecución en /private/var/tmp/ asociadas a daemons suplantados (roleabout, pcsd, ckdiscretionaryd).",
        "byte_patterns": [b"/private/var/tmp/", b"roleabout", b"pcsd", b"ckdiscretionaryd", b"bridgepd"],
        "min_matches": 2,
    },
    {
        "rule": "Omega_Android_Predator_Alien_Loader",
        "family": "Predator (Intellexa)",
        "cve": "CVE-2021-37973 / Android 0-day",
        "description": "Indicadores de carga dinámica en /data/local/tmp/ y abuso de servicios de accesibilidad.",
        "byte_patterns": [b"/data/local/tmp/", b"AccessibilityService", b"DexClassLoader", b"pred.so"],
        "min_matches": 2,
    },
]

# Servicios de accesibilidad legítimos comunes para evitar ruido
KNOWN_SAFE_ACCESSIBILITY_PREFIXES: tuple[str, ...] = (
    "com.google.android.marvin.talkback",
    "com.google.android.apps.accessibility",
    "com.samsung.android.accessibility",
    "com.samsung.accessibility",
    "com.miui.accessibility",
    "com.android.switchaccess",
    "com.android.settings",
)

# Administradores de dispositivo estándar / sistema
KNOWN_SAFE_DEVICE_ADMIN_PREFIXES: tuple[str, ...] = (
    "com.google.android.gms",
    "com.android.managedprovisioning",
    "com.samsung.android.kgclient",
    "com.samsung.android.knox",
    "com.samsung.klmsagent",
    "com.microsoft.windowsintune",
)

_TCP_STATES: dict[str, str] = {
    "01": "ESTABLISHED",
    "02": "SYN_SENT",
    "03": "SYN_RECV",
    "04": "FIN_WAIT1",
    "05": "FIN_WAIT2",
    "06": "TIME_WAIT",
    "07": "CLOSE",
    "08": "CLOSE_WAIT",
    "09": "LAST_ACK",
    "0A": "LISTEN",
    "0B": "CLOSING",
}

_NON_DOMAIN_TLDS: frozenset[str] = frozenset(
    {
        "arpa",
        "local",
        "internal",
        "lan",
        "home",
        "so",
        "db",
        "txt",
        "log",
        "apk",
        "dex",
        "vdex",
        "odex",
        "art",
        "xml",
        "json",
        "ips",
        "bin",
        "png",
        "jpg",
        "jpeg",
        "webp",
        "pdf",
        "gif",
    }
)

_DOMAIN_RE = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,15}\b", re.IGNORECASE)
_ADMIN_COMPONENT_RE = re.compile(r"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+/[A-Za-z0-9_.$]+)")


def _decode_proc_hex_endpoint(hex_endpoint: str) -> tuple[str, int] | None:
    if ":" not in hex_endpoint:
        return None
    ip_hex, port_hex = hex_endpoint.split(":", 1)
    try:
        port = int(port_hex, 16)
        if len(ip_hex) == 8:
            b = bytes.fromhex(ip_hex)
            ip = f"{b[3]}.{b[2]}.{b[1]}.{b[0]}"
            return ip, port
        if len(ip_hex) == 32:
            raw = bytes.fromhex(ip_hex)
            words = [raw[i : i + 4][::-1] for i in range(0, 16, 4)]
            full = b"".join(words)
            if full[:12] == b"\x00" * 10 + b"\xff\xff":
                ip = f"{full[12]}.{full[13]}.{full[14]}.{full[15]}"
                return ip, port
            return str(ipaddress.IPv6Address(full)), port
    except (ValueError, IndexError):
        return None
    return None


def _is_public_routable_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
        return not (
            addr.is_loopback
            or addr.is_private
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_unspecified
            or addr.is_reserved
        )
    except ValueError:
        return False


def parse_kernel_network_sockets(proc_net_raw: str) -> list[dict]:
    """Decodifica /proc/net/tcp y /proc/net/tcp6 para extraer sockets salientes públicos."""
    sockets: list[dict] = []
    seen: set[str] = set()

    for line in (proc_net_raw or "").splitlines():
        parts = line.strip().split()
        if len(parts) < 4 or ":" not in parts[1] or ":" not in parts[2]:
            continue

        local_ep = _decode_proc_hex_endpoint(parts[1])
        remote_ep = _decode_proc_hex_endpoint(parts[2])
        state_hex = parts[3].upper()

        if not local_ep or not remote_ep:
            continue

        rem_ip, rem_port = remote_ep
        if rem_port == 0 or not _is_public_routable_ip(rem_ip):
            continue

        state_label = _TCP_STATES.get(state_hex, f"STATE_{state_hex}")
        key = f"{rem_ip}:{rem_port}:{state_label}"
        if key not in seen:
            seen.add(key)
            sockets.append(
                {
                    "local_port": local_ep[1],
                    "remote_ip": rem_ip,
                    "remote_port": rem_port,
                    "state": state_label,
                    "cti_match": False,
                    "spyware_family": None,
                }
            )

    return sockets


def annotate_sockets_with_cti(sockets: list[dict]) -> list[dict]:
    """Cruza IPs remotas de sockets activos contra el catálogo PostgreSQL de IOCs."""
    if not sockets:
        return sockets

    remote_ips = sorted({s["remote_ip"].lower() for s in sockets if s.get("remote_ip")})
    if not remote_ips:
        return sockets

    matched_map: dict[str, str] = {}
    try:
        with psycopg.connect(DB_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT i.ioc_value, COALESCE(c.spyware_family, 'Spyware')
                    FROM iocs i
                    LEFT JOIN campaigns c ON i.campaign_id = c.id
                    WHERE i.ioc_value = ANY(%s)
                      AND i.ioc_type IN ('ip', 'domain');
                    """,
                    (remote_ips,),
                )
                for ip_val, fam in cur.fetchall():
                    matched_map[str(ip_val).lower()] = str(fam)
    except psycopg.Error:
        return sockets

    for sock in sockets:
        fam = matched_map.get(sock["remote_ip"].lower())
        if fam:
            sock["cti_match"] = True
            sock["spyware_family"] = fam

    # Ordenar primero los sockets con coincidencia CTI
    sockets.sort(key=lambda s: (0 if s.get("cti_match") else 1, s.get("state") != "ESTABLISHED", s["remote_ip"]))
    return sockets


def parse_dns_resolver_cache(dns_dump_raw: str) -> list[str]:
    """Extrae dominios consultados recientemente desde dumpsys dnsresolver."""
    domains: set[str] = set()
    for match in _DOMAIN_RE.findall(dns_dump_raw or ""):
        dom = match.lower().rstrip(".")
        tld = dom.rsplit(".", 1)[-1]
        if tld in _NON_DOMAIN_TLDS:
            continue
        # Excluir artefactos numéricos tipo Android package build strings muy cortos sin subdominio real
        if any(part.isdigit() for part in dom.split(".")):
            # permitir dominios reales con números si tienen letras en el TLD-1
            sld = dom.split(".")[-2]
            if sld.isdigit():
                continue
        domains.add(dom)
    return sorted(domains)


def audit_device_admins(device_admins_raw: str) -> tuple[list[str], list[str]]:
    """Audita dumpsys device_policy e identifica administradores activos potencialmente abusivos."""
    if not device_admins_raw or not device_admins_raw.strip():
        return [], []

    admins: list[str] = []
    seen: set[str] = set()
    in_admin_section = False

    for raw_line in device_admins_raw.splitlines():
        line = raw_line.strip()
        low = line.lower()
        if "enabled device admins" in low or "active admins" in low or low.startswith("admin "):
            in_admin_section = True
        elif "profile owner" in low or "device owner" in low:
            in_admin_section = True

        if not in_admin_section:
            continue

        for comp in _ADMIN_COMPONENT_RE.findall(line):
            pkg = comp.split("/", 1)[0].strip()
            if pkg not in seen:
                seen.add(pkg)
                admins.append(comp)

    suspicious = [
        comp
        for comp in admins
        if not any(comp.lower().startswith(safe) for safe in KNOWN_SAFE_DEVICE_ADMIN_PREFIXES)
    ]
    return admins, suspicious


def inspect_ios_manifest_db(filename: str, raw_bytes: bytes) -> list[dict[str, Any]]:
    """Analiza Manifest.db de un backup iOS en RAM buscando staging de Pegasus y adjuntos zero-click."""
    if len(raw_bytes) < 16 or not raw_bytes.startswith(b"SQLite format 3\x00"):
        return []

    findings: list[dict[str, Any]] = []
    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(":memory:")
        conn.deserialize(raw_bytes)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Files';")
        if not cur.fetchone():
            return []

        cur.execute("SELECT fileID, domain, relativePath FROM Files;")
        for file_id, domain, rel_path in cur.fetchall():
            path_str = str(rel_path or "")
            path_low = path_str.lower()
            if not path_low:
                continue

            if any(
                susp in path_low
                for susp in (
                    "var/tmp/",
                    "/tmp/",
                    "/var/db/",
                    "roleabout",
                    "pcsd",
                    "ckdiscretionaryd",
                    "bridgepd",
                    "var/logs/keybagd",
                )
            ):
                findings.append(
                    {
                        "severity": "CRITICAL",
                        "category": "IOS_MANIFEST_ANOMALY",
                        "indicator": f"{domain} -> {path_str}",
                        "artifact": filename,
                        "detail": (
                            f"Archivo respaldado en ruta no estándar (fileID: {file_id}). "
                            "Patrón asociado a staging volátil de Pegasus/Predator en Manifest.db."
                        ),
                    }
                )
            elif "sms/attachments" in path_low and path_low.endswith((".pkpass", ".webp", ".gif")):
                findings.append(
                    {
                        "severity": "HIGH",
                        "category": "ZERO_CLICK_ATTACHMENT_MANIFEST",
                        "indicator": path_str,
                        "artifact": filename,
                        "detail": (
                            f"Adjunto sospechoso tipo PassKit/WebP/GIF en historial SMS/iMessage "
                            f"(fileID: {file_id}, candidato FORCEDENTRY/BLASTPASS)."
                        ),
                    }
                )
    except (sqlite3.Error, ValueError):
        return []
    finally:
        if conn is not None:
            conn.close()

    return findings


def extract_ios_manifest_targets(raw_bytes: bytes, limit: int = 35) -> dict[str, Any]:
    """Inspecciona Manifest.db en RAM para localizar fileIDs forenses (SMS, Safari, TCC, DataUsage, crashes) sin leer medios personales."""
    if len(raw_bytes) < 16 or not raw_bytes.startswith(b"SQLite format 3\x00"):
        return {
            "encrypted": True,
            "total_files": 0,
            "targets": [],
            "detail": "Manifest.db está cifrado por iOS (sin cabecera SQLite en claro). Desencripta el backup primero con mvt-ios decrypt-backup o analiza un sysdiagnose.",
        }

    conn: sqlite3.Connection | None = None
    targets: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    total_files = 0
    try:
        conn = sqlite3.connect(":memory:")
        conn.deserialize(raw_bytes)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Files';")
        if not cur.fetchone():
            return {
                "encrypted": False,
                "total_files": 0,
                "targets": [],
                "detail": "La base SQLite no contiene la tabla Files esperada de un Manifest.db de iOS.",
            }

        cur.execute("SELECT COUNT(*) FROM Files;")
        row_cnt = cur.fetchone()
        total_files = int(row_cnt[0]) if row_cnt else 0

        cur.execute(
            """
            SELECT fileID, domain, relativePath
            FROM Files
            WHERE relativePath IS NOT NULL AND relativePath != ''
              AND (
                LOWER(relativePath) LIKE '%sms.db'
                OR LOWER(relativePath) LIKE '%history.db'
                OR LOWER(relativePath) LIKE '%datausage.sqlite'
                OR LOWER(relativePath) LIKE '%netusage.sqlite'
                OR LOWER(relativePath) LIKE '%tcc.db'
                OR LOWER(relativePath) LIKE '%shutdown.log%'
                OR LOWER(relativePath) LIKE '%.ips'
                OR LOWER(relativePath) LIKE '%.crash'
                OR LOWER(relativePath) LIKE '%var/tmp/%'
                OR LOWER(relativePath) LIKE '%/tmp/%'
                OR LOWER(relativePath) LIKE '%roleabout%'
                OR LOWER(relativePath) LIKE '%pcsd%'
                OR LOWER(relativePath) LIKE '%ckdiscretionaryd%'
                OR LOWER(relativePath) LIKE '%bridgepd%'
                OR LOWER(relativePath) LIKE '%.pkpass'
                OR LOWER(relativePath) LIKE '%configurationprofiles%'
                OR LOWER(relativePath) LIKE '%.mobileconfig'
                OR LOWER(relativePath) LIKE '%currentpowerlog.plsql%'
                OR LOWER(relativePath) LIKE '%powerlog%.sql%'
              )
            LIMIT ?;
            """,
            (max(1, min(limit, 60)),),
        )
        for file_id, domain, rel_path in cur.fetchall():
            fid = str(file_id or "").strip()
            if not fid or fid in seen_ids:
                continue
            seen_ids.add(fid)
            targets.append(
                {
                    "file_id": fid,
                    "domain": str(domain or ""),
                    "relative_path": str(rel_path or ""),
                }
            )
    except (sqlite3.Error, ValueError) as exc:
        return {
            "encrypted": True,
            "total_files": 0,
            "targets": [],
            "detail": f"No se pudo abrir Manifest.db en RAM ({exc}).",
        }
    finally:
        if conn is not None:
            conn.close()

    return {
        "encrypted": False,
        "total_files": total_files,
        "targets": targets,
        "detail": f"Manifest.db indexa {total_files} entradas; {len(targets)} artefacto(s) forense(s) seleccionado(s).",
    }


def _load_db_yara_iocs() -> list[tuple[bytes, str, str, str]]:
    """Carga IOCs de cadena y red desde PostgreSQL para caza binaria en RAM."""
    records: list[tuple[bytes, str, str, str]] = []
    try:
        with psycopg.connect(DB_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT ON (i.ioc_value, c.spyware_family)
                        i.ioc_value,
                        i.ioc_type,
                        COALESCE(c.spyware_family, 'Spyware'),
                        r.title
                    FROM iocs i
                    JOIN reports r ON i.report_id = r.id
                    LEFT JOIN campaigns c ON i.campaign_id = c.id
                    WHERE i.ioc_type IN ('domain', 'url', 'process', 'package', 'ip', 'file_path')
                      AND LENGTH(i.ioc_value) >= 7
                    ORDER BY i.ioc_value, c.spyware_family
                    LIMIT 3500;
                    """
                )
                for val, ioc_type, fam, title in cur.fetchall():
                    clean_val = str(val).strip().lower()
                    if clean_val:
                        records.append((clean_val.encode("utf-8", errors="ignore"), str(ioc_type), str(fam), str(title)))
    except psycopg.Error:
        pass
    return records


def run_live_yara_hunt(artifacts: list[dict]) -> list[dict]:
    """Ejecuta caza de firmas YARA reales (yara-python + IOCs de PostgreSQL) en RAM."""
    from yara_engine import scan_artifacts_with_yara

    return scan_artifacts_with_yara(artifacts)


def build_adb_artifacts_in_ram(snapshot: dict[str, Any]) -> list[dict]:
    """Estandariza telemetría viva USB (Android ADB o iOS USB/Backup) en memoria RAM (Capa 2)."""
    artifacts: list[dict] = []
    device = dict(snapshot.get("device") or {})
    if snapshot.get("platform") and "platform" not in device:
        device["platform"] = str(snapshot.get("platform")).lower()
    if device:
        artifacts.append(
            {
                "filename": "adb_device_posture.json",
                "bytes": json.dumps(device, ensure_ascii=False).encode("utf-8"),
            }
        )

    mapping = [
        ("device_admins_raw", "adb_device_policy.txt"),
        ("packages_text", "adb_installed_packages.txt"),
        ("processes_text", "adb_running_processes.txt"),
        ("proc_net_raw", "adb_proc_net_tcp.txt"),
        ("dns_resolver_raw", "adb_dnsresolver.txt"),
    ]
    for field_name, fname in mapping:
        raw_text = str(snapshot.get(field_name) or "").strip()
        if raw_text:
            artifacts.append({"filename": fname, "bytes": raw_text.encode("utf-8")})

    for idx, item in enumerate((snapshot.get("crashlogs") or [])[:60]):
        if not isinstance(item, dict):
            continue
        fname = str(item.get("filename") or f"crashlog_{idx}.ips").strip()
        if item.get("content_b64"):
            try:
                raw_b = base64.b64decode(str(item["content_b64"]), validate=False)
                if raw_b:
                    artifacts.append({"filename": fname, "bytes": raw_b})
            except ValueError:
                continue
        else:
            raw_text = str(item.get("content") or "")
            if raw_text.strip():
                artifacts.append({"filename": fname, "bytes": raw_text.encode("utf-8", errors="ignore")})

    for idx, item in enumerate((snapshot.get("binary_artifacts") or [])[:45]):
        if not isinstance(item, dict):
            continue
        fname = str(item.get("filename") or f"ios_artifact_{idx}.bin").strip()
        b64 = item.get("content_b64")
        if not b64:
            continue
        try:
            raw_b = base64.b64decode(str(b64), validate=False)
            if raw_b:
                artifacts.append({"filename": fname, "bytes": raw_b})
        except ValueError:
            continue

    return artifacts


def _evaluate_ios_posture(dev: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    """Evalúa postura defensiva de iPhone/iPad (versión iOS, cifrado de backup, modo desarrollador y Lockdown)."""
    hardening_checks: list[dict] = []
    abuse_alerts: list[dict] = []

    ios_ver = str(dev.get("ios_version") or "").strip()
    build_ver = str(dev.get("build_version") or "").strip()
    major = 0
    if ios_ver:
        try:
            major = int(ios_ver.split(".", 1)[0])
        except ValueError:
            major = 0

    if ios_ver:
        outdated = major > 0 and major < 17
        hardening_checks.append(
            {
                "control": "Versión de sistema iOS y parches",
                "status": "WARN" if outdated else "OK",
                "value": f"iOS {ios_ver}" + (f" ({build_ver})" if build_ver else ""),
                "detail": (
                    "Versión heredada con mayor exposición histórica a cadenas 0-click WebKit/IMTranscoderAgent/PassKit."
                    if outdated
                    else "Rama iOS moderna; verifica en Ajustes tener el último parche de seguridad rápido."
                ),
            }
        )
    else:
        hardening_checks.append(
            {
                "control": "Versión de sistema iOS y parches",
                "status": "UNKNOWN",
                "value": "N/D",
                "detail": "No se pudo leer la versión exacta de iOS desde Lockdown.",
            }
        )

    will_encrypt = dev.get("backup_encrypted")
    if will_encrypt is True or str(will_encrypt).lower() in ("true", "1"):
        hardening_checks.append(
            {
                "control": "Cifrado de respaldo local iOS",
                "status": "OK",
                "value": "Cifrado activo",
                "detail": "Los respaldos USB locales incluyen bases completas protegidas mediante contraseña.",
            }
        )
    elif will_encrypt is False or str(will_encrypt).lower() in ("false", "0"):
        hardening_checks.append(
            {
                "control": "Cifrado de respaldo local iOS",
                "status": "WARN",
                "value": "Sin cifrar",
                "detail": "Respaldo USB sin contraseña: Apple excluye ciertos llaveros y deja bases locales legibles en PC.",
            }
        )

    dev_mode = dev.get("developer_mode")
    if dev_mode is True or str(dev_mode).lower() in ("true", "1", "enabled"):
        hardening_checks.append(
            {
                "control": "Modo Desarrollador (iOS Developer Mode)",
                "status": "WARN",
                "value": "Habilitado",
                "detail": "Amplía la superficie de ejecución local; desactívalo si no desarrollas apps en este dispositivo.",
            }
        )
        abuse_alerts.append(
            {
                "severity": "HIGH",
                "category": "Superficie USB/Depuración Ampliada",
                "indicator": "DeveloperModeStatus = true",
                "detail": "El Modo Desarrollador está habilitado en el iPhone; confirma si fue autorizado intencionalmente.",
            }
        )
    elif dev_mode is False or str(dev_mode).lower() in ("false", "0", "disabled"):
        hardening_checks.append(
            {
                "control": "Modo Desarrollador (iOS Developer Mode)",
                "status": "OK",
                "value": "Desactivado",
                "detail": "Superficie de depuración y carga lateral restringida por el sistema.",
            }
        )

    hardening_checks.append(
        {
            "control": "Arquitectura iOS y alcance USB (Lockdown)",
            "status": "OK",
            "value": str(dev.get("model") or "iPhone/iPad").strip(),
            "detail": (
                "Sin jailbreak, iOS bloquea acceso shell/kernel tipo ADB; OMEGA evalúa postura Lockdown, crashlogs .ips/.crash "
                "y artefactos de respaldo (Manifest.db, TCC.db, DataUsage.sqlite). Activa Modo de Aislamiento si eres objetivo de riesgo."
            ),
        }
    )

    return hardening_checks, abuse_alerts


def evaluate_device_posture(dev: dict[str, Any], device_admins_raw: str) -> tuple[list[dict], list[dict]]:
    """Evalúa postura defensiva móvil (Android ADB o iOS Lockdown/Backup)."""
    if str(dev.get("platform") or "").strip().lower() == "ios":
        return _evaluate_ios_posture(dev)

    hardening_checks: list[dict] = []
    abuse_alerts: list[dict] = []

    # 1. Integridad SELinux y Verified Boot
    selinux = str(dev.get("selinux_status") or "Unknown").strip()
    boot_state = str(dev.get("verified_boot_state") or "unknown").strip().lower()
    selinux_ok = selinux.lower() == "enforcing"
    boot_ok = boot_state in ("green", "unknown", "")
    hardening_checks.append(
        {
            "control": "Integridad SELinux y Verified Boot",
            "status": "OK" if (selinux_ok and boot_ok) else "CRITICAL",
            "value": f"SELinux: {selinux} · Boot: {boot_state or 'N/D'}",
            "detail": (
                "Aislamiento obligatorio del kernel y arranque verificado intactos."
                if (selinux_ok and boot_ok)
                else "SELinux en modo Permissive o bootloader alterado; riesgo de manipulación de kernel/rootkit."
            ),
        }
    )

    # 2. Auditoría de nivel de parche de seguridad Android
    patch_str = str(dev.get("security_patch") or "").strip()
    try:
        patch_date = datetime.strptime(patch_str, "%Y-%m-%d")
        age_days = (datetime.now() - patch_date).days
        patch_outdated = age_days > 120
        hardening_checks.append(
            {
                "control": "Nivel de parche de seguridad",
                "status": "WARN" if patch_outdated else "OK",
                "value": patch_str,
                "detail": (
                    f"Parche con {age_days} días de antigüedad; expuesto a vectores 0-click/1-click conocidos."
                    if patch_outdated
                    else f"Parche actualizado ({patch_str})."
                ),
            }
        )
    except ValueError:
        hardening_checks.append(
            {
                "control": "Nivel de parche de seguridad",
                "status": "UNKNOWN",
                "value": patch_str or "N/D",
                "detail": "No se pudo determinar la fecha exacta del parche.",
            }
        )

    # 3. Servicios de Accesibilidad Activos (vector crítico de robo de mensajería y permisos en Android)
    acc_raw = str(dev.get("accessibility_services") or "null").strip()
    if acc_raw and acc_raw.lower() not in ("null", "none", ""):
        services = [s.strip() for s in acc_raw.split(":") if s.strip()]
        suspicious_acc = [
            s for s in services if not any(s.lower().startswith(safe) for safe in KNOWN_SAFE_ACCESSIBILITY_PREFIXES)
        ]
        for svc in suspicious_acc:
            abuse_alerts.append(
                {
                    "severity": "HIGH",
                    "category": "Abuso Potencial de Accesibilidad",
                    "indicator": svc,
                    "detail": "Permite leer contenido en pantalla (WhatsApp/Signal) y automatizar toques sin interacción.",
                }
            )
        hardening_checks.append(
            {
                "control": "Servicios de Accesibilidad Activos",
                "status": "WARN" if suspicious_acc else "OK",
                "value": f"{len(services)} activos ({len(suspicious_acc)} terceros)",
                "detail": (
                    f"Servicios de terceros activos: {', '.join(suspicious_acc)}"
                    if suspicious_acc
                    else "Solo servicios oficiales del sistema habilitados."
                ),
            }
        )
    else:
        hardening_checks.append(
            {
                "control": "Servicios de Accesibilidad Activos",
                "status": "OK",
                "value": "Ninguno",
                "detail": "Sin servicios de lectura de pantalla de terceros habilitados.",
            }
        )

    # 4. Administradores de Dispositivo (dumpsys device_policy)
    admins, suspicious_admins = audit_device_admins(device_admins_raw)
    if device_admins_raw.strip():
        for adm in suspicious_admins:
            abuse_alerts.append(
                {
                    "severity": "HIGH",
                    "category": "Administrador de Dispositivo (Device Admin)",
                    "indicator": adm,
                    "detail": "Privilegio elevado capaz de bloquear desinstalación, imponer políticas o borrar datos.",
                }
            )
        hardening_checks.append(
            {
                "control": "Administradores de Dispositivo",
                "status": "WARN" if suspicious_admins else "OK",
                "value": f"{len(admins)} activos ({len(suspicious_admins)} terceros)" if admins else "Solo sistema",
                "detail": (
                    f"Administradores externos detectados: {', '.join(suspicious_admins)}"
                    if suspicious_admins
                    else "Sin administradores de terceros anómalos en device_policy."
                ),
            }
        )

    # 5. DNS Privado Cifrado (DoT — mitigación en 1 clic)
    dns_mode = str(dev.get("private_dns_mode") or "off").strip().lower()
    dns_host = str(dev.get("private_dns_specifier") or "").strip()
    dns_ok = dns_mode == "hostname" and bool(dns_host) and dns_host.lower() != "null"
    hardening_checks.append(
        {
            "control": "DNS Privado Cifrado (DNS-over-TLS)",
            "status": "OK" if dns_ok else "WARN",
            "value": dns_host if dns_ok else dns_mode,
            "detail": (
                f"Resoluciones DNS cifradas mediante {dns_host}."
                if dns_ok
                else "DNS sin cifrar; expuesto a secuestro DNS o inyección de red en tránsito (mitigable en 1 clic)."
            ),
        }
    )

    # 6. Orígenes desconocidos (sideloading APK legacy)
    unknown_src = str(dev.get("install_non_market_apps") or "").strip().lower()
    if unknown_src:
        hardening_checks.append(
            {
                "control": "Instalación desde orígenes desconocidos",
                "status": "WARN" if unknown_src == "1" else "OK",
                "value": (
                    "Habilitado"
                    if unknown_src == "1"
                    else ("Desactivado" if unknown_src == "0" else "Control por app (Android 8+)")
                ),
                "detail": (
                    "Permite instalar APKs fuera de Google Play; vector común en implantes 1-click Android."
                    if unknown_src == "1"
                    else "Sin habilitación global de sideloading legacy."
                ),
            }
        )

    return hardening_checks, abuse_alerts


def run_kernel_and_posture_forensics(expanded_artifacts: list[dict]) -> dict[str, Any]:
    """Extrae postura de dispositivo, sockets /proc/net/tcp* y caché DNS desde artefactos en RAM."""
    device_summary: dict[str, Any] = {}
    device_admins_raw = ""
    proc_net_chunks: list[str] = []
    dns_chunks: list[str] = []

    for art in expanded_artifacts:
        fname = str(art.get("filename") or "").lower()
        raw_bytes: bytes = art.get("bytes") or b""
        if not raw_bytes or raw_bytes.startswith(b"SQLite format 3\x00"):
            continue
        text = raw_bytes.decode("utf-8", errors="ignore")

        if fname.endswith("adb_device_posture.json") or fname.endswith("device_posture.json"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    device_summary = parsed
            except json.JSONDecodeError:
                pass
        elif "device_policy" in fname or "device_admins" in fname:
            device_admins_raw = f"{device_admins_raw}\n{text}".strip()
        elif "proc_net" in fname or "net_tcp" in fname or "tcp_sockets" in fname:
            proc_net_chunks.append(text)
        elif "dnsresolver" in fname or "dns_cache" in fname:
            dns_chunks.append(text)

    hardening_checks: list[dict] = []
    abuse_alerts: list[dict] = []
    if device_summary or device_admins_raw:
        hardening_checks, abuse_alerts = evaluate_device_posture(device_summary, device_admins_raw)

    live_sockets = (
        annotate_sockets_with_cti(parse_kernel_network_sockets("\n".join(proc_net_chunks)))
        if proc_net_chunks
        else []
    )
    cached_dns_domains = parse_dns_resolver_cache("\n".join(dns_chunks)) if dns_chunks else []

    for sock in live_sockets:
        if sock.get("cti_match"):
            abuse_alerts.append(
                {
                    "severity": "CRITICAL",
                    "category": "Socket Vivo a Infraestructura C2",
                    "indicator": f"{sock['remote_ip']}:{sock['remote_port']} ({sock['state']})",
                    "detail": f"Conexión kernel activa contra IP asociada a {sock.get('spyware_family') or 'spyware'}.",
                }
            )

    return {
        "device_summary": device_summary,
        "hardening_checks": hardening_checks,
        "abuse_alerts": abuse_alerts,
        "live_sockets": live_sockets,
        "cached_dns_domains": cached_dns_domains,
    }

