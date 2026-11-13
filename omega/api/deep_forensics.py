"""Motor forense profundo en RAM (Kernel Android, Accessibility/DeviceAdmin, iOS Manifest.db y Caza YARA).

Opera íntegramente en memoria volátil (RNF4) sin persistencia en disco ni root en el dispositivo.
"""

from __future__ import annotations

import ipaddress
import re
import sqlite3
from typing import Any
import psycopg
from stix_ingestor import DB_DSN

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
    """Ejecuta caza de firmas YARA defensivas (reglas conductuales + IOCs de PostgreSQL) en RAM."""
    if not artifacts:
        return []

    hits: list[dict] = []
    seen_hits: set[tuple[str, str, str]] = set()
    db_iocs = _load_db_yara_iocs()

    for art in artifacts:
        fname = str(art.get("filename") or "artifact.bin")
        blob: bytes = art.get("bytes") or b""
        if not blob:
            continue
        blob_low = blob.lower()

        # 1. Reglas estructurales de explotación (JBIG2, PassKit/WebP, rutas volátiles, Predator/Alien)
        for sig in BUILTIN_DETECTION_SIGNATURES:
            matched_tokens = [
                p.decode("utf-8", errors="ignore")
                for p in sig["byte_patterns"]
                if p.lower() in blob_low
            ]
            if len(matched_tokens) >= sig["min_matches"]:
                dedup_key = (sig["rule"], fname, ",".join(matched_tokens))
                if dedup_key not in seen_hits:
                    seen_hits.add(dedup_key)
                    hits.append(
                        {
                            "rule_name": sig["rule"],
                            "spyware_family": sig["family"],
                            "cve": sig["cve"],
                            "artifact": fname,
                            "matched_strings": matched_tokens,
                            "description": sig["description"],
                        }
                    )

        # 2. Caza binaria directa contra IOCs reales del corpus STIX2/CTI en PostgreSQL
        art_db_hits = 0
        for pattern_bytes, ioc_type, fam, rep_title in db_iocs:
            idx = blob_low.find(pattern_bytes)
            if idx == -1:
                continue

            # Para direcciones IPv4 o procesos cortos, exigir límites de palabra para evitar falsos positivos
            if ioc_type in ("ip", "process"):
                before_ok = idx == 0 or not (48 <= blob_low[idx - 1] <= 57 or 97 <= blob_low[idx - 1] <= 122)
                after_pos = idx + len(pattern_bytes)
                after_ok = after_pos >= len(blob_low) or not (
                    48 <= blob_low[after_pos] <= 57 or 97 <= blob_low[after_pos] <= 122
                )
                if not (before_ok and after_ok):
                    continue

            ioc_str = pattern_bytes.decode("utf-8", errors="ignore")
            dedup_key = ("Omega_Dynamic_CTI_IOC_Hunt", fname, ioc_str)
            if dedup_key in seen_hits:
                continue
            seen_hits.add(dedup_key)

            hits.append(
                {
                    "rule_name": "Omega_Dynamic_CTI_IOC_Hunt",
                    "spyware_family": fam,
                    "cve": f"IOC ({ioc_type})",
                    "artifact": fname,
                    "matched_strings": [ioc_str],
                    "description": f"Firma coincidente con indicador '{ioc_str}' documentado en '{rep_title}'.",
                }
            )
            art_db_hits += 1
            if art_db_hits >= 15:
                break

    return hits
