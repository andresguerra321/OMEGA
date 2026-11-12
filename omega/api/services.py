import os
import re
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
import psycopg
from pgvector.psycopg import register_vector
from sentence_transformers import SentenceTransformer
from groq import Groq
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")

SYSTEM_PROMPT = """Eres el motor analítico de Omega, una plataforma defensiva de Cyber Threat Intelligence sobre spyware comercial.

REGLAS DE TRAZABILIDAD (RNF1):
1. Responde ÚNICAMENTE con los hechos explícitos contenidos en los FRAGMENTOS DE CONTEXTO numerados [1], [2], etc.
2. Cita la fuente inmediatamente después de cada dato técnico, CVE, actor o fecha usando EXCLUSIVAMENTE el índice numérico del fragmento: ejemplo [1] o [1][3]. NUNCA escribas el título del reporte ni la página dentro de los corchetes.
3. Si no hay evidencia suficiente en los fragmentos, responde exactamente: "No hay evidencia suficiente en los reportes indexados para responder esta consulta."

REGLAS DE ESTILO Y LEGIBILIDAD (RNF2):
1. Escribe en español técnico, directo y bien estructurado en Markdown limpio.
2. NUNCA uses etiquetas HTML como <br>, <b> o <table>.
3. Evita tablas anchas en el chat. Organiza la información usando:
   - Un párrafo breve de síntesis inicial (2-3 líneas).
   - Listas con viñetas donde cada punto inicie con un concepto en **negrita** seguido de la explicación concisa y su cita [1].
   - Citas textuales en inglés únicamente cuando aporten evidencia forense clave, usando bloque de cita (`> "..."`) corto."""

CONDENSE_PROMPT = """Reescribe la última pregunta del analista como una consulta técnica autocontenida (en español o conservando los términos técnicos/CVEs exactos) resolviendo pronombres como "esa campaña", "ese exploit" o "el segundo" a partir del historial.
Si la pregunta ya es autocontenida, devuélvela sin cambios. Responde ÚNICAMENTE con la consulta reescrita, sin explicaciones."""


def _condense_followup_query(query: str, history: list[dict]) -> str:
    if not history:
        return query

    recent = history[-4:]
    formatted_hist = "\n".join(f"{t['role'].upper()}: {t['content'][:400]}" for t in recent)

    for attempt in range(4):
        try:
            resp = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                temperature=0.0,
                max_tokens=150,
                messages=[
                    {"role": "system", "content": CONDENSE_PROMPT},
                    {"role": "user", "content": f"HISTORIAL:\n{formatted_hist}\n\nÚLTIMA PREGUNTA: {query}"},
                ],
            )
            rewritten = resp.choices[0].message.content.strip()
            return rewritten or query
        except Exception as err:
            if "rate_limit" in str(err).lower() and attempt < 3:
                time.sleep(5 * (attempt + 1))
            else:
                return query
    return query


def run_rag_query(question: str, top_k: int = 6, history: list[dict] | None = None) -> dict:
    history = history or []
    standalone_query = _condense_followup_query(question, history)
    q_vec = embedder.encode([standalone_query], normalize_embeddings=True)[0].tolist()

    with psycopg.connect(DB_DSN) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            # Fusión Híbrida RRF: Top-20 Semántico (pgvector) + Top-20 Léxico Exacto (GIN tsvector)
            cur.execute(
                """
                WITH semantic AS (
                    SELECT
                        dc.id,
                        ROW_NUMBER() OVER (ORDER BY dc.embedding <=> %s::vector) AS vec_rank,
                        1 - (dc.embedding <=> %s::vector) AS cos_sim
                    FROM document_chunks dc
                    ORDER BY dc.embedding <=> %s::vector
                    LIMIT 20
                ),
                keyword AS (
                    SELECT
                        dc.id,
                        ROW_NUMBER() OVER (
                            ORDER BY ts_rank_cd(dc.search_vector, websearch_to_tsquery('simple', %s)) DESC
                        ) AS fts_rank
                    FROM document_chunks dc
                    WHERE dc.search_vector @@ websearch_to_tsquery('simple', %s)
                    LIMIT 20
                ),
                fused AS (
                    SELECT
                        COALESCE(s.id, k.id) AS chunk_id,
                        COALESCE(1.0 / (60 + s.vec_rank), 0.0) + COALESCE(1.0 / (60 + k.fts_rank), 0.0) AS rrf_score,
                        COALESCE(s.cos_sim, 0.0) AS cos_sim,
                        CASE
                            WHEN s.id IS NOT NULL AND k.id IS NOT NULL THEN 'Híbrido (Vector + Exacto)'
                            WHEN k.id IS NOT NULL THEN 'Coincidencia Exacta'
                            ELSE 'Semántico'
                        END AS method
                    FROM semantic s
                    FULL OUTER JOIN keyword k ON s.id = k.id
                )
                SELECT
                    r.id::text,
                    r.title,
                    r.organization,
                    r.source_url,
                    dc.page_number,
                    dc.content,
                    f.cos_sim,
                    f.rrf_score,
                    f.method
                FROM fused f
                JOIN document_chunks dc ON dc.id = f.chunk_id
                JOIN reports r ON dc.report_id = r.id
                ORDER BY f.rrf_score DESC
                LIMIT %s;
                """,
                (q_vec, q_vec, q_vec, standalone_query, standalone_query, top_k),
            )
            rows = cur.fetchall()

    if not rows:
        return {
            "answer": "No hay evidencia suficiente en los reportes indexados para responder esta consulta.",
            "standalone_query": standalone_query,
            "citations": [],
            "model": GROQ_MODEL,
        }

    citations = []
    context_blocks = []

    for idx, row in enumerate(rows, start=1):
        sim = round(float(row[6]), 4)
        method = row[8]
        citations.append(
            {
                "index": idx,
                "report_id": row[0],
                "title": row[1],
                "organization": row[2],
                "page": row[4],
                "source_url": row[3],
                "snippet": row[5],
                "similarity": sim,
                "retrieval_method": method,
            }
        )
        context_blocks.append(
            f"--- FRAGMENTO [{idx}] ({method}) ---\n"
            f"Fuente: {row[1]} ({row[2]}) | Página: {row[4]}\n"
            f"Contenido: {row[5]}\n"
        )

    user_prompt = (
        f"FRAGMENTOS DE CONTEXTO:\n{''.join(context_blocks)}\n"
        f"CONSULTA DEL ANALISTA:\n{standalone_query}"
    )

    completion = None
    for attempt in range(4):
        try:
            completion = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            break
        except Exception as err:
            if "rate_limit" in str(err).lower() and attempt < 3:
                time.sleep(6 * (attempt + 1))
            else:
                raise

    return {
        "answer": completion.choices[0].message.content,
        "standalone_query": standalone_query,
        "citations": citations,
        "model": GROQ_MODEL,
    }


def verify_indicators_ephemeral(raw_text: str) -> dict:
    """Cruza indicadores en memoria RAM sin persistir evidencia del usuario (RNF4)."""
    candidates = set()

    for m in DOMAIN_RE.findall(raw_text):
        candidates.add(m.lower().rstrip("."))
    for m in IPV4_RE.findall(raw_text):
        candidates.add(m)
    for m in SHA256_RE.findall(raw_text):
        candidates.add(m.lower())

    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, str) and item.strip():
                    candidates.add(item.strip().lower())
    except json.JSONDecodeError:
        for line in raw_text.splitlines():
            clean = line.strip().lower()
            if clean and not clean.startswith("#") and len(clean) < 255:
                candidates.add(clean)

    candidate_list = list(candidates)
    if not candidate_list:
        return {
            "analyzed_indicators": 0,
            "total_matches": 0,
            "ephemeral_notice": "Análisis realizado en memoria volátil. Ningún dato fue almacenado (RNF4).",
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
                (candidate_list,),
            )
            rows = cur.fetchall()

    matches = [
        {
            "ioc_type": r[0],
            "ioc_value": r[1],
            "context": r[2],
            "campaign": r[3],
            "spyware_family": r[4],
            "source_report": r[5],
            "organization": r[6],
            "source_url": r[7],
        }
        for r in rows
    ]

    return {
        "analyzed_indicators": len(candidate_list),
        "total_matches": len(matches),
        "ephemeral_notice": "Análisis realizado en memoria volátil. Ningún dato fue almacenado (RNF4).",
        "matches": matches,
    }


def list_campaigns() -> list[dict]:
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.id::text,
                    c.name,
                    c.spyware_family,
                    c.suspected_actor,
                    c.target_sector,
                    c.target_regions,
                    c.first_seen_date::text,
                    c.summary,
                    COUNT(DISTINCT i.id) AS ioc_count,
                    COALESCE(
                        ARRAY_AGG(DISTINCT cv.cve_code) FILTER (WHERE cv.cve_code IS NOT NULL),
                        '{}'
                    ) AS cves
                FROM campaigns c
                LEFT JOIN iocs i ON i.campaign_id = c.id
                LEFT JOIN campaign_cves cc ON cc.campaign_id = c.id
                LEFT JOIN cves cv ON cv.id = cc.cve_id
                GROUP BY c.id
                ORDER BY c.first_seen_date DESC NULLS LAST;
                """
            )
            rows = cur.fetchall()

    return [
        {
            "id": r[0],
            "name": r[1],
            "spyware_family": r[2],
            "suspected_actor": r[3],
            "target_sector": r[4],
            "target_regions": r[5] or [],
            "first_seen_date": r[6],
            "summary": r[7],
            "ioc_count": r[8],
            "cves": r[9],
        }
        for r in rows
    ]


def get_campaign_detail(campaign_id: str) -> dict | None:
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id::text, name, spyware_family, suspected_actor,
                    target_sector, target_regions, first_seen_date::text, summary
                FROM campaigns
                WHERE id = %s::uuid;
                """,
                (campaign_id,),
            )
            camp = cur.fetchone()
            if not camp:
                return None

            cur.execute(
                """
                SELECT id::text, title, organization, publication_date::text,
                       source_url, local_filename, file_hash, ingested_at::text
                FROM reports
                WHERE campaign_id = %s::uuid
                ORDER BY publication_date DESC NULLS LAST;
                """,
                (campaign_id,),
            )
            reports = [
                {
                    "id": r[0],
                    "title": r[1],
                    "organization": r[2],
                    "publication_date": r[3],
                    "source_url": r[4],
                    "local_filename": r[5],
                    "file_hash": r[6],
                    "ingested_at": r[7],
                }
                for r in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT cv.cve_code, cv.description, cv.cvss_score
                FROM campaign_cves cc
                JOIN cves cv ON cc.cve_id = cv.id
                WHERE cc.campaign_id = %s::uuid
                ORDER BY cv.cve_code ASC;
                """,
                (campaign_id,),
            )
            cves = [
                {"cve_code": r[0], "description": r[1], "cvss_score": float(r[2]) if r[2] else None}
                for r in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT ioc_type, ioc_value, context
                FROM iocs
                WHERE campaign_id = %s::uuid
                ORDER BY ioc_type ASC, ioc_value ASC
                LIMIT 250;
                """,
                (campaign_id,),
            )
            iocs = [{"ioc_type": r[0], "ioc_value": r[1], "context": r[2]} for r in cur.fetchall()]

            cur.execute(
                """
                SELECT ioc_type, COUNT(*)
                FROM iocs
                WHERE campaign_id = %s::uuid
                GROUP BY ioc_type;
                """,
                (campaign_id,),
            )
            ioc_breakdown = {r[0]: r[1] for r in cur.fetchall()}

    return {
        "id": camp[0],
        "name": camp[1],
        "spyware_family": camp[2],
        "suspected_actor": camp[3],
        "target_sector": camp[4],
        "target_regions": camp[5] or [],
        "first_seen_date": camp[6],
        "summary": camp[7],
        "reports": reports,
        "cves": cves,
        "iocs": iocs,
        "ioc_breakdown": ioc_breakdown,
    }


# =====================================================================
# --- Servicios OSINT Defensivo (RF8, RNF8) ---
# =====================================================================

def register_osint_asset(asset_type: str, asset_value: str, explicit_consent: bool) -> dict:
    if explicit_consent is not True:
        raise ValueError("RNF8: El consentimiento explícito del titular es obligatorio.")

    clean_value = asset_value.strip().lower()
    if asset_type == "domain":
        clean_value = re.sub(r"^https?://", "", clean_value).split("/")[0]

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO osint_monitored_assets (asset_type, asset_value, explicit_consent)
                VALUES (%s, %s, TRUE)
                ON CONFLICT (asset_value) DO UPDATE SET
                    explicit_consent = TRUE,
                    consented_at = NOW()
                RETURNING id::text, asset_type, asset_value, explicit_consent,
                          consented_at::text, last_checked_at::text;
                """,
                (asset_type, clean_value),
            )
            row = cur.fetchone()
            conn.commit()

    return {
        "id": row[0],
        "asset_type": row[1],
        "asset_value": row[2],
        "explicit_consent": row[3],
        "consented_at": row[4],
        "last_checked_at": row[5],
    }


def list_osint_assets() -> list[dict]:
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, asset_type, asset_value, explicit_consent,
                       consented_at::text, last_checked_at::text
                FROM osint_monitored_assets
                WHERE explicit_consent = TRUE
                ORDER BY consented_at DESC;
                """
            )
            rows = cur.fetchall()

    return [
        {
            "id": r[0],
            "asset_type": r[1],
            "asset_value": r[2],
            "explicit_consent": r[3],
            "consented_at": r[4],
            "last_checked_at": r[5],
        }
        for r in rows
    ]


def delete_osint_asset(asset_id: str) -> bool:
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM osint_monitored_assets WHERE id = %s::uuid;", (asset_id,))
            deleted = cur.rowcount > 0
            conn.commit()
    return deleted


def _fetch_json_passive(url: str, headers: dict | None = None, timeout: int = 8):
    req_headers = {"User-Agent": "Omega-CTI-Defensive-Research/1.0"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", errors="ignore"))
    except Exception:
        return None


def _check_dns_txt(name: str) -> list[str]:
    encoded = urllib.parse.quote(name)
    data = _fetch_json_passive(
        f"https://cloudflare-dns.com/dns-query?name={encoded}&type=TXT",
        headers={"Accept": "application/dns-json"},
    )
    if not data or "Answer" not in data:
        return []
    return [ans.get("data", "").strip('"') for ans in data["Answer"]]


def run_passive_osint_scan(asset_id: str) -> dict | None:
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, asset_type, asset_value, explicit_consent
                FROM osint_monitored_assets
                WHERE id = %s::uuid AND explicit_consent = TRUE;
                """,
                (asset_id,),
            )
            asset = cur.fetchone()
            if not asset:
                return None

            _, asset_type, asset_value, _ = asset

            # Determinar dominio objetivo para telemetría pasiva
            target_domain = None
            if asset_type == "domain":
                target_domain = asset_value
            elif asset_type == "institutional_email" and "@" in asset_value:
                target_domain = asset_value.split("@", 1)[1]

            exposed_subdomains = []
            dns_posture = {"spf_configured": False, "dmarc_configured": False, "notes": []}

            # 1. Logs públicos de Transparencia de Certificados (crt.sh)
            if target_domain:
                q = urllib.parse.quote(f"%.{target_domain}")
                crt_data = _fetch_json_passive(f"https://crt.sh/?q={q}&output=json", timeout=10)
                if isinstance(crt_data, list):
                    subs = set()
                    for entry in crt_data[:120]:
                        for line in entry.get("name_value", "").splitlines():
                            clean_sub = line.strip().lower().lstrip("*.")
                            if clean_sub.endswith(target_domain):
                                subs.add(clean_sub)
                    exposed_subdomains = sorted(subs)[:25]

                # 2. Postura DNS anti-suplantación (SPF / DMARC)
                root_txt = _check_dns_txt(target_domain)
                dmarc_txt = _check_dns_txt(f"_dmarc.{target_domain}")

                spf_records = [r for r in root_txt if "v=spf1" in r.lower()]
                dmarc_records = [r for r in dmarc_txt if "v=dmarc1" in r.lower()]

                dns_posture = {
                    "domain_evaluated": target_domain,
                    "spf_configured": len(spf_records) > 0,
                    "spf_record": spf_records[0] if spf_records else None,
                    "dmarc_configured": len(dmarc_records) > 0,
                    "dmarc_record": dmarc_records[0] if dmarc_records else None,
                }
            elif asset_type == "organization":
                q = urllib.parse.quote(asset_value)
                crt_data = _fetch_json_passive(f"https://crt.sh/?O={q}&output=json", timeout=10)
                if isinstance(crt_data, list):
                    subs = {
                        entry.get("common_name", "").strip().lower()
                        for entry in crt_data[:80]
                        if entry.get("common_name")
                    }
                    exposed_subdomains = sorted(subs)[:25]
                dns_posture = {"notes": ["Consulta por nombre de organización en Certificate Transparency."]}

            # 3. Cruce interno contra base de IOCs de spyware indexada en Omega
            search_terms = {asset_value}
            if target_domain:
                search_terms.add(target_domain)
            search_terms.update(exposed_subdomains)

            cur.execute(
                """
                SELECT i.ioc_type, i.ioc_value, COALESCE(c.spyware_family, 'Desconocida'), r.title
                FROM iocs i
                JOIN reports r ON i.report_id = r.id
                LEFT JOIN campaigns c ON i.campaign_id = c.id
                WHERE i.ioc_value = ANY(%s);
                """,
                (list(search_terms),),
            )
            cti_matches = [
                {
                    "ioc_type": m[0],
                    "ioc_value": m[1],
                    "spyware_family": m[2],
                    "source_report": m[3],
                }
                for m in cur.fetchall()
            ]

            cur.execute(
                "UPDATE osint_monitored_assets SET last_checked_at = NOW() WHERE id = %s::uuid;",
                (asset_id,),
            )
            conn.commit()

    return {
        "asset_id": asset_id,
        "asset_type": asset_type,
        "asset_value": asset_value,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "exposed_subdomains": exposed_subdomains,
        "dns_posture": dns_posture,
        "cti_ioc_matches": cti_matches,
        "ethical_notice": "Consulta OSINT pasiva ejecutada exclusivamente sobre activo propio con consentimiento explícito registrado (RF8 / RNF8).",
    }
