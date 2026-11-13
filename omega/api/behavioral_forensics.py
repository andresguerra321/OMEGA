"""Motor forense conductual en RAM (RNF4) para detección sin IOCs públicos conocidos.

Analiza artefactos de sistema (sysdiagnose / volcados MVT / SQLite / crashlogs)
íntegramente en memoria volátil sin escribir bytes en disco.
"""

from __future__ import annotations

import io
import json
import posixpath
import re
import sqlite3
import tarfile
import zipfile
from typing import Any

# Rutas de ejecución anómalas usadas frecuentemente por implantes móviles (iOS / Android)
SUSPICIOUS_EXEC_PREFIXES: tuple[str, ...] = (
    "/private/var/tmp/",
    "/var/tmp/",
    "/private/var/db/",
    "/var/db/",
    "/tmp/",
    "/data/local/tmp/",
    "/dev/shm/",
)

# Nombres de procesos históricamente suplantados o abusados por Pegasus / Predator / Trident
PEGASUS_IMPERSONATED_PROCESSES: frozenset[str] = frozenset(
    {
        "bh",
        "roleabout",
        "pcsd",
        "ckdiscretionaryd",
        "absd",
        "fmfd",
        "fseventsd",
        "otatool",
        "gatekeeperd",
        "neagent",
        "wifid",
        "librarian",
        "staging",
    }
)

# Daemons de sistema objetivo frecuente de exploits 0-click (iMessage, CoreMedia, WebKit, Mail)
ZERO_CLICK_CRASH_TARGETS: dict[str, str] = {
    "imtranscoderagent": "Procesamiento multimedia iMessage (objetivo FORCEDENTRY / BLASTPASS)",
    "blastdoor": "Sandbox de análisis de mensajes entrantes (iMessage 0-click)",
    "imagent": "Daemon de recepción iMessage / FaceTime",
    "mobilemail": "Cliente Mail iOS (objetivo campañas Trident / Pegasus)",
    "mediaserverd": "Daemon CoreMedia / audio-video (objetivo exploits multimedia)",
    "audiomxd": "Daemon de mezcla de audio CoreAudio",
    "webkit": "Motor WebKit / Safari content process",
    "webcontent": "Proceso aislado de renderizado WebKit",
    "com.apple.webkit.webcontent": "Proceso de contenido WebKit (1-click / 0-click)",
    "springboard": "Gestor de interfaz iOS",
}

RELEVANT_ARCHIVE_SUFFIXES: tuple[str, ...] = (
    ".json",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".txt",
    ".log",
    ".ips",
    ".crash",
)

_RELEVANT_ARCHIVE_KEYWORDS: tuple[str, ...] = (
    "datausage",
    "netusage",
    "tcc",
    "shutdown",
    "safari",
    "sms",
    "manifest",
    "ps",
    "crash",
)

_SENSITIVE_TCC_SERVICES: tuple[str, ...] = (
    "microphone",
    "camera",
    "location",
    "addressbook",
    "photos",
    "screencapture",
    "listen",
    "allfiles",
)

MAX_ARCHIVED_FILES = 40
MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024  # 25 MB por artefacto
MAX_TOTAL_EXTRACTED_BYTES = 100 * 1024 * 1024  # 100 MB totales en RAM
DATA_USAGE_THRESHOLD_BYTES = 50 * 1024  # 50 KB salientes anómalos

_SUSPICIOUS_PATH_REGEX = re.compile(
    r"(?<![A-Za-z0-9_])("
    + "|".join(re.escape(p) for p in SUSPICIOUS_EXEC_PREFIXES)
    + r")[A-Za-z0-9._/\-]{1,160}"
)
_BUNDLE_ID_REGEX = re.compile(r"^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+){1,}$")
_MEMORY_CORRUPTION_REGEX = re.compile(
    r"exc_bad_access|sigsegv|sigbus|kern_invalid_address|pac\s*failure|exc_crash|brk\s*0x",
    re.IGNORECASE,
)

_SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


def _safe_archive_member_name(archive_name: str, member_name: str) -> str:
    clean = member_name.replace("\\", "/").lstrip("/")
    normalized = posixpath.normpath(clean)
    parts = [p for p in normalized.split("/") if p not in ("", ".", "..")]
    rel = "/".join(parts) if parts else posixpath.basename(archive_name)
    return f"{archive_name}/{rel}"


def _is_relevant_member(member_name: str, size: int) -> bool:
    if size <= 0 or size > MAX_SINGLE_FILE_BYTES:
        return False
    lower = member_name.lower()
    base = lower.rsplit("/", 1)[-1]
    if base.startswith("._") or "/__macosx/" in lower:
        return False
    if lower.endswith(RELEVANT_ARCHIVE_SUFFIXES):
        return True
    return any(kw in base for kw in _RELEVANT_ARCHIVE_KEYWORDS)


def _extract_tar_in_ram(
    archive_name: str, raw_bytes: bytes, total_budget: list[int]
) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []
    mode = "r:gz" if archive_name.lower().endswith((".tar.gz", ".tgz")) else "r:*"
    try:
        with tarfile.open(fileobj=io.BytesIO(raw_bytes), mode=mode) as tf:
            for member in tf.getmembers():
                if len(extracted) >= MAX_ARCHIVED_FILES or total_budget[0] >= MAX_TOTAL_EXTRACTED_BYTES:
                    break
                if not member.isfile():
                    continue
                if not _is_relevant_member(member.name, member.size):
                    continue
                if total_budget[0] + member.size > MAX_TOTAL_EXTRACTED_BYTES:
                    continue
                fobj = tf.extractfile(member)
                if fobj is None:
                    continue
                data = fobj.read(MAX_SINGLE_FILE_BYTES + 1)
                if not data or len(data) > MAX_SINGLE_FILE_BYTES:
                    continue
                total_budget[0] += len(data)
                extracted.append(
                    {
                        "filename": _safe_archive_member_name(archive_name, member.name),
                        "bytes": data,
                    }
                )
    except (tarfile.TarError, EOFError, OSError):
        return []
    return extracted


def _extract_zip_in_ram(
    archive_name: str, raw_bytes: bytes, total_budget: list[int]
) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            for info in zf.infolist():
                if len(extracted) >= MAX_ARCHIVED_FILES or total_budget[0] >= MAX_TOTAL_EXTRACTED_BYTES:
                    break
                if info.is_dir() or info.flag_bits & 0x1:
                    continue
                if not _is_relevant_member(info.filename, info.file_size):
                    continue
                if total_budget[0] + info.file_size > MAX_TOTAL_EXTRACTED_BYTES:
                    continue
                with zf.open(info, "r") as zmember:
                    data = zmember.read(MAX_SINGLE_FILE_BYTES + 1)
                if not data or len(data) > MAX_SINGLE_FILE_BYTES:
                    continue
                total_budget[0] += len(data)
                extracted.append(
                    {
                        "filename": _safe_archive_member_name(archive_name, info.filename),
                        "bytes": data,
                    }
                )
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError):
        return []
    return extracted


def unpack_forensic_archives_in_ram(artifacts: list[dict]) -> list[dict]:
    """Desempaqueta .tar.gz / .tgz / .tar / .zip en memoria volátil (0 bytes en disco)."""
    resolved: list[dict[str, Any]] = []
    budget = [0]

    for item in artifacts:
        filename = str(item.get("filename") or "artifact")
        raw_bytes = item.get("bytes") or b""
        lower = filename.lower()

        if lower.endswith((".tar.gz", ".tgz", ".tar")):
            members = _extract_tar_in_ram(filename, raw_bytes, budget)
            if members:
                resolved.extend(members)
                continue
        elif lower.endswith(".zip"):
            members = _extract_zip_in_ram(filename, raw_bytes, budget)
            if members:
                resolved.extend(members)
                continue

        resolved.append({"filename": filename, "bytes": raw_bytes})

    return resolved


def _get_table_map(conn: sqlite3.Connection) -> dict[str, str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {str(r[0]).lower(): str(r[0]) for r in rows if r and r[0]}


def _get_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f'PRAGMA table_info("{table_name}")').fetchall()
    return {str(r[1]).lower() for r in rows if len(r) > 1 and r[1]}


def _inspect_datausage_sqlite(
    conn: sqlite3.Connection, tables: dict[str, str], filename: str
) -> list[dict[str, Any]]:
    anomalies: list[dict[str, Any]] = []
    if "zprocess" not in tables or "zliveusage" not in tables:
        return anomalies

    zproc_tbl = tables["zprocess"]
    zlive_tbl = tables["zliveusage"]
    p_cols = _get_columns(conn, zproc_tbl)
    l_cols = _get_columns(conn, zlive_tbl)

    if "z_pk" not in p_cols or "zprocname" not in p_cols or "zhasprocess" not in l_cols:
        return anomalies

    bundle_expr = "p.ZBUNDLENAME" if "zbundlename" in p_cols else "NULL"
    wifi_out = "COALESCE(l.ZWIFIOUT, 0)" if "zwifiout" in l_cols else "0"
    wwan_out = "COALESCE(l.ZWWANOUT, 0)" if "zwwanout" in l_cols else "0"
    wifi_in = "COALESCE(l.ZWIFIIN, 0)" if "zwifiin" in l_cols else "0"
    wwan_in = "COALESCE(l.ZWWANIN, 0)" if "zwwanin" in l_cols else "0"

    sql = f"""
        SELECT
            p.ZPROCNAME,
            {bundle_expr} AS bundle_name,
            SUM({wifi_out} + {wwan_out}) AS total_out,
            SUM({wifi_in} + {wwan_in}) AS total_in
        FROM "{zproc_tbl}" p
        JOIN "{zlive_tbl}" l ON l.ZHASPROCESS = p.Z_PK
        GROUP BY p.ZPROCNAME, bundle_name
    """
    for proc_raw, bundle_raw, total_out, total_in in conn.execute(sql).fetchall():
        proc_str = str(proc_raw or "").strip()
        bundle_str = str(bundle_raw or "").strip()
        if not proc_str:
            continue

        proc_base = proc_str.replace("\\", "/").rsplit("/", 1)[-1].lower()
        out_bytes = int(total_out or 0)
        in_bytes = int(total_in or 0)
        out_kb = round(out_bytes / 1024, 1)
        in_kb = round(in_bytes / 1024, 1)

        if any(proc_str.startswith(prefix) for prefix in SUSPICIOUS_EXEC_PREFIXES):
            anomalies.append(
                {
                    "category": "ANOMALOUS_DATA_USAGE",
                    "severity": "CRITICAL",
                    "indicator": proc_str,
                    "artifact": filename,
                    "detail": (
                        f"Proceso registrado en DataUsage con ruta temporal/no estándar "
                        f"({out_kb} KB salientes / {in_kb} KB entrantes)."
                    ),
                }
            )
            continue

        if proc_base in PEGASUS_IMPERSONATED_PROCESSES and out_bytes > DATA_USAGE_THRESHOLD_BYTES:
            bundle_note = f" (bundle `{bundle_str}`)" if bundle_str else ""
            anomalies.append(
                {
                    "category": "ANOMALOUS_DATA_USAGE",
                    "severity": "CRITICAL",
                    "indicator": proc_base,
                    "artifact": filename,
                    "detail": (
                        f"Proceso suplantable `{proc_base}`{bundle_note} registró tráfico saliente "
                        f"anómalo en netusage/DataUsage: {out_kb} KB salientes ({in_kb} KB entrantes)."
                    ),
                }
            )

    return anomalies


def _inspect_tcc_sqlite(
    conn: sqlite3.Connection, tables: dict[str, str], filename: str
) -> list[dict[str, Any]]:
    anomalies: list[dict[str, Any]] = []
    if "access" not in tables:
        return anomalies

    acc_tbl = tables["access"]
    cols = _get_columns(conn, acc_tbl)
    if "service" not in cols or "client" not in cols:
        return anomalies

    if "auth_value" in cols:
        grant_filter = "auth_value = 2"
        select_grant = "auth_value"
    elif "allowed" in cols:
        grant_filter = "allowed = 1"
        select_grant = "allowed"
    else:
        return anomalies

    sql = f'SELECT service, client, {select_grant} FROM "{acc_tbl}" WHERE {grant_filter}'
    for service_raw, client_raw, _grant_val in conn.execute(sql).fetchall():
        service = str(service_raw or "").strip()
        client = str(client_raw or "").strip()
        if not service or not client:
            continue

        svc_lower = service.lower()
        if not any(s in svc_lower for s in _SENSITIVE_TCC_SERVICES):
            continue

        client_lower = client.lower()
        client_base = client.replace("\\", "/").rsplit("/", 1)[-1].lower()
        is_suspicious_path = any(client.startswith(p) for p in SUSPICIOUS_EXEC_PREFIXES)
        is_impersonated = client_base in PEGASUS_IMPERSONATED_PROCESSES
        is_raw_path = client.startswith("/")
        is_standard_bundle = bool(_BUNDLE_ID_REGEX.match(client))

        if is_suspicious_path or is_impersonated:
            anomalies.append(
                {
                    "category": "SILENT_TCC_PERMISSION",
                    "severity": "CRITICAL",
                    "indicator": f"{service} -> {client}",
                    "artifact": filename,
                    "detail": (
                        f"Permiso TCC concedido (`{service}`) a binario sospechoso o suplantado "
                        f"`{client}` sin identificador bundle legítimo."
                    ),
                }
            )
        elif (is_raw_path or not is_standard_bundle) and not client_lower.startswith("com.apple."):
            anomalies.append(
                {
                    "category": "SILENT_TCC_PERMISSION",
                    "severity": "HIGH",
                    "indicator": f"{service} -> {client}",
                    "artifact": filename,
                    "detail": (
                        f"Acceso TCC otorgado (`{service}`) a cliente no estándar `{client}` "
                        f"(ruta directa o ausencia de bundle ID firmado)."
                    ),
                }
            )

    return anomalies


def _inspect_sqlite_behavioral(filename: str, raw_bytes: bytes) -> list[dict[str, Any]]:
    """Carga bases SQLite directamente desde RAM vía sqlite3.deserialize (sin tocar disco)."""
    if len(raw_bytes) < 16 or not raw_bytes.startswith(b"SQLite format 3\x00"):
        return []

    conn = sqlite3.connect(":memory:")
    try:
        conn.deserialize(raw_bytes)
        tables = _get_table_map(conn)
        findings: list[dict[str, Any]] = []
        findings.extend(_inspect_datausage_sqlite(conn, tables, filename))
        findings.extend(_inspect_tcc_sqlite(conn, tables, filename))
        return findings
    except (sqlite3.Error, ValueError):
        return []
    finally:
        conn.close()


def _extract_exec_path_anomalies(filename: str, text: str) -> list[dict[str, Any]]:
    anomalies: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for match in _SUSPICIOUS_PATH_REGEX.finditer(text):
        path_val = match.group(0).rstrip(".,;:\"'`) ]}")
        if path_val in seen_paths:
            continue
        seen_paths.add(path_val)
        binary_base = path_val.rsplit("/", 1)[-1].lower()
        is_high_risk_prefix = not path_val.startswith("/tmp/") or binary_base in PEGASUS_IMPERSONATED_PROCESSES
        severity = "CRITICAL" if is_high_risk_prefix else "HIGH"
        anomalies.append(
            {
                "category": "SUSPICIOUS_EXECUTION_PATH",
                "severity": severity,
                "indicator": path_val,
                "artifact": filename,
                "detail": (
                    f"Binario referenciado en ruta temporal o escribible `{path_val}` "
                    f"(patrón clásico de persistencia/ejecución Pegasus o Predator)."
                ),
            }
        )
    return anomalies


def _walk_process_records(obj: Any, records: list[dict[str, str]]) -> None:
    if isinstance(obj, list):
        for item in obj:
            _walk_process_records(item, records)
    elif isinstance(obj, dict):
        proc = str(
            obj.get("process")
            or obj.get("proc")
            or obj.get("name")
            or obj.get("binary")
            or ""
        ).strip()
        path = str(
            obj.get("path")
            or obj.get("command")
            or obj.get("cmd")
            or obj.get("exec")
            or ""
        ).strip()
        if proc or path:
            records.append({"process": proc, "path": path})
        plist = obj.get("processes")
        if isinstance(plist, list):
            for entry in plist:
                if isinstance(entry, str) and entry.strip():
                    val = entry.strip()
                    if "/" in val:
                        records.append({"process": val.rsplit("/", 1)[-1], "path": val})
                    else:
                        records.append({"process": val, "path": ""})
        for v in obj.values():
            if isinstance(v, (dict, list)):
                _walk_process_records(v, records)


def _inspect_process_json(filename: str, text: str) -> list[dict[str, Any]]:
    lower = filename.lower()
    if not any(kw in lower for kw in ("shutdown", "ps", "process", "task")):
        return []
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return []

    records: list[dict[str, str]] = []
    _walk_process_records(parsed, records)

    anomalies: list[dict[str, Any]] = []
    for rec in records:
        path = rec["path"]
        proc = rec["process"] or (path.rsplit("/", 1)[-1] if "/" in path else "")
        proc_base = proc.replace("\\", "/").rsplit("/", 1)[-1].lower()

        if path and any(path.startswith(prefix) for prefix in SUSPICIOUS_EXEC_PREFIXES):
            anomalies.append(
                {
                    "category": "SUSPICIOUS_EXECUTION_PATH",
                    "severity": "CRITICAL",
                    "indicator": path,
                    "artifact": filename,
                    "detail": (
                        f"Entrada estructurada en `{filename}` muestra ejecución desde ruta "
                        f"volátil `{path}` (proceso `{proc_base or 'desconocido'}`)."
                    ),
                }
            )
        elif proc_base in PEGASUS_IMPERSONATED_PROCESSES:
            anomalies.append(
                {
                    "category": "PROCESS_IMPERSONATION",
                    "severity": "HIGH",
                    "indicator": proc_base,
                    "artifact": filename,
                    "detail": (
                        f"Proceso `{proc_base}` detectado en `{filename}` coincide con nombres "
                        f"históricamente suplantados por spyware iOS (`shutdown.log`/`ps`)."
                    ),
                }
            )
    return anomalies


def _inspect_crashlog_anomalies(filename: str, text: str) -> list[dict[str, Any]]:
    lower_name = filename.lower()
    lower_text = text.lower()
    is_crash_artifact = lower_name.endswith((".ips", ".crash")) or any(
        marker in lower_text for marker in ("exc_bad_access", "exception type", "\"procname\"")
    )
    if not is_crash_artifact:
        return []

    has_mem_corruption = bool(_MEMORY_CORRUPTION_REGEX.search(lower_text))
    anomalies: list[dict[str, Any]] = []
    for target, rationale in ZERO_CLICK_CRASH_TARGETS.items():
        if re.search(rf"(?<![a-z0-9]){re.escape(target)}(?![a-z0-9])", lower_text):
            severity = "CRITICAL" if has_mem_corruption else "HIGH"
            exc_label = "EXC_BAD_ACCESS / corrupción de memoria" if has_mem_corruption else "crash repetido"
            anomalies.append(
                {
                    "category": "ZERO_CLICK_CRASH_ANOMALY",
                    "severity": severity,
                    "indicator": f"{target} ({'EXC_BAD_ACCESS' if has_mem_corruption else 'Crash'})",
                    "artifact": filename,
                    "detail": f"{exc_label} en `{target}`: {rationale}.",
                }
            )
    return anomalies


def run_behavioral_forensics(artifacts: list[dict]) -> list[dict]:
    """Ejecuta heurísticas conductuales en memoria volátil y deduplica hallazgos."""
    anomalies: list[dict[str, Any]] = []

    for item in artifacts:
        filename = str(item.get("filename") or "artifact")
        raw_bytes = item.get("bytes") or b""
        if not raw_bytes:
            continue

        if raw_bytes.startswith(b"SQLite format 3\x00"):
            anomalies.extend(_inspect_sqlite_behavioral(filename, raw_bytes))
            continue

        text = raw_bytes.decode("utf-8", errors="ignore")
        if not text:
            continue

        anomalies.extend(_extract_exec_path_anomalies(filename, text))
        anomalies.extend(_inspect_process_json(filename, text))
        anomalies.extend(_inspect_crashlog_anomalies(filename, text))

    deduped: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str, str]] = set()
    for item in sorted(
        anomalies,
        key=lambda a: (_SEVERITY_RANK.get(a.get("severity", "LOW"), 9), a.get("indicator", "")),
    ):
        key = (
            str(item.get("category", "")),
            str(item.get("indicator", "")).lower(),
            str(item.get("artifact", "")).lower(),
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(item)
        if len(deduped) >= 50:
            break

    return deduped
