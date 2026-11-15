import json
import os
import re
import statistics
import time
import unicodedata
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from groq import Groq
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from ragas import EvaluationDataset, RunConfig, SingleTurnSample, evaluate
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import Faithfulness, LLMContextPrecisionWithReference, ResponseRelevancy
from sentence_transformers import SentenceTransformer

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

ABSTENTION_CANONICAL = "No hay evidencia suficiente en los reportes indexados para responder esta consulta."

GROUNDED_SYSTEM_PROMPT = """Eres el motor analítico de OMEGA, una plataforma defensiva de Cyber Threat Intelligence sobre spyware comercial.

REGLAS DE TRAZABILIDAD (RNF1):
1. Responde ÚNICAMENTE con los hechos explícitos contenidos en los FRAGMENTOS DE CONTEXTO numerados [1], [2], etc.
2. Cita la fuente inmediatamente después de cada afirmación técnica, CVE, dominio, proceso o fecha usando el índice numérico en corchetes ASCII estándar: ejemplo [1] o [1][3] (nunca uses corchetes Unicode como 【1】).
3. Si los fragmentos recuperados no contienen evidencia suficiente para responder la consulta específica (por ejemplo, malware ajeno al corpus, claves privadas inexistentes o datos ausentes), responde EXACTAMENTE:
"No hay evidencia suficiente en los reportes indexados para responder esta consulta."
4. Responde en español técnico, directo y conciso."""

NUMERIC_CITATION_RE = re.compile(r"\[\d+(?:\s*,\s*\d+)*\]")
UNICODE_CIT_RE = re.compile(r"【(\d+)(?:†[^】]*)?】")
CANONICAL_CITATION_RE = re.compile(
    r"\[Documento:\s*[^|\]]+\|\s*P[aá]g\.?\s*\d+|\[.+?,\s*P[aá]g(?:ina)?\.?\s*\d+\]",
    re.IGNORECASE,
)
CVE_CAPTURE_RE = re.compile(r"\bCVE[-\u2010-\u2014\u2212](\d{4})[-\u2010-\u2014\u2212](\d{4,7})\b", re.IGNORECASE)
ISO_DATE_RE = re.compile(r"\b(20\d{2})[-/](\d{2})[-/](\d{2})\b")
TIME_HMS_RE = re.compile(r"\b(\d{2}):(\d{2}):(\d{2})\b")
ALNUM_CODE_RE = re.compile(r"\b(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{4,20}\b", re.IGNORECASE)
PROPER_BIGRAM_RE = re.compile(r"\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b")

LIGATURE_MAP = str.maketrans({
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\u00a0": " ",
    "\u2010": "-",
    "\u2011": "-",
    "\u2012": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
})

STOPWORDS = {
    "que", "los", "las", "una", "uno", "unos", "unas", "con", "por", "para", "como",
    "donde", "sobre", "entre", "esta", "este", "estos", "estas", "ese", "esa", "esos",
    "esas", "eso", "del", "hay", "son", "fue", "fueron", "desde", "hasta", "cual",
    "cuales", "quien", "quienes", "segun", "sus", "sin", "mas", "pero", "cuyo", "cuya",
    "tambien", "durante", "contra", "especifico", "especifica", "especificos",
    "especificas", "fragmento", "informe", "reporte", "reportes", "utilizo", "asociados",
    "asociada", "identifica", "identificado", "identifico", "menciona", "documenta",
    "registrado", "registrada", "registraron", "estaba", "presente", "mayoria", "pesar",
    "haber", "sido", "estan", "tienen", "cuanto", "cuantos", "primera", "ultima",
    "aproximadas", "atribuidas", "diferencia", "fundamental", "funcion", "cumplia",
    "numero", "frase", "enviado", "nombres", "fechas", "direccion", "conjuntamente",
    "the", "and", "for", "with", "what", "how", "where", "when", "who", "from", "this",
}

BILINGUAL_TECHNICAL_EXPANSIONS = [
    (("parche", "parches", "corregido", "corregidos", "corrigio", "retrotrajo"), "patch fix backported commit"),
    (("nucleo", "kernel", "kernels"), "kernel linux android"),
    (("transparencia", "rendicion", "cuentas", "licencias", "exportacion"), "transparency accountability export licensing"),
    (("senuelo", "imitacion", "dominios", "masquerading"), "masquerading lookalike domain"),
    (("sms", "mensaje", "mensajes", "telefono"), "sms message phone"),
    (("correo", "electronico", "busqueda"), "email lookup search"),
    (("fabricantes", "auditables", "privacidad", "integridad"), "manufacturers auditable security privacy"),
    (("vulnerabilidad", "vulnerabilidades", "exploits", "explotacion", "cadena", "fuga"), "vulnerability exploit chain sandbox escape"),
    (("evento", "creo", "archivo", "procesos", "huellas", "traces"), "traces process created file event"),
    (("disfraz", "pretexto", "intento", "infeccion", "periodico"), "infection attempt pretext disguised"),
    (("metadatos", "trafico", "cifrada", "video", "tamano", "carga"), "network traffic metadata https upload size"),
    (("redireccion", "redirigio", "visita", "historial", "navegacion"), "redirect visit safari history"),
    (("mitigacion", "sortear", "impedir"), "mitigation bypass"),
    (("deshabilitar", "reportador", "errores"), "crashreporter disable crash"),
    (("votacion", "elecciones", "protocolo"), "voting elections"),
    (("entrega", "aplicacion", "remoto"), "delivery server modules"),
]


def clean_text(text: str) -> str:
    cleaned = (text or "").replace("\x00", " ").translate(LIGATURE_MAP)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def normalize_answer_citations(text: str) -> str:
    """Convierte corchetes Unicode 【1】 o 【1†fuente】 en corchetes ASCII [1]."""
    cleaned = UNICODE_CIT_RE.sub(r"[\1]", text or "")
    return cleaned.replace("【", "[").replace("】", "]").strip()


def _merge_page_chunks(raw_chunks: list[str]) -> str:
    """Reconstruye el texto completo de una página eliminando el solapamiento entre sub-chunks."""
    merged = ""
    for raw in raw_chunks:
        piece = (raw or "").replace("\x00", "").strip()
        if not piece:
            continue
        if not merged:
            merged = piece
            continue
        probe = piece[:45]
        idx = merged.rfind(probe, max(0, len(merged) - 400))
        if idx != -1:
            merged = merged[:idx] + piece
        else:
            merged = merged + " " + piece
    return clean_text(merged)


def has_valid_citation(answer: str) -> bool:
    norm = normalize_answer_citations(answer)
    return bool(NUMERIC_CITATION_RE.search(norm) or CANONICAL_CITATION_RE.search(norm))


def is_abstention(answer: str) -> bool:
    low = (answer or "").lower()
    return (
        "no hay evidencia suficiente" in low
        or "no se encontró evidencia indexada suficiente" in low
        or "no se encontro evidencia indexada suficiente" in low
    )


def groq_extra_params(model_name: str) -> dict:
    low = (model_name or "").lower()
    if "qwen" in low:
        return {"reasoning_effort": "none"}
    if "gpt-oss" in low:
        return {"reasoning_effort": "low"}
    return {}


def prepare_bilingual_tsquery(question: str) -> tuple[str, list[str]]:
    cleaned = clean_text(question)
    norm = strip_accents(cleaned.lower())
    exact_phrases: list[str] = []
    drop_tokens: set[str] = set()

    for match in CVE_CAPTURE_RE.finditer(norm):
        year, number = match.group(1), match.group(2)
        phrase = f"((cve <-> -{year} <-> -{number}) | (cve <-> {year} <-> {number}))"
        if phrase not in exact_phrases:
            exact_phrases.append(phrase)
        drop_tokens.update({"cve", year, number})

    for match in ISO_DATE_RE.finditer(norm):
        year, month, day = match.group(1), match.group(2), match.group(3)
        phrase = f"(({year} <-> -{month} <-> -{day}) | ({year} <-> {month} <-> {day}))"
        if phrase not in exact_phrases:
            exact_phrases.append(phrase)
        drop_tokens.update({year, month, day})

    for match in TIME_HMS_RE.finditer(norm):
        hour, minute, second = match.group(1), match.group(2), match.group(3)
        phrase = f"({hour} <-> {minute} <-> {second})"
        if phrase not in exact_phrases:
            exact_phrases.append(phrase)
        drop_tokens.update({hour, minute, second})

    for match in ALNUM_CODE_RE.finditer(norm):
        tok = match.group(0).lower()
        if tok != "cve" and tok not in exact_phrases:
            exact_phrases.append(tok)

    for match in PROPER_BIGRAM_RE.finditer(cleaned):
        w1 = strip_accents(match.group(1).lower())
        w2 = strip_accents(match.group(2).lower())
        if w1 not in STOPWORDS and w2 not in STOPWORDS:
            phrase = f"({w1} <-> {w2})"
            if phrase not in exact_phrases:
                exact_phrases.append(phrase)

    en_tokens: list[str] = []
    for triggers, eng in BILINGUAL_TECHNICAL_EXPANSIONS:
        if any(tr in norm for tr in triggers):
            for etok in eng.split():
                if etok not in STOPWORDS and etok not in en_tokens:
                    en_tokens.append(etok)

    native_tokens: list[str] = []
    for tok in re.findall(r"[a-z0-9]{3,40}", norm):
        # Excluir años/números aislados (ej. "2020") que saturan ts_rank_cd en tablas cronológicas forenses.
        if tok.isdigit():
            continue
        if (
            tok not in STOPWORDS
            and tok not in drop_tokens
            and tok not in exact_phrases
            and tok not in en_tokens
            and tok not in native_tokens
        ):
            native_tokens.append(tok)

    merged = exact_phrases + native_tokens[:12] + en_tokens[:8]
    return (" | ".join(merged) if merged else "omega_noop"), exact_phrases


class CorpusDbClient:
    """Lee PostgreSQL por psycopg si el puerto está publicado o vía docker exec cuando omega-private está aislada."""

    def __init__(self, container_name: str = "omega_postgres"):
        self.container_name = container_name
        self.user = os.getenv("POSTGRES_USER", "omega_admin")
        self.password = os.getenv("POSTGRES_PASSWORD", "")
        self.db = os.getenv("POSTGRES_DB", "omega_cti")
        self.host = os.getenv("POSTGRES_HOST", "localhost")
        self.port = int(os.getenv("POSTGRES_PORT", "5432"))
        self._use_docker_exec = self._probe_direct_connection() is False

    def _probe_direct_connection(self) -> bool:
        try:
            import socket
            with socket.create_connection((self.host, self.port), timeout=0.8):
                return True
        except OSError:
            return False

    def query_json(self, sql: str) -> list[dict]:
        wrapped = f"SELECT COALESCE(json_agg(t), '[]'::json) FROM ({sql}) t;"
        if not self._use_docker_exec:
            import psycopg
            dsn = f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.db}"
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(wrapped)
                    row = cur.fetchone()
                    return row[0] if row and row[0] is not None else []

        import subprocess
        out = subprocess.check_output(
            [
                "docker", "exec", "-i", self.container_name,
                "psql", "-U", self.user, "-d", self.db, "-t", "-A",
            ],
            input=wrapped,
            text=True,
            encoding="utf-8",
        ).strip()
        return json.loads(out) if out else []


def vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{float(x):.7f}" for x in vec) + "]"


def call_groq_chat(
    client: Groq,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 2048,
) -> tuple[str, float, float, int]:
    """Ejecuta Chat Completions midiendo tiempo neto de inferencia separado del backoff 429."""
    extra = groq_extra_params(model_name)
    backoff_total = 0.0
    retries = 0
    for attempt in range(6):
        t0 = time.perf_counter()
        try:
            completion = client.chat.completions.create(
                model=model_name,
                temperature=0.0,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                **extra,
            )
            net_s = time.perf_counter() - t0
            return normalize_answer_citations(completion.choices[0].message.content or ""), net_s, backoff_total, retries
        except Exception as err:
            msg = str(err).lower()
            if any(k in msg for k in ("rate_limit", "429", "timeout", "timed out", "connection", "502", "503", "504")) and attempt < 5:
                retries += 1
                wait_match = re.search(r"try again in\s+(\d+(?:\.\d+)?)s", msg)
                wait_s = (float(wait_match.group(1)) + 1.5) if wait_match else (8.0 * (attempt + 1))
                wait_s = min(max(wait_s, 5.0), 45.0)
                backoff_total += wait_s
                time.sleep(wait_s)
                continue
            raise
    raise RuntimeError("Se agotaron los reintentos llamando a Groq.")


def _sql_escape(value: str) -> str:
    return value.replace("'", "''")


def run_vector_baseline(
    question: str,
    db: CorpusDbClient,
    embedder: SentenceTransformer,
    groq_client: Groq,
    gen_model: str,
    top_k: int = 5,
) -> dict:
    t0 = time.perf_counter()
    q_vec = vector_literal(embedder.encode([question], normalize_embeddings=True)[0].tolist())
    rows = db.query_json(
        f"""
        SELECT
            r.id::text AS report_id,
            r.title,
            r.organization,
            dc.page_number,
            dc.content,
            round((1.0 - (dc.embedding <=> '{q_vec}'::vector))::numeric, 4) AS similarity
        FROM public.document_chunks dc
        JOIN public.reports r ON dc.report_id = r.id
        ORDER BY dc.embedding <=> '{q_vec}'::vector
        LIMIT {int(top_k)}
        """
    )
    retrieval_s = time.perf_counter() - t0

    citations = []
    blocks = []
    for idx, row in enumerate(rows, start=1):
        snippet = clean_text(row["content"])
        citations.append(
            {
                "index": idx,
                "report_id": row["report_id"],
                "title": row["title"],
                "organization": row["organization"],
                "page": row["page_number"],
                "snippet": snippet,
                "similarity": float(row["similarity"]),
                "retrieval_method": "Semántico (Vectorial Puro)",
            }
        )
        blocks.append(
            f"--- FRAGMENTO [{idx}] ---\n"
            f"Fuente: {row['title']} ({row['organization']}) | Página: {row['page_number']}\n"
            f"Contenido: {snippet}\n"
        )

    if not citations:
        return {
            "answer": ABSTENTION_CANONICAL,
            "citations": [],
            "retrieval_s": retrieval_s,
            "generation_s": 0.0,
            "net_latency_s": retrieval_s,
            "backoff_s": 0.0,
            "retries": 0,
        }

    user_prompt = f"FRAGMENTOS DE CONTEXTO:\n{''.join(blocks)}\nCONSULTA:\n{question}"
    answer, gen_s, backoff_s, retries = call_groq_chat(groq_client, gen_model, GROUNDED_SYSTEM_PROMPT, user_prompt)
    return {
        "answer": answer,
        "citations": citations,
        "retrieval_s": retrieval_s,
        "generation_s": gen_s,
        "net_latency_s": retrieval_s + gen_s,
        "backoff_s": backoff_s,
        "retries": retries,
    }


def _rerank_diverse(rows: list[dict], top_k: int) -> list[dict]:
    selected = []
    used = set()
    per_report: dict[str, int] = {}
    for idx, row in enumerate(rows):
        if len(selected) >= top_k:
            break
        rid = row["report_id"]
        if per_report.get(rid, 0) < 2:
            selected.append(row)
            used.add(idx)
            per_report[rid] = per_report.get(rid, 0) + 1
    for idx, row in enumerate(rows):
        if len(selected) >= top_k:
            break
        if idx not in used:
            selected.append(row)
    return selected


def run_hybrid_rrf_v1(
    question: str,
    db: CorpusDbClient,
    embedder: SentenceTransformer,
    groq_client: Groq,
    gen_model: str,
    top_k: int = 5,
    rrf_k: int = 60,
) -> dict:
    t0 = time.perf_counter()
    q_vec = vector_literal(embedder.encode([question], normalize_embeddings=True)[0].tolist())
    ts_expr, exact_phrases = prepare_bilingual_tsquery(question)
    ts_escaped = _sql_escape(ts_expr)
    exact_sum_terms = [
        f"(CASE WHEN dc.search_vector @@ to_tsquery('pg_catalog.simple', '{_sql_escape(p)}') THEN 1.0 ELSE 0.0 END)"
        for p in exact_phrases
    ]
    exact_hits_expr = " + ".join(exact_sum_terms) if exact_sum_terms else "0.0"
    rows = db.query_json(
        f"""
        WITH semantic AS (
            SELECT
                dc.id,
                dc.report_id,
                dc.page_number,
                ROW_NUMBER() OVER (ORDER BY dc.embedding <=> '{q_vec}'::vector) AS vec_rank,
                (1.0 - (dc.embedding <=> '{q_vec}'::vector)) AS cos_sim
            FROM public.document_chunks dc
            ORDER BY dc.embedding <=> '{q_vec}'::vector
            LIMIT 60
        ),
        keyword AS (
            SELECT
                dc.id,
                dc.report_id,
                dc.page_number,
                ({exact_hits_expr}) AS exact_hits,
                ROW_NUMBER() OVER (
                    ORDER BY (({exact_hits_expr}) * 2.0 + ts_rank_cd(dc.search_vector, to_tsquery('pg_catalog.simple', '{ts_escaped}'), 32)) DESC
                ) AS fts_rank
            FROM public.document_chunks dc
            WHERE dc.search_vector @@ to_tsquery('pg_catalog.simple', '{ts_escaped}')
            LIMIT 60
        ),
        fused_chunks AS (
            SELECT
                COALESCE(s.id, k.id) AS chunk_id,
                COALESCE(s.report_id, k.report_id) AS report_id,
                COALESCE(s.page_number, k.page_number) AS page_number,
                COALESCE(1.0 / ({int(rrf_k)} + s.vec_rank), 0.0)
                    + COALESCE(1.0 / ({int(rrf_k)} + k.fts_rank), 0.0)
                    + COALESCE(k.exact_hits, 0.0) * 0.015 AS rrf_score,
                COALESCE(s.cos_sim, 0.0) AS cos_sim,
                CASE
                    WHEN s.id IS NOT NULL AND k.id IS NOT NULL THEN 'Híbrido (Vector + Léxico)'
                    WHEN k.id IS NOT NULL THEN 'Léxico Exacto'
                    ELSE 'Semántico'
                END AS method
            FROM semantic s
            FULL OUTER JOIN keyword k ON s.id = k.id
        ),
        fused_pages AS (
            SELECT
                report_id,
                page_number,
                MAX(rrf_score) AS page_rrf,
                MAX(cos_sim) AS max_sim,
                (ARRAY_AGG(method ORDER BY rrf_score DESC))[1] AS method
            FROM fused_chunks
            GROUP BY report_id, page_number
            ORDER BY page_rrf DESC, max_sim DESC
            LIMIT {int(top_k)}
        )
        SELECT
            r.id::text AS report_id,
            r.title,
            r.organization,
            fp.page_number,
            (
                SELECT json_agg(dc2.content ORDER BY dc2.ctid)
                FROM public.document_chunks dc2
                WHERE dc2.report_id = fp.report_id
                  AND dc2.page_number = fp.page_number
            ) AS page_chunks,
            round(fp.max_sim::numeric, 4) AS similarity,
            round(fp.page_rrf::numeric, 5) AS rrf_score,
            fp.method
        FROM fused_pages fp
        JOIN public.reports r ON fp.report_id = r.id
        ORDER BY fp.page_rrf DESC, fp.max_sim DESC
        """
    )
    retrieval_s = time.perf_counter() - t0

    citations = []
    blocks = []
    for idx, row in enumerate(rows, start=1):
        snippet = _merge_page_chunks(row.get("page_chunks") or [])
        citations.append(
            {
                "index": idx,
                "report_id": row["report_id"],
                "title": row["title"],
                "organization": row["organization"],
                "page": row["page_number"],
                "snippet": snippet,
                "similarity": float(row["similarity"]),
                "rrf_score": float(row["rrf_score"]),
                "retrieval_method": row["method"],
            }
        )
        blocks.append(
            f"--- FRAGMENTO [{idx}] ({row['method']}) ---\n"
            f"Fuente: {row['title']} ({row['organization']}) | Página: {row['page_number']}\n"
            f"Contenido: {snippet}\n"
        )

    if not citations:
        return {
            "answer": ABSTENTION_CANONICAL,
            "citations": [],
            "retrieval_s": retrieval_s,
            "generation_s": 0.0,
            "net_latency_s": retrieval_s,
            "backoff_s": 0.0,
            "retries": 0,
        }

    user_prompt = f"FRAGMENTOS DE CONTEXTO:\n{''.join(blocks)}\nCONSULTA:\n{question}"
    answer, gen_s, backoff_s, retries = call_groq_chat(groq_client, gen_model, GROUNDED_SYSTEM_PROMPT, user_prompt)
    return {
        "answer": answer,
        "citations": citations,
        "retrieval_s": retrieval_s,
        "generation_s": gen_s,
        "net_latency_s": retrieval_s + gen_s,
        "backoff_s": backoff_s,
        "retries": retries,
    }


def _match_gold_source(citation: dict, item: dict) -> bool:
    gold_title = item["source_title"].split("- The Citizen Lab")[0].strip().lower()
    cand_title = (citation.get("title") or "").lower()
    title_match = gold_title[:25] in cand_title or cand_title[:25] in gold_title
    return title_match and int(citation.get("page") or -1) == int(item.get("source_page") or -2)


def evaluate_pipeline_suite(
    mode_name: str,
    runner_fn: Callable[[str], dict],
    cases: list[dict],
    judge_model: str,
    inter_query_sleep_s: float = 12.5,
    ragas_batch_size: int = 2,
    ragas_batch_sleep_s: float = 28.0,
) -> dict:
    print(f"\n=== Evaluando configuración: {mode_name} ({len(cases)} casos) ===")
    samples: list[SingleTurnSample] = []
    detailed_rows: list[dict] = []
    net_latencies: list[float] = []
    total_backoff_s = 0.0
    total_retries = 0
    citation_hits = 0
    in_domain_total = 0
    trap_hits = 0
    trap_total = 0
    hit_at_3 = 0
    hit_at_5 = 0
    mrr_scores: list[float] = []

    for idx, item in enumerate(cases, start=1):
        res = runner_fn(item["question"])
        net_lat = round(float(res["net_latency_s"]), 3)
        net_latencies.append(net_lat)
        total_backoff_s += float(res.get("backoff_s", 0.0))
        total_retries += int(res.get("retries", 0))

        answer = res["answer"]
        # NUNCA truncar ni recortar retrieved_contexts: pasar el 100% de los fragmentos que vio el generador
        full_contexts = [
            f"[{c['index']}] Fuente: {c['title']} ({c['organization']}) | Página: {c['page']}\n{c['snippet']}"
            for c in res["citations"]
        ]

        if item.get("is_trap"):
            trap_total += 1
            abstained = is_abstention(answer)
            if abstained:
                trap_hits += 1
            status = "Abstención correcta (RNF1)" if abstained else "Fallo: posible alucinación"
        else:
            in_domain_total += 1
            cited = has_valid_citation(answer)
            if cited:
                citation_hits += 1
            status = "Cita verificada" if cited else "Sin formato de cita"

            gold_rank = next(
                (r_idx + 1 for r_idx, cit in enumerate(res["citations"][:5]) if _match_gold_source(cit, item)),
                None,
            )
            hit_at_3 += int(gold_rank is not None and gold_rank <= 3)
            hit_at_5 += int(gold_rank is not None and gold_rank <= 5)
            mrr_scores.append(1.0 / gold_rank if gold_rank else 0.0)

            samples.append(
                SingleTurnSample(
                    user_input=item["question"],
                    response=answer,
                    retrieved_contexts=full_contexts,
                    reference=item["ground_truth"],
                )
            )

        detailed_rows.append(
            {
                "id": idx,
                "type": "Trampa (Fuera de corpus)" if item.get("is_trap") else "Dominio CTI",
                "question": item["question"],
                "net_latency": net_lat,
                "status": status,
            }
        )
        print(f"  [{idx}/{len(cases)}] latencia_neta={net_lat}s -> {status}")
        if idx < len(cases) and inter_query_sleep_s > 0:
            time.sleep(inter_query_sleep_s)

    print(f"\nEvaluando RAGAS con juez '{judge_model}' sobre los {len(samples)} casos in-domain sin truncar...", flush=True)
    judge_kwargs = groq_extra_params(judge_model)
    judge_max_tokens = 1600 if "qwen" in judge_model.lower() else 2048
    eval_llm = LangchainLLMWrapper(
        ChatGroq(
            model=judge_model,
            temperature=0,
            max_tokens=judge_max_tokens,
            timeout=60,
            max_retries=8,
            **judge_kwargs,
        )
    )
    eval_emb = LangchainEmbeddingsWrapper(
        HuggingFaceEmbeddings(model_name="sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
    )

    all_faith: list[float] = []
    all_rel: list[float] = []
    all_prec: list[float] = []
    inter_metric_sleep_s = min(6.0, max(2.0, ragas_batch_sleep_s / 3.0)) if ragas_batch_sleep_s > 0 else 0.0

    for start in range(0, len(samples), ragas_batch_size):
        batch = samples[start : start + ragas_batch_size]
        relevancy_metric = ResponseRelevancy(strictness=1, embeddings=eval_emb)
        metric_specs = [
            ("faithfulness", Faithfulness(), all_faith),
            ("answer_relevancy", relevancy_metric, all_rel),
            ("llm_context_precision_with_reference", LLMContextPrecisionWithReference(), all_prec),
        ]
        for m_idx, (col_name, metric_obj, bucket) in enumerate(metric_specs):
            ragas_res = evaluate(
                dataset=EvaluationDataset(samples=batch),
                metrics=[metric_obj],
                llm=eval_llm,
                embeddings=eval_emb,
                run_config=RunConfig(max_workers=1, max_retries=10, max_wait=75, timeout=300),
                show_progress=False,
            )
            df = ragas_res.to_pandas()
            bucket.extend(float(v) for v in df[col_name].dropna().tolist())
            if m_idx < len(metric_specs) - 1 and inter_metric_sleep_s > 0:
                time.sleep(inter_metric_sleep_s)
        print(
            f"  [RAGAS lote {start // ragas_batch_size + 1}/{(len(samples) + ragas_batch_size - 1) // ragas_batch_size}] "
            f"faith={len(all_faith)}/{start + len(batch)}, rel={len(all_rel)}, prec={len(all_prec)}",
            flush=True,
        )
        if start + ragas_batch_size < len(samples) and ragas_batch_sleep_s > 0:
            time.sleep(ragas_batch_sleep_s)

    return {
        "faithfulness": round(statistics.mean(all_faith), 4) if all_faith else 0.0,
        "relevancy": round(statistics.mean(all_rel), 4) if all_rel else 0.0,
        "context_precision": round(statistics.mean(all_prec), 4) if all_prec else 0.0,
        "ragas_valid_faith": len(all_faith),
        "ragas_valid_rel": len(all_rel),
        "ragas_valid_prec": len(all_prec),
        "ragas_total": len(samples),
        "hit_at_3": round((hit_at_3 / in_domain_total) * 100, 1) if in_domain_total else 0.0,
        "hit_at_5": round((hit_at_5 / in_domain_total) * 100, 1) if in_domain_total else 0.0,
        "mrr_at_5": round(statistics.mean(mrr_scores), 4) if mrr_scores else 0.0,
        "citation_rate": round((citation_hits / in_domain_total) * 100, 1) if in_domain_total else 0.0,
        "citation_hits": citation_hits,
        "in_domain_total": in_domain_total,
        "abstention_rate": round((trap_hits / trap_total) * 100, 1) if trap_total else 0.0,
        "trap_hits": trap_hits,
        "trap_total": trap_total,
        "mean_latency": round(statistics.mean(net_latencies), 3) if net_latencies else 0.0,
        "max_latency": round(max(net_latencies), 3) if net_latencies else 0.0,
        "backoff_s": round(total_backoff_s, 1),
        "rate_limit_retries": total_retries,
        "detailed_rows": detailed_rows,
    }
