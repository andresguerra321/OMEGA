import json
import os
from pathlib import Path
import psycopg
from groq import Groq
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@localhost:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

EXTRACTION_PROMPT = """Analiza los fragmentos de un reporte técnico de Cyber Threat Intelligence sobre spyware comercial.
Extrae únicamente la información explícita en el texto y devuelve un objeto JSON válido con esta estructura exacta:
{
  "campaign_name": "Nombre descriptivo corto de la campaña o investigación",
  "spyware_family": "Pegasus | Predator | Candiru | Otro",
  "suspected_actor": "Operador o cliente estatal si se menciona, o null",
  "target_sector": "Periodistas, defensores de derechos humanos, gobierno, etc.",
  "target_regions": ["País o región 1", "País o región 2"],
  "summary": "Resumen técnico de 2 a 3 líneas sobre el vector de infección y hallazgos",
  "cves": ["CVE-YYYY-NNNNN"]
}
Si un campo no aparece en los fragmentos, usa null (o lista vacía [] para listas). No inventes datos."""


def normalize_pending_reports():
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, organization, publication_date
                FROM reports
                WHERE campaign_id IS NULL;
                """
            )
            pending = cur.fetchall()

            if not pending:
                print("Todos los reportes ya tienen campaña y metadatos normalizados.")
                return

            for report_id, title, org, pub_date in pending:
                cur.execute(
                    """
                    SELECT content
                    FROM document_chunks
                    WHERE report_id = %s
                    ORDER BY chunk_index ASC
                    LIMIT 8;
                    """,
                    (report_id,),
                )
                sample_text = "\n\n".join(row[0] for row in cur.fetchall())

                response = groq_client.chat.completions.create(
                    model=GROQ_MODEL,
                    temperature=0.0,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": EXTRACTION_PROMPT},
                        {
                            "role": "user",
                            "content": f"Título: {title} ({org})\n\nFragmentos:\n{sample_text}",
                        },
                    ],
                )

                data = json.loads(response.choices[0].message.content)
                campaign_name = (data.get("campaign_name") or title)[:250]
                spyware_family = (data.get("spyware_family") or "Desconocido")[:100]

                cur.execute(
                    """
                    INSERT INTO campaigns (
                        name, spyware_family, suspected_actor, target_sector,
                        target_regions, first_seen_date, summary
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (name) DO UPDATE SET
                        summary = COALESCE(EXCLUDED.summary, campaigns.summary)
                    RETURNING id;
                    """,
                    (
                        campaign_name,
                        spyware_family,
                        data.get("suspected_actor"),
                        data.get("target_sector"),
                        data.get("target_regions") or [],
                        pub_date,
                        data.get("summary"),
                    ),
                )
                campaign_id = cur.fetchone()[0]

                cur.execute(
                    "UPDATE reports SET campaign_id = %s WHERE id = %s;",
                    (campaign_id, report_id),
                )

                cves = data.get("cves") or []
                for cve_code in set(c.strip().upper() for c in cves if c.strip()):
                    cur.execute(
                        """
                        INSERT INTO cves (cve_code)
                        VALUES (%s)
                        ON CONFLICT (cve_code) DO UPDATE SET cve_code = EXCLUDED.cve_code
                        RETURNING id;
                        """,
                        (cve_code,),
                    )
                    cve_id = cur.fetchone()[0]

                    cur.execute(
                        """
                        INSERT INTO campaign_cves (campaign_id, cve_id, report_id)
                        VALUES (%s, %s, %s)
                        ON CONFLICT DO NOTHING;
                        """,
                        (campaign_id, cve_id, report_id),
                    )

                conn.commit()
                print(f"[NORMALIZADO] '{title}' -> Campaña: '{campaign_name}' | CVEs: {cves}")


if __name__ == "__main__":
    normalize_pending_reports()

