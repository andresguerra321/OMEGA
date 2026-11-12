import json
import os
import re
import sys
from pathlib import Path
import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@localhost:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

DOMAIN_RE = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,15}\b", re.IGNORECASE)
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SHA256_RE = re.compile(r"\b[a-f0-9]{64}\b", re.IGNORECASE)


def extract_candidates_in_memory(raw_content: str) -> list[str]:
    """Extrae dominios, IPs, hashes y líneas limpias en RAM sin persistir nada (RNF4)."""
    candidates = set()

    for match in DOMAIN_RE.findall(raw_content):
        candidates.add(match.lower().rstrip("."))
    for match in IPV4_RE.findall(raw_content):
        candidates.add(match)
    for match in SHA256_RE.findall(raw_content):
        candidates.add(match.lower())

    # También soporta listas simples línea por línea (ej. nombres de procesos)
    try:
        parsed = json.loads(raw_content)
        if isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, str) and item.strip():
                    candidates.add(item.strip().lower())
    except json.JSONDecodeError:
        for line in raw_content.splitlines():
            clean = line.strip().lower()
            if clean and not clean.startswith("#") and len(clean) < 255:
                candidates.add(clean)

    return list(candidates)


def verify_forensic_artifact(file_path: Path) -> dict:
    if not file_path.exists():
        raise FileNotFoundError(f"No existe el archivo: {file_path}")

    # Lectura efímera en memoria (RNF4)
    raw_content = file_path.read_text(encoding="utf-8", errors="ignore")
    candidates = extract_candidates_in_memory(raw_content)
    del raw_content  # Liberar buffer original inmediatamente

    if not candidates:
        return {"analyzed_indicators": 0, "matches": []}

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
                (candidates,),
            )
            rows = cur.fetchall()

    matches = [
        {
            "ioc_type": row[0],
            "ioc_value": row[1],
            "context": row[2],
            "campaign": row[3],
            "spyware_family": row[4],
            "source_report": row[5],
            "organization": row[6],
            "source_url": row[7],
        }
        for row in rows
    ]

    return {
        "analyzed_indicators": len(candidates),
        "total_matches": len(matches),
        "matches": matches,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python verify_mvt.py ../corpus_mvp/mvt_samples/tu_archivo.json")
        sys.exit(1)

    target = Path(sys.argv[1])
    result = verify_forensic_artifact(target)

    print("\n" + "=" * 70)
    print(f"Análisis efímero completado (RNF4) | Indicadores evaluados: {result['analyzed_indicators']}")
    print(f"Coincidencias detectadas: {result['total_matches']}")
    print("=" * 70)

    for m in result["matches"]:
        print(f"\n[ALERTA IOC] {m['ioc_type'].upper()}: {m['ioc_value']}")
        print(f"  Familia  : {m['spyware_family']} ({m['campaign']})")
        print(f"  Contexto : {m['context']}")
        print(f"  Fuente   : {m['source_report']} — {m['organization']} ({m['source_url']})")
    print()

