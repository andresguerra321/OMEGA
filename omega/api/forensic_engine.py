import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse
import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

DEFANG_RULES = [
    (re.compile(r"hxxps://", re.IGNORECASE), "https://"),
    (re.compile(r"hxxp://", re.IGNORECASE), "http://"),
    (re.compile(r"\[\.\]|\(\.\)|\{\.\}|\\\."), "."),
    (re.compile(r"\[:\]|\(:\)"), ":"),
]

URL_RE = re.compile(r"https?://[^\s\"'<>\]\)]+", re.IGNORECASE)
DOMAIN_RE = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,15}\b", re.IGNORECASE)
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SHA256_RE = re.compile(r"\b[a-f0-9]{64}\b", re.IGNORECASE)

# Dominios legítimos frecuentes en dumps móviles para evitar ruido en correlación de dominio raíz
NOISE_ROOT_DOMAINS = {
    "apple.com",
    "icloud.com",
    "mzstatic.com",
    "google.com",
    "googleapis.com",
    "gstatic.com",
    "googleusercontent.com",
    "android.com",
    "whatsapp.com",
    "whatsapp.net",
    "facebook.com",
    "fbcdn.net",
    "instagram.com",
    "twitter.com",
    "x.com",
    "amazonaws.com",
    "cloudflare.com",
    "akamai.net",
    "akamaiedge.net",
    "microsoft.com",
}

MULTI_PART_TLDS = {"co.uk", "org.uk", "com.co", "org.co", "gov.co", "com.mx", "com.br", "com.ar"}


def _refang(text: str) -> str:
    cleaned = text
    for pattern, repl in DEFANG_RULES:
        cleaned = pattern.sub(repl, cleaned)
    return cleaned


def _extract_root_domain(domain: str) -> str | None:
    parts = domain.lower().strip(".").split(".")
    if len(parts) < 3:
        return None
    last_two = ".".join(parts[-2:])
    if last_two in MULTI_PART_TLDS and len(parts) >= 4:
        root = ".".join(parts[-3:])
    else:
        root = last_two

    if root in NOISE_ROOT_DOMAINS:
        return None
    return root


def _record_token(
    registry: dict[str, dict],
    value: str,
    ioc_category: str,
    origin_label: str,
    is_derived_root: bool = False,
):
    clean_val = value.strip().lower().rstrip(".")
    if not clean_val or len(clean_val) > 255:
        return

    if clean_val not in registry:
        registry[clean_val] = {
            "category": ioc_category,
            "origin": origin_label,
            "is_derived_root": is_derived_root,
        }
    elif not is_derived_root and registry[clean_val]["is_derived_root"]:
        # Priorizar coincidencia exacta si también existía como dominio raíz derivado
        registry[clean_val]["is_derived_root"] = False
        registry[clean_val]["origin"] = origin_label


def _extract_from_text_blob(text: str, origin_label: str, registry: dict[str, dict]):
    refanged = _refang(text)

    for raw_url in URL_RE.findall(refanged):
        _record_token(registry, raw_url, "url", origin_label)
        parsed = urlparse(raw_url)
        if parsed.hostname:
            host = parsed.hostname.lower()
            _record_token(registry, host, "domain", origin_label)
            root = _extract_root_domain(host)
            if root:
                _record_token(
                    registry,
                    root,
                    "domain",
                    f"{origin_label} (subdominio: {host})",
                    is_derived_root=True,
                )

    for raw_dom in DOMAIN_RE.findall(refanged):
        dom = raw_dom.lower().rstrip(".")
        if dom in NOISE_ROOT_DOMAINS or any(dom.endswith(f".{n}") for n in NOISE_ROOT_DOMAINS):
            continue
        _record_token(registry, dom, "domain", origin_label)
        root = _extract_root_domain(dom)
        if root:
            _record_token(
                registry,
                root,
                "domain",
                f"{origin_label} (subdominio: {dom})",
                is_derived_root=True,
            )

    for ip in IPV4_RE.findall(refanged):
        if not ip.startswith(("127.", "10.", "192.168.", "0.")):
            _record_token(registry, ip, "ip", origin_label)

    for sha in SHA256_RE.findall(refanged):
        _record_token(registry, sha, "sha256", origin_label)


def _parse_mvt_structured(parsed_json, filename: str | None) -> tuple[str, dict[str, dict]]:
    """Detecta módulos nativos de MVT (iOS/Android) y extrae artefactos con contexto forense."""
    registry: dict[str, dict] = {}
    fname = (filename or "").lower()

    if isinstance(parsed_json, list) and parsed_json and isinstance(parsed_json[0], dict):
        sample_keys = set(parsed_json[0].keys())

        # 1. MVT Safari / Chrome History
        if {"url", "visit_date"} <= sample_keys or "safari" in fname or "history" in fname:
            for entry in parsed_json:
                url = str(entry.get("url", ""))
                ts = entry.get("visit_date") or entry.get("isodate") or "fecha N/D"
                if url:
                    _extract_from_text_blob(url, f"Historial Web ({ts})", registry)
            return "MVT — Historial de Navegación (Safari/Chrome)", registry

        # 2. MVT SMS / Messages (vectores 1-click como Pegasus/Predator)
        if {"text", "sender"} <= sample_keys or "sms" in fname or "messages" in fname:
            for entry in parsed_json:
                body = str(entry.get("text") or entry.get("body") or "")
                sender = entry.get("sender") or entry.get("address") or "remitente desconocido"
                ts = entry.get("isodate") or entry.get("date") or ""
                if body:
                    _extract_from_text_blob(body, f"SMS de {sender} ({ts})".strip(), registry)
            return "MVT — Mensajes SMS / Enlaces", registry

        # 3. MVT iOS Shutdown Log (artefacto clave para detección de Pegasus en iOS)
        if "processes" in sample_keys or "shutdown" in fname:
            for entry in parsed_json:
                ts = entry.get("timestamp") or entry.get("isodate") or "reinicio"
                procs = entry.get("processes") or []
                if isinstance(procs, list):
                    for p in procs:
                        proc_name = str(p).strip()
                        if proc_name:
                            base_proc = proc_name.split("/")[-1]
                            _record_token(registry, base_proc, "process", f"Shutdown.log ({ts})")
            return "MVT iOS — Registro de Procesos (shutdown.log)", registry

        # 4. MVT Android Packages
        if "package_name" in sample_keys or "packages" in fname:
            for entry in parsed_json:
                pkg = str(entry.get("package_name") or "").strip()
                if pkg and not pkg.startswith(("com.android.", "com.google.android.", "android.")):
                    _record_token(registry, pkg, "package", "MVT Android Packages")
            return "MVT Android — Paquetes Instalados", registry

        # 5. MVT Timeline unificado
        if {"module", "description"} <= sample_keys or "timeline" in fname:
            for entry in parsed_json:
                mod = entry.get("module", "timeline")
                ts = entry.get("timestamp") or entry.get("isodate") or ""
                desc = str(entry.get("description") or "")
                if desc:
                    _extract_from_text_blob(desc, f"MVT Timeline [{mod}] {ts}".strip(), registry)
            return "MVT — Línea de Tiempo Forense (timeline.json)", registry

        # JSON genérico de objetos
        for idx, entry in enumerate(parsed_json, start=1):
            _extract_from_text_blob(json.dumps(entry, ensure_ascii=False), f"Registro JSON #{idx}", registry)
        return "JSON Forense Estructurado", registry

    if isinstance(parsed_json, list):
        for idx, item in enumerate(parsed_json, start=1):
            val = str(item).strip()
            if val:
                _extract_from_text_blob(val, f"Ítem #{idx}", registry)
                if "." not in val and "/" not in val and len(val) < 120:
                    _record_token(registry, val, "process", f"Ítem #{idx}")
        return "Lista JSON de Indicadores", registry

    if isinstance(parsed_json, dict):
        _extract_from_text_blob(json.dumps(parsed_json, ensure_ascii=False), "Objeto JSON Forense", registry)
        return "Objeto JSON Forense", registry

    return "Artefacto JSON", registry


def analyze_forensic_payload(raw_text: str, filename: str | None = None) -> dict:
    """Ejecuta el cruce forense 100% en memoria volátil sin escribir en disco ni BD (RNF4)."""
    registry: dict[str, dict] = {}
    detected_format = "Lista Plana / Texto Forense"

    stripped = raw_text.strip()
    if stripped.startswith(("{", "[")):
        try:
            parsed = json.loads(stripped)
            detected_format, registry = _parse_mvt_structured(parsed, filename)
        except json.JSONDecodeError:
            pass

    if not registry:
        for line_num, line in enumerate(raw_text.splitlines(), start=1):
            clean_line = line.strip()
            if not clean_line or clean_line.startswith("#"):
                continue
            origin = f"{filename or 'Entrada'} (Línea {line_num})"
            _extract_from_text_blob(clean_line, origin, registry)
            # Soportar nombres de procesos o paquetes sueltos por línea
            if " " not in clean_line and len(clean_line) < 120:
                _record_token(registry, _refang(clean_line), "process", origin)

    # Liberar referencias al texto original inmediatamente (RNF4)
    del raw_text
    del stripped

    breakdown = {"domains": 0, "ips": 0, "sha256": 0, "processes_or_urls": 0}
    for meta in registry.values():
        if meta["is_derived_root"]:
            continue
        cat = meta["category"]
        if cat == "domain":
            breakdown["domains"] += 1
        elif cat == "ip":
            breakdown["ips"] += 1
        elif cat == "sha256":
            breakdown["sha256"] += 1
        else:
            breakdown["processes_or_urls"] += 1

    candidate_values = list(registry.keys())
    if not candidate_values:
        return {
            "detected_format": detected_format,
            "analyzed_indicators": 0,
            "total_matches": 0,
            "breakdown": breakdown,
            "ephemeral_notice": "Análisis volátil completado en RAM. Ningún dato del dispositivo fue almacenado (RNF4).",
            "matches": [],
        }

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    i.ioc_type,
                    i.ioc_value,
                    i.context,
                    COALESCE(c.name, 'Sin campaña vinculada') AS campaign_name,
                    COALESCE(c.spyware_family, 'Desconocida') AS spyware_family,
                    r.title AS report_title,
                    r.organization,
                    r.source_url
                FROM iocs i
                JOIN reports r ON i.report_id = r.id
                LEFT JOIN campaigns c ON i.campaign_id = c.id
                WHERE i.ioc_value = ANY(%s);
                """,
                (candidate_values,),
            )
            rows = cur.fetchall()

    matches = []
    for r in rows:
        matched_val = r[1]
        token_meta = registry.get(matched_val, {})
        is_root = token_meta.get("is_derived_root", False)
        matches.append(
            {
                "ioc_type": r[0],
                "ioc_value": matched_val,
                "match_precision": "Dominio Raíz Relacionado" if is_root else "Exacto",
                "artifact_origin": token_meta.get("origin", "Entrada del usuario"),
                "context": r[2],
                "campaign": r[3],
                "spyware_family": r[4],
                "source_report": r[5],
                "organization": r[6],
                "source_url": r[7],
            }
        )

    return {
        "detected_format": detected_format,
        "analyzed_indicators": sum(breakdown.values()),
        "total_matches": len(matches),
        "breakdown": breakdown,
        "ephemeral_notice": "Análisis volátil completado en RAM. Ningún dato del dispositivo fue almacenado (RNF4).",
        "matches": matches,
    }
