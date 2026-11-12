import hashlib
import json
import os
import re
from pathlib import Path
import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

IOCS_DIR = Path(__file__).resolve().parent.parent / "corpus_mvp" / "iocs"

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@localhost:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

STIX_PATTERN_RE = re.compile(
    r"\[(domain-name|ipv4-addr|ipv6-addr|url|email-addr|process|file:hashes\.'?SHA-256'?):(?:value|name)\s*=\s*'([^']+)'\]",
    re.IGNORECASE,
)

TYPE_MAP = {
    "domain-name": "domain",
    "ipv4-addr": "ip",
    "ipv6-addr": "ip",
    "url": "url",
    "email-addr": "email",
    "process": "process",
    "file:hashes.'sha-256'": "sha256",
    "file:hashes.sha-256": "sha256",
}


def compute_sha256(file_path: Path) -> str:
    return hashlib.sha256(file_path.read_bytes()).hexdigest()


def parse_stix_or_json(file_path: Path) -> list[dict]:
    raw = json.loads(file_path.read_text(encoding="utf-8"))
    extracted = []

    # Caso 1: Bundle STIX 2.x oficial (Amnesty Tech / Citizen Lab)
    if isinstance(raw, dict) and raw.get("type") == "bundle":
        for obj in raw.get("objects", []):
            if obj.get("type") != "indicator":
                continue
            pattern = obj.get("pattern", "")
            desc = obj.get("name") or obj.get("description") or "STIX2 Indicator"
            for raw_type, val in STIX_PATTERN_RE.findall(pattern):
                norm_type = TYPE_MAP.get(raw_type.lower(), raw_type.lower())
                extracted.append(
                    {
                        "ioc_type": norm_type,
                        "ioc_value": val.strip().lower().rstrip("."),
                        "context": desc[:250],
                    }
                )

    # Caso 2: Lista JSON simple [{"type": "domain", "value": "..."}]
    elif isinstance(raw, list):
        for item in raw:
            if "type" in item and "value" in item:
                extracted.append(
                    {
                        "ioc_type": item["type"].strip().lower(),
                        "ioc_value": item["value"].strip().lower().rstrip("."),
                        "context": item.get("context", "Feed JSON"),
                    }
                )

    return extracted


def ingest_ioc_files():
    files = sorted(list(IOCS_DIR.glob("*.stix2")) + list(IOCS_DIR.glob("*.json")))
    if not files:
        print(f"No se encontraron archivos .stix2 o .json en {IOCS_DIR}")
        return

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            # Asociar a una campaña existente si solo hay una o crear registro de fuente STIX2
            cur.execute("SELECT id, name FROM campaigns LIMIT 1;")
            default_camp = cur.fetchone()
            campaign_id = default_camp[0] if default_camp else None

            for file_path in files:
                file_hash = compute_sha256(file_path)
                cur.execute("SELECT id FROM reports WHERE file_hash = %s;", (file_hash,))
                row = cur.fetchone()

                if row:
                    report_id = row[0]
                else:
                    cur.execute(
                        """
                        INSERT INTO reports (
                            campaign_id, title, organization, source_url, local_filename, file_hash
                        )
                        VALUES (%s, %s, %s, %s, %s, %s)
                        RETURNING id;
                        """,
                        (
                            campaign_id,
                            f"Feed IOCs: {file_path.stem}",
                            "Amnesty Tech / Citizen Lab STIX2",
                            f"local://iocs/{file_path.name}",
                            file_path.name,
                            file_hash,
                        ),
                    )
                    report_id = cur.fetchone()[0]

                indicators = parse_stix_or_json(file_path)
                inserted = 0
                for ind in indicators:
                    cur.execute(
                        """
                        INSERT INTO iocs (campaign_id, report_id, ioc_type, ioc_value, context)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (ioc_type, ioc_value, report_id) DO NOTHING;
                        """,
                        (
                            campaign_id,
                            report_id,
                            ind["ioc_type"],
                            ind["ioc_value"],
                            ind["context"],
                        ),
                    )
                    inserted += cur.rowcount

                conn.commit()
                print(f"[IOCs] {file_path.name}: {inserted} indicadores nuevos indexados (de {len(indicators)} leídos).")


if __name__ == "__main__":
    ingest_ioc_files()

