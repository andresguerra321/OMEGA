import json
import os
import time
from pathlib import Path
import psycopg
from groq import Groq
from dotenv import load_dotenv
from text_utils import extract_deterministic_indicators

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
FALLBACK_MODELS = ["qwen/qwen3.8-27b"]

WINDOW_SUMMARY_PROMPT = """Analiza este bloque de un reporte técnico de Cyber Threat Intelligence sobre spyware comercial.
Extrae en JSON únicamente hechos explícitos del texto:
{
  "spyware_family": "Pegasus | Predator | Candiru | Otro o null",
  "suspected_actor": "Operador/país cliente si se menciona, o null",
  "target_sector": "Periodistas, activistas, gobierno, etc. o null",
  "target_regions": ["País o región"],
  "key_findings": "Resumen de 2 frases de los hallazgos técnicos en este bloque",
  "confirmed_malicious_domains": ["dominio.com"]
}
Solo incluye dominios señalados como infraestructura de ataque o C2 en el texto. No inventes datos."""

FINAL_CONSOLIDATION_PROMPT = """Consolida los resúmenes parciales de un mismo reporte técnico CTI en una ficha normalizada única.
Devuelve un objeto JSON válido con esta estructura exacta:
{
  "campaign_name": "Nombre descriptivo y único de la campaña o investigación",
  "spyware_family": "Pegasus | Predator | Candiru | Otro",
  "suspected_actor": "Operador o cliente estatal si se menciona, o null",
  "target_sector": "Sector o perfil de las víctimas",
  "target_regions": ["País o región 1"],
  "summary": "Resumen técnico ejecutivo de 3 líneas sobre vectores de infección, exploits y víctimas",
  "malicious_domains": ["dominio-c2.com"]
}"""


def _call_groq_json(system_prompt: str, user_prompt: str) -> dict:
    models_to_try = [GROQ_MODEL] + [m for m in FALLBACK_MODELS if m != GROQ_MODEL]
    for model_name in models_to_try:
        for attempt in range(3):
            try:
                resp = groq_client.chat.completions.create(
                    model=model_name,
                    temperature=0.0,
                    max_tokens=1024,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                )
                return json.loads(resp.choices[0].message.content)
            except Exception as err:
                err_str = str(err).lower()
                if "rate_limit" in err_str:
                    if "tokens per day" in err_str or attempt == 2:
                        break  # Pasar al siguiente modelo disponible
                    time.sleep(5 * (attempt + 1))
                else:
                    raise
    raise RuntimeError("Todos los modelos de Groq excedieron su límite temporal de cuota.")


def normalize_all_reports():
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, organization, publication_date
                FROM reports
                WHERE campaign_id IS NULL
                  AND EXISTS (SELECT 1 FROM document_chunks dc WHERE dc.report_id = reports.id);
                """
            )
            pending = cur.fetchall()

            if not pending:
                print("Todos los reportes con chunks ya están normalizados.")
                return

            for report_id, title, org, pub_date in pending:
                cur.execute(
                    """
                    SELECT content
                    FROM document_chunks
                    WHERE report_id = %s
                    ORDER BY chunk_index ASC;
                    """,
                    (report_id,),
                )
                all_chunks = [row[0] for row in cur.fetchall()]
                full_text = "\n\n".join(all_chunks)

                # 1. Extracción determinística sobre el 100% del documento
                deterministic = extract_deterministic_indicators(full_text)

                # 2. Map-Reduce con ventanas estratégicas (inicio, intermedias y apéndices de IOCs)
                window_size = 12
                all_slices = [all_chunks[i : i + window_size] for i in range(0, len(all_chunks), window_size)]
                
                # Seleccionar hasta 5 ventanas representativas para cubrir portada, metodología y anexos
                if len(all_slices) <= 5:
                    selected_slices = all_slices
                else:
                    selected_slices = [
                        all_slices[0],
                        all_slices[1],
                        all_slices[len(all_slices) // 2],
                        all_slices[-2],
                        all_slices[-1],
                    ]

                partial_notes = []
                for idx, slice_chunks in enumerate(selected_slices, start=1):
                    window_text = "\n\n".join(slice_chunks)[:10000]
                    note = _call_groq_json(
                        WINDOW_SUMMARY_PROMPT,
                        f"Reporte: {title} ({org}) | Bloque {idx}/{len(selected_slices)}\n\n{window_text}",
                    )
                    partial_notes.append(note)
                    time.sleep(1.5)

                # 3. Consolidación final de la campaña
                final_data = _call_groq_json(
                    FINAL_CONSOLIDATION_PROMPT,
                    f"Título: {title} ({org})\nCVEs detectados: {deterministic['cves']}\nNotas parciales:\n{json.dumps(partial_notes, ensure_ascii=False)}",
                )

                campaign_name = (final_data.get("campaign_name") or title)[:250]
                spyware_family = (final_data.get("spyware_family") or "Desconocido")[:100]

                cur.execute(
                    """
                    INSERT INTO campaigns (
                        name, spyware_family, suspected_actor, target_sector,
                        target_regions, first_seen_date, summary
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (name) DO UPDATE SET
                        summary = EXCLUDED.summary,
                        suspected_actor = COALESCE(EXCLUDED.suspected_actor, campaigns.suspected_actor),
                        target_sector = COALESCE(EXCLUDED.target_sector, campaigns.target_sector)
                    RETURNING id;
                    """,
                    (
                        campaign_name,
                        spyware_family,
                        final_data.get("suspected_actor"),
                        final_data.get("target_sector"),
                        final_data.get("target_regions") or [],
                        pub_date,
                        final_data.get("summary"),
                    ),
                )
                campaign_id = cur.fetchone()[0]

                cur.execute(
                    "UPDATE reports SET campaign_id = %s WHERE id = %s;",
                    (campaign_id, report_id),
                )

                # 4. Registrar todos los CVEs extraídos del PDF completo
                for cve_code in deterministic["cves"]:
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

                # 5. Registrar dominios C2 confirmados y hashes SHA-256 extraídos del PDF
                confirmed_domains = {
                    d.strip().lower().rstrip(".")
                    for d in (final_data.get("malicious_domains") or [])
                    if "." in d
                }
                ioc_count = 0
                for dom in confirmed_domains:
                    cur.execute(
                        """
                        INSERT INTO iocs (campaign_id, report_id, ioc_type, ioc_value, context)
                        VALUES (%s, %s, 'domain', %s, %s)
                        ON CONFLICT (ioc_type, ioc_value, report_id) DO NOTHING;
                        """,
                        (campaign_id, report_id, dom, f"Extraído de reporte: {title[:120]}"),
                    )
                    ioc_count += cur.rowcount

                for sha in deterministic["sha256"]:
                    cur.execute(
                        """
                        INSERT INTO iocs (campaign_id, report_id, ioc_type, ioc_value, context)
                        VALUES (%s, %s, 'sha256', %s, %s)
                        ON CONFLICT (ioc_type, ioc_value, report_id) DO NOTHING;
                        """,
                        (campaign_id, report_id, sha, f"Hash SHA-256 citado en: {title[:120]}"),
                    )
                    ioc_count += cur.rowcount

                conn.commit()
                print(
                    f"[V1.0 NORMALIZADO] '{title}' ({len(all_chunks)} chunks) -> "
                    f"Campaña: '{campaign_name}' | CVEs: {len(deterministic['cves'])} | IOCs nuevos: {ioc_count}"
                )


if __name__ == "__main__":
    normalize_all_reports()
