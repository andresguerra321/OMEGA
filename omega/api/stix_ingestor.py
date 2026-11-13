"""Ingestor de feeds STIX 2.1 oficiales (Amnesty Tech / Citizen Lab / Google TAG).

Carga indicadores reales (dominios, IPs, URLs, SHA-256, procesos, paquetes Android,
rutas de archivo y certificados APK) hacia PostgreSQL sin duplicados.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
from pathlib import Path
import psycopg

from cti_ingestor_core import (
    DB_DSN,
    bulk_upsert_iocs,
    upsert_campaign,
    upsert_report,
)

STIX_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("domain", re.compile(r"domain-name:value\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("url", re.compile(r"url:value\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("ip", re.compile(r"ipv[46]-addr:value\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("sha256", re.compile(r"file:hashes\.'?SHA-256'?\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("sha256", re.compile(r"app:cert\.sha256\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("process", re.compile(r"process:name\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("process", re.compile(r"file:name\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("package", re.compile(r"app:id\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("file_path", re.compile(r"file:path\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("email", re.compile(r"email-addr:value\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("profile", re.compile(r"configuration-profile:id\s*=\s*'([^']+)'", re.IGNORECASE)),
    ("android_prop", re.compile(r"android-property:name\s*=\s*'([^']+)'", re.IGNORECASE)),
]

_DATE_PREFIX_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_")


def resolve_iocs_dir() -> Path:
    """Resuelve la carpeta corpus_mvp/iocs en entorno Docker (/app/corpus_mvp/iocs) o local."""
    api_dir = Path(__file__).resolve().parent
    candidates = [
        api_dir / "corpus_mvp" / "iocs",
        api_dir.parent / "corpus_mvp" / "iocs",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate
    return candidates[0]


def _is_ip_literal(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def _infer_family_and_actor(filename: str, objects: list[dict]) -> tuple[str, str]:
    low = filename.lower()
    if "pegasus" in low or "nso" in low:
        return "Pegasus", "NSO Group"
    if "predator" in low or "cytrox" in low:
        return "Predator", "Cytrox / Intellexa"
    if "candiru" in low:
        return "Candiru", "Candiru / Saito Tech"
    if "novispy" in low:
        return "NoviSpy", "NoviSpy (BIA Serbia)"
    if "helios" in low or "wintego" in low:
        return "Wintego Helios", "Wintego"

    for obj in objects:
        if isinstance(obj, dict) and obj.get("type") == "malware":
            name = str(obj.get("name") or "").strip()
            if "pegasus" in name.lower():
                return "Pegasus", "NSO Group"
            if "predator" in name.lower():
                return "Predator", "Intellexa / Cytrox"
            if "mercenary" in name.lower():
                return "Predator", "Proveedor comercial (Google TAG / Android 0-day)"
            if name:
                return name[:90], "Desconocido"

    return "Spyware Comercial", "Por determinar"


def _extract_bundle_indicators(objects: list[dict], filename: str) -> list[tuple[str, str, str]]:
    """Extrae pares únicos (ioc_type, ioc_value, context) de los indicadores STIX 2.1."""
    extracted: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()

    for obj in objects:
        if not isinstance(obj, dict) or obj.get("type") != "indicator":
            continue
        pattern = str(obj.get("pattern") or "")
        if not pattern:
            continue
        desc = str(obj.get("name") or obj.get("description") or f"STIX2 ({filename})")[:250]

        for ioc_type, regex in STIX_PATTERNS:
            for raw_match in regex.findall(pattern):
                clean_val = raw_match.strip().lower()
                if ioc_type != "url":
                    clean_val = clean_val.rstrip(".")
                if not clean_val:
                    continue

                norm_type = "ip" if ioc_type == "domain" and _is_ip_literal(clean_val) else ioc_type
                key = (norm_type, clean_val)
                if key in seen:
                    continue
                seen.add(key)
                extracted.append((norm_type, clean_val, desc))

    return extracted


def sync_stix2_directory() -> dict:
    """Importa todos los paquetes .stix2 locales a PostgreSQL para correlación en tiempo real."""
    iocs_dir = resolve_iocs_dir()
    if not iocs_dir.exists():
        return {"files_scanned": 0, "iocs_parsed": 0, "iocs_inserted": 0, "total_db_iocs": 0}

    stix_files = sorted(iocs_dir.glob("*.stix2"))
    total_parsed = 0
    by_type: dict[str, int] = {}

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM iocs;")
            before_count = int(cur.fetchone()[0])

            for stix_path in stix_files:
                raw_bytes = stix_path.read_bytes()
                try:
                    bundle = json.loads(raw_bytes.decode("utf-8", errors="ignore"))
                except json.JSONDecodeError:
                    continue

                objects = bundle.get("objects", []) if isinstance(bundle, dict) else []
                family, actor = _infer_family_and_actor(stix_path.name, objects)
                date_match = _DATE_PREFIX_RE.match(stix_path.name)
                first_seen = date_match.group(1) if date_match else None
                file_hash = hashlib.sha256(raw_bytes).hexdigest()

                campaign_id = upsert_campaign(
                    cur,
                    name=f"Indicadores STIX2 — {stix_path.stem}",
                    spyware_family=family,
                    suspected_actor=actor,
                    target_sector="Periodistas, sociedad civil, activistas y gobierno",
                    first_seen_date=first_seen,
                    summary=f"Indicadores estructurados STIX 2.1 importados automáticamente desde {stix_path.name}.",
                )

                report_id = upsert_report(
                    cur,
                    campaign_id=campaign_id,
                    title=f"Feed STIX2 Oficial: {stix_path.stem}",
                    organization="Amnesty Tech / Citizen Lab STIX2",
                    publication_date=first_seen,
                    source_url="https://github.com/AmnestyTech/investigations",
                    local_filename=stix_path.name,
                    file_hash=file_hash,
                )

                indicators = _extract_bundle_indicators(objects, stix_path.name)
                total_parsed += len(indicators)
                for ioc_type, _, _ in indicators:
                    by_type[ioc_type] = by_type.get(ioc_type, 0) + 1

                bulk_upsert_iocs(
                    cur,
                    campaign_id=campaign_id,
                    report_id=report_id,
                    indicators=indicators,
                )

            cur.execute("SELECT COUNT(*) FROM iocs;")
            after_count = int(cur.fetchone()[0])
            conn.commit()

    return {
        "files_scanned": len(stix_files),
        "iocs_parsed": total_parsed,
        "iocs_inserted": max(0, after_count - before_count),
        "total_db_iocs": after_count,
        "by_type": by_type,
    }

