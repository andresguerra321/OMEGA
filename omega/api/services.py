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

GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
FALLBACK_GROQ_MODELS = [
    m.strip()
    for m in os.getenv(
        "GROQ_FALLBACK_MODELS",
        "qwen/qwen3.8-27b,openai/gpt-oss-120b,openai/gpt-oss-20b",
    ).split(",")
    if m.strip()
]
_MODEL_COOLDOWN_UNTIL: dict[str, float] = {}
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"), max_retries=0)
embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")

SYSTEM_PROMPT = """Eres el motor analítico de Omega, una plataforma defensiva de Cyber Threat Intelligence sobre spyware comercial.

REGLAS DE TRAZABILIDAD (RNF1):
1. Responde ÚNICAMENTE con los hechos explícitos contenidos en los FRAGMENTOS DE CONTEXTO numerados [1], [2], etc.
2. Cita la fuente inmediatamente después de cada dato técnico, CVE, actor o fecha usando EXCLUSIVAMENTE el índice numérico del fragmento: ejemplo [1] o [1][3]. NUNCA escribas texto ni títulos ni palabras dentro de los corchetes (prohibido [Metadatos], [Reporte], etc.).
3. Si los fragmentos recuperados no responden la pregunta específica o son de un tema ajeno (por ejemplo malware diferente, claves privadas no públicas o años/productos no cubiertos), responde EXACTAMENTE: "No hay evidencia suficiente en los reportes indexados para responder esta consulta."

REGLAS DE ESTILO Y ESTRUCTURA (RNF2):
1. Responde directamente en español técnico claro, en Markdown limpio, adaptado exactamente a lo que pregunta el analista.
2. NUNCA uses etiquetas HTML (<br>, <b>, <table>), listas anidadas con sub-viñetas ni encabezados sueltos tipo "**Detalles técnicos:**" o "**Conclusión ejecutiva:**" antes de las listas.
3. Organiza SIEMPRE la respuesta en dos partes limpias de un solo nivel:
   - Primero, un párrafo inicial directo (2 a 4 oraciones) que responda de frente la consulta con sus citas [1][2].
   - Luego, una lista plana con viñetas de un solo nivel (`- **Concepto clave:** explicación completa y concisa [1].`) cubriendo los puntos relevantes hallados en los fragmentos."""

CONDENSE_PROMPT = """Reescribe la última pregunta del analista como una consulta técnica autocontenida (en español o conservando los términos técnicos/CVEs exactos) resolviendo pronombres como "esa campaña", "ese exploit", "detectarlo" o "el segundo" a partir del historial.
Si el historial trata de una familia de spyware general (como Pegasus, Predator o Candiru), resuelve el pronombre hacia esa familia sin restringirlo a un único exploit salvo que la pregunta trate específicamente sobre ese exploit.
Si la pregunta ya es autocontenida, devuélvela sin cambios. Responde ÚNICAMENTE con la consulta reescrita, sin explicaciones."""

CVE_CODE_RE = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE)
SHA256_HEX_RE = re.compile(r"\b[a-f0-9]{64}\b", re.IGNORECASE)
IPV4_TOKEN_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
DOMAIN_TOKEN_RE = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)\b",
    re.IGNORECASE,
)

CATEGORY_RULES = [
    ("Vector y explotación", ("cve-", "zero-click", "0-day", "1-click", "exploit", "imessage", "blastdoor", "sandbox", "vulnerabil", "passkit", "webp", "coregraphics", "ejecución")),
    ("Infraestructura y C2", ("dominio", "c2", "servidor", "dns", "redirec", "url", "infraestructura", "entrega", "inyección", "shortener")),
    ("Artefactos forenses", ("mvt", "shutdown.log", "safari", "crash", "imtranscoderagent", "artefacto", "sqlite", "proceso", "hash", "sha-256", "respaldo", "persistencia")),
    ("Actores y objetivos", ("sector", "región", "periodist", "gobierno", "derechos humanos", "diplomát", "objetivo", "víctima", "nso", "intellexa", "candiru", "pegasus", "predator", "actor", "campaña")),
    ("Mitigación y defensa", ("mitig", "parche", "actualiz", "lockdown", "bloqueo", "verific", "recomend", "defens")),
]

ACTOR_PATTERNS = [
    ("Pegasus (NSO Group)", re.compile(r"\b(?:pegasus|nso\s*group)\b", re.IGNORECASE)),
    ("Predator (Intellexa / Cytrox)", re.compile(r"\b(?:predator|intellexa|cytrox)\b", re.IGNORECASE)),
    ("Candiru", re.compile(r"\bcandiru\b", re.IGNORECASE)),
    ("QuaDream (KingsPawn)", re.compile(r"\b(?:quadream|kingspawn)\b", re.IGNORECASE)),
    ("FinFisher (FinSpy)", re.compile(r"\b(?:finfisher|finspy)\b", re.IGNORECASE)),
]


def _confidence_for_citations(cit_list: list[dict]) -> str:
    if not cit_list:
        return "Referencial"
    best_sim = max(float(c.get("similarity") or 0.0) for c in cit_list)
    has_hybrid_or_exact = any(c.get("retrieval_method") in ("Híbrido (Vector + Exacto)", "Coincidencia Exacta") for c in cit_list)
    if (has_hybrid_or_exact and best_sim >= 0.65) or best_sim >= 0.82:
        return "Alta"
    if best_sim >= 0.58 or has_hybrid_or_exact:
        return "Media"
    return "Referencial"


def _classify_finding(title: str, summary: str) -> str:
    haystack = f"{title} {summary}".lower()
    for category, keywords in CATEGORY_RULES:
        if any(kw in haystack for kw in keywords):
            return category
    return "Hallazgo analítico"


def _fetch_linked_cti_context(cur, report_ids: list[str]) -> dict:
    if not report_ids:
        return {"campaigns": [], "cves": [], "iocs": []}

    cur.execute(
        """
        SELECT DISTINCT c.id::text, c.name, c.spyware_family, COALESCE(c.suspected_actor, ''), COALESCE(c.target_sector, '')
        FROM reports r
        JOIN campaigns c ON c.id = r.campaign_id
        WHERE r.id = ANY(%s::uuid[])
        UNION
        SELECT DISTINCT c.id::text, c.name, c.spyware_family, COALESCE(c.suspected_actor, ''), COALESCE(c.target_sector, '')
        FROM campaign_cves cc
        JOIN campaigns c ON c.id = cc.campaign_id
        WHERE cc.report_id = ANY(%s::uuid[])
        LIMIT 6;
        """,
        (report_ids, report_ids),
    )
    campaigns = [
        {
            "id": row[0],
            "name": row[1],
            "spyware_family": row[2],
            "suspected_actor": row[3] or None,
            "target_sector": row[4] or None,
        }
        for row in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT DISTINCT cv.cve_code
        FROM campaign_cves cc
        JOIN cves cv ON cv.id = cc.cve_id
        WHERE cc.report_id = ANY(%s::uuid[])
        ORDER BY cv.cve_code
        LIMIT 12;
        """,
        (report_ids,),
    )
    cves = [row[0] for row in cur.fetchall()]

    cur.execute(
        """
        SELECT DISTINCT i.ioc_type, i.ioc_value, COALESCE(i.context, ''), COALESCE(c.spyware_family, '')
        FROM iocs i
        LEFT JOIN campaigns c ON c.id = i.campaign_id
        WHERE i.report_id = ANY(%s::uuid[])
        LIMIT 24;
        """,
        (report_ids,),
    )
    iocs = [
        {
            "type": row[0],
            "value": row[1],
            "context": row[2] or None,
            "family": row[3] or None,
        }
        for row in cur.fetchall()
    ]

    return {"campaigns": campaigns, "cves": cves, "iocs": iocs}


def _build_structured_analysis(answer: str, citations: list[dict], linked_ctx: dict) -> dict:
    clean_answer = (answer or "").strip()
    insufficient = not citations or "no hay evidencia suficiente en los reportes indexados" in clean_answer.lower()

    if insufficient:
        return {
            "insufficient_evidence": True,
            "executive_summary": clean_answer,
            "findings": [],
            "related_indicators": {"cves": [], "iocs": [], "actors_families": [], "campaigns": []},
            "traceability": {
                "overall_confidence": "Referencial",
                "sources_count": len(citations),
                "organizations": [],
                "hybrid_count": 0,
                "max_similarity": 0.0,
                "sources": [],
            },
        }

    lines = clean_answer.splitlines()
    exec_lines = []
    findings = []
    cit_by_index = {c["index"]: c for c in citations}

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if exec_lines and not findings:
                # Primer párrafo antes de listas o citas
                continue
            continue
        bullet_match = re.match(r"^(?:[-*]|\d+\.)\s+(?:\*\*([^*]+?)\*\*\s*:?\s*)?(.*)$", stripped)
        if bullet_match:
            raw_title = (bullet_match.group(1) or "").strip().rstrip(":")
            raw_body = (bullet_match.group(2) or "").strip()
            if not raw_title and ":" in raw_body[:60]:
                head, tail = raw_body.split(":", 1)
                raw_title, raw_body = head.strip(), tail.strip()
            elif not raw_title:
                raw_title = "Evidencia documentada"
            cited_nums = [int(n) for n in re.findall(r"\[(\d+)\]", raw_body) if int(n) in cit_by_index]
            cited_objs = [cit_by_index[n] for n in cited_nums]
            findings.append(
                {
                    "category": _classify_finding(raw_title, raw_body),
                    "title": raw_title,
                    "summary": raw_body,
                    "citations": sorted(set(cited_nums)),
                    "confidence": _confidence_for_citations(cited_objs or citations),
                }
            )
        elif not findings and not stripped.startswith(">") and not stripped.startswith("#"):
            exec_lines.append(stripped)

    executive_summary = " ".join(exec_lines).strip()
    if not executive_summary:
        executive_summary = clean_answer.split("\n")[0].strip()

    corpus_text = "\n".join([clean_answer, *(c.get("snippet", "") for c in citations)])
    cves = sorted({m.upper() for m in CVE_CODE_RE.findall(corpus_text)})
    for db_cve in linked_ctx.get("cves", []):
        if db_cve.upper() not in cves and len(cves) < 12:
            cves.append(db_cve.upper())

    seen_iocs = set()
    iocs_out = []
    for h in SHA256_HEX_RE.findall(corpus_text):
        val = h.lower()
        if val not in seen_iocs:
            seen_iocs.add(val)
            iocs_out.append({"type": "sha256", "value": val, "source": "Hallazgo citado"})
    for d in DOMAIN_TOKEN_RE.findall(corpus_text):
        val = d.lower()
        if val not in seen_iocs and "citizenlab.ca" not in val and "amnesty.org" not in val and "blog.google" not in val:
            seen_iocs.add(val)
            iocs_out.append({"type": "domain", "value": val, "source": "Hallazgo citado"})
    for ip in IPV4_TOKEN_RE.findall(corpus_text):
        if ip not in seen_iocs:
            seen_iocs.add(ip)
            iocs_out.append({"type": "ip", "value": ip, "source": "Hallazgo citado"})
    for db_ioc in linked_ctx.get("iocs", []):
        val = db_ioc["value"]
        if val.lower() not in seen_iocs and len(iocs_out) < 10:
            seen_iocs.add(val.lower())
            iocs_out.append(
                {
                    "type": db_ioc["type"],
                    "value": val,
                    "source": db_ioc.get("family") or "Corpus CTI citado",
                }
            )

    actors_families = [label for label, pat in ACTOR_PATTERNS if pat.search(corpus_text)]
    for camp in linked_ctx.get("campaigns", []):
        fam = camp.get("spyware_family")
        if fam and not any(fam.lower() in a.lower() for a in actors_families):
            actors_families.append(fam)

    trace_sources = [
        {
            "index": c["index"],
            "report_id": c["report_id"],
            "title": c["title"],
            "organization": c["organization"],
            "page": c["page"],
            "retrieval_method": c["retrieval_method"],
            "similarity": c["similarity"],
            "confidence": _confidence_for_citations([c]),
        }
        for c in citations
    ]

    return {
        "insufficient_evidence": False,
        "executive_summary": executive_summary,
        "findings": findings,
        "related_indicators": {
            "cves": cves[:12],
            "iocs": iocs_out[:10],
            "actors_families": actors_families,
            "campaigns": linked_ctx.get("campaigns", []),
        },
        "traceability": {
            "overall_confidence": _confidence_for_citations(citations),
            "sources_count": len(citations),
            "organizations": sorted({c["organization"] for c in citations}),
            "hybrid_count": sum(1 for c in citations if c.get("retrieval_method") != "Semántico"),
            "max_similarity": max((float(c["similarity"]) for c in citations), default=0.0),
            "sources": trace_sources,
        },
    }


_STOPWORDS = {
    "que", "hay", "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
    "en", "por", "para", "con", "sin", "sobre", "entre", "hacia", "desde", "hasta",
    "como", "cual", "cuales", "quien", "quienes", "donde", "cuando", "cuanto", "cuantos",
    "segun", "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas", "eso",
    "son", "ser", "fue", "fueron", "han", "has", "tiene", "tienen", "puede", "pueden",
    "sobre", "acerca", "mas", "muy", "todo", "todos", "toda", "todas", "algo", "nada",
    "se", "su", "sus", "mi", "mis", "tu", "tus", "me", "te", "lo", "le", "les", "nos",
    "y", "o", "u", "si", "no", "ni", "al", "ya",
    "what", "is", "are", "was", "were", "the", "a", "an", "of", "in", "on", "to",
    "for", "from", "with", "by", "about", "how", "who", "which", "and", "or",
}

_BILINGUAL_CTI_TERMS = (
    (("vulnerabilidad", "vulnerabilidades", "zero-click", "zeroclick", "0-day", "zeroday", "exploit", "exploits"),
     "zero-click exploit vulnerability 0-day"),
    (("parche", "parches", "actualizacion", "actualizaciones", "mitigacion", "mitigaciones", "mitigar"),
     "patch fix backport commit security issue mitigation update"),
    (("kernel", "nucleo", "android", "linux"),
     "Android Linux kernel sandbox escalation"),
    (("forense", "forenses", "artefacto", "artefactos", "mvt", "respaldo", "respaldos", "backup", "evidencia", "indicador", "indicadores", "persistencia", "detectar", "revisar"),
     "MVT forensic artifacts shutdown.log Safari History.db DataUsage netusage crash log persistence"),
    (("infraestructura", "dominio", "dominios", "c2", "servidor", "servidores", "redireccion", "redirecciones", "enlace", "enlaces", "1-click"),
     "C2 domain infrastructure command control delivery server 1-click SMS redirection"),
    (("sector", "sectores", "objetivo", "objetivos", "victima", "victimas", "region", "regiones", "pais", "paises", "campana", "campanas"),
     "targets journalists human rights defenders civil society politicians region campaign victims"),
    (("proceso", "procesos", "trafico", "red", "archivo", "archivos"),
     "process network traffic DataUsage Safari History file"),
)

_OVERVIEW_TRIGGERS = (
    "que hay de",
    "que es",
    "hablame de",
    "resumen",
    "informacion sobre",
    "todo sobre",
    "explica",
    "overview",
)

_FAMILY_OVERVIEW_HINTS = {
    "pegasus": "Pegasus NSO Group zero-click FORCEDENTRY BLASTPASS MVT forensic indicators victims CatalanGate",
    "predator": "Predator Intellexa Cytrox ALIEN 1-click Chrome Android Linux kernel 0-day targets",
    "candiru": "Candiru DevilsTongue Windows Chrome Office exploits C2 decoy domains dissidents",
    "quadream": "QuaDream Reign KingsPawn ENDOFDAYS iOS 14 calendar zero-click targets",
}

_DEPENDENT_FOLLOWUP_RE = re.compile(
    r"\b(eso|esa|ese|esos|esas|ello|aquel|aquella|segundo|primero|anterior|mismo|misma|su|sus|campaña|exploit|artefacto)\b",
    re.IGNORECASE,
)


def _normalize_ascii(text: str) -> str:
    return (text or "").lower().translate(str.maketrans("áéíóúüñ", "aeiouun"))


def _groq_extra_params(model_name: str) -> dict:
    m = (model_name or "").lower()
    if "qwen" in m:
        return {"reasoning_effort": "none"}
    if "gpt-oss" in m:
        return {"reasoning_effort": "low"}
    return {}


def _candidate_chat_models() -> list[str]:
    ordered = []
    for candidate in [GROQ_MODEL, *FALLBACK_GROQ_MODELS]:
        if candidate and candidate not in ordered:
            ordered.append(candidate)
    now = time.time()
    available = [m for m in ordered if _MODEL_COOLDOWN_UNTIL.get(m, 0.0) <= now]
    return available or ordered


def _chat_completion_with_failover(
    messages: list[dict],
    temperature: float = 0.0,
    max_tokens: int = 1200,
) -> tuple[str | None, str]:
    last_model = GROQ_MODEL
    for model_name in _candidate_chat_models():
        last_model = model_name
        extra_params = _groq_extra_params(model_name)
        for attempt in range(2):
            try:
                resp = groq_client.chat.completions.create(
                    model=model_name,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    messages=messages,
                    **extra_params,
                )
                content = (resp.choices[0].message.content or "").strip()
                if content:
                    return content, model_name
                break
            except Exception as err:
                msg = str(err).lower()
                is_missing_model = (
                    "model_not_found" in msg
                    or "decommissioned" in msg
                    or "does not exist" in msg
                )
                is_daily_limit = "tokens per day" in msg or "tpd" in msg
                if is_missing_model:
                    _MODEL_COOLDOWN_UNTIL[model_name] = time.time() + 1800
                    break
                if is_daily_limit:
                    wait_match = re.search(
                        r"try again in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)s\b",
                        msg,
                    )
                    if wait_match:
                        mins = float(wait_match.group(1) or 0)
                        secs = float(wait_match.group(2) or 0)
                        cooldown_s = min(max(mins * 60.0 + secs, 45.0), 600.0)
                    else:
                        cooldown_s = 180.0
                    _MODEL_COOLDOWN_UNTIL[model_name] = time.time() + cooldown_s
                    break
                if ("rate_limit" in msg or "429" in msg) and attempt == 0 and "try again in" in msg:
                    # Espera breve para ráfagas TPM/RPM en segundos; si supera ~4s cambia rápido de modelo
                    sec_match = re.search(r"try again in\s+(\d+(?:\.\d+)?)s\b", msg)
                    if sec_match and float(sec_match.group(1)) <= 4.0:
                        time.sleep(float(sec_match.group(1)) + 0.25)
                        continue
                    _MODEL_COOLDOWN_UNTIL[model_name] = time.time() + 20
                    break
                if "rate_limit" in msg or "429" in msg:
                    _MODEL_COOLDOWN_UNTIL[model_name] = time.time() + 20
                    break
                break
    return None, last_model


def _prepare_retrieval_queries(query: str) -> tuple[str, str, list[str], list[str], str]:
    """Prepara consulta semántica bilingüe, tsquery OR balanceado, tokens entidad y CVEs exactos."""
    norm = _normalize_ascii(query)
    exact_cves = [c.lower() for c in CVE_CODE_RE.findall(norm)]
    cve_parts_to_drop = set()
    cve_phrases = []
    for cve in exact_cves:
        parts = cve.split("-")
        if len(parts) == 3:
            cve_phrases.append(f"({parts[0]} <-> {parts[1]} <-> {parts[2]})")
            cve_parts_to_drop.update({parts[0], parts[1]})

    raw_tokens = re.findall(r"[a-z0-9]{2,}", norm)
    core_tokens = [
        t for t in dict.fromkeys(raw_tokens)
        if t not in _STOPWORDS and (not exact_cves or t not in cve_parts_to_drop)
    ]

    semantic_extras = []
    expansion_tokens = []

    for triggers, eng_expansion in _BILINGUAL_CTI_TERMS:
        if any(tr in norm for tr in triggers):
            semantic_extras.append(eng_expansion)
            for etok in re.findall(r"[a-z0-9]{3,}", eng_expansion.lower()):
                if etok not in _STOPWORDS and etok not in cve_parts_to_drop and etok not in expansion_tokens:
                    expansion_tokens.append(etok)

    is_overview = not exact_cves and (any(trig in norm for trig in _OVERVIEW_TRIGGERS) or len(core_tokens) <= 2)
    if is_overview:
        for family, hint in _FAMILY_OVERVIEW_HINTS.items():
            if family in norm:
                semantic_extras.append(hint)
                for htok in re.findall(r"[a-z0-9]{3,}", hint.lower()):
                    if htok not in expansion_tokens:
                        expansion_tokens.append(htok)

    semantic_query = query if not semantic_extras else f"{query}. {' '.join(semantic_extras)}"

    # Reservar cupo en FTS tanto para tokens propios de la consulta como para equivalentes técnicos en inglés
    merged_tokens = list(dict.fromkeys([*core_tokens[:9], *expansion_tokens[:9]]))
    safe_fts = [tok for tok in merged_tokens if re.fullmatch(r"[a-z0-9]{2,32}", tok)]
    all_clauses = [*cve_phrases, *safe_fts[:16]]
    ts_expr = " | ".join(all_clauses) if all_clauses else "omeganomatchtoken"
    exact_cve_ts = " | ".join(cve_phrases) if cve_phrases else "omeganomatchtoken"
    scoring_tokens = list(dict.fromkeys([*core_tokens[:8], *expansion_tokens[:6]]))
    return semantic_query, ts_expr, scoring_tokens, exact_cves, exact_cve_ts


_LIGATURE_TABLE = str.maketrans({
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

_PDF_HEADER_STRIP_RE = re.compile(
    r"(?:FORENSIC METHODOLOGY REPORT\s+HOW TO CATCH NSO GROUP[’']S PEGASUS\s+Amnesty International\s*\d*"
    r"|(?:[-–—]\s*)?The Citizen Lab\s+Skip to content.*?(?:Subscribe to our newsletter|Digital Transnational Repression)"
    r"|Skip to content(?:\s+Opens (?:in a new window|an external site))*\s*"
    r"|Opens (?:in a new window|an external site(?:\s+in a new window)?)\s*"
    r"|Fuente:\s*[^|\n]+\|\s*Fecha:\s*[^|\n]+\|\s*URL:\s*\S+"
    r"|APPENDIX\s+[A-Z0-9]+:\s*[^\n.]{4,})",
    re.IGNORECASE,
)


def _clean_pdf_text(text: str) -> str:
    cleaned = (text or "").translate(_LIGATURE_TABLE)
    cleaned = re.sub(r"([A-Za-z0-9])-\s*\n\s*([a-z])", r"\1\2", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _select_diverse_topk(
    rows: list[tuple],
    entity_tokens: list[str],
    exact_cves: list[str],
    top_k: int,
) -> list[tuple]:
    """Reordena candidatos RRF priorizando CVE exacto, prosa técnica y diversidad entre reportes."""
    if len(rows) <= top_k:
        return rows

    def _score(row: tuple) -> float:
        title_lc = _normalize_ascii(row[1] or "")
        body = _clean_pdf_text(row[5] or "")
        body_lc = _normalize_ascii(body)
        base = float(row[7] or 0.0)
        cve_hits = sum(1 for cve in exact_cves if cve in body_lc)
        entity_hits = sum(1 for tok in entity_tokens if tok in title_lc or tok in body_lc)
        title_hits = sum(1 for tok in entity_tokens if tok in title_lc)

        # Penalizar tablas CSV/apéndices enumerativos e índices de contenido (TOC) cuando hay prosa técnica
        raw_lines = [ln.strip() for ln in (row[5] or "").splitlines() if ln.strip()]
        avg_line_len = sum(len(ln) for ln in raw_lines) / max(len(raw_lines), 1)
        many_cves_count = len(CVE_CODE_RE.findall(body))
        is_index_table = (many_cves_count >= 6 and avg_line_len < 30) or "appendix csv" in body_lc
        head_sample = body[:420]
        alpha_chars = sum(1 for ch in head_sample if ch.isalpha())
        upper_chars = sum(1 for ch in head_sample if ch.isupper())
        is_upper_toc = (
            alpha_chars >= 40
            and (upper_chars / alpha_chars) >= 0.48
            and len(re.findall(r"\b\d{1,3}\b", head_sample)) >= 4
        )
        is_toc = (
            ("contents" in body_lc[:260] and len(re.findall(r"\b\d+\.\s+[a-z]", body_lc)) >= 2)
            or is_upper_toc
            or "detailed traces per target" in body_lc[:220]
        )
        table_penalty = (0.018 if is_index_table else 0.0) + (0.020 if is_toc else 0.0)

        return (
            base
            + 0.032 * min(cve_hits, 2)
            + 0.006 * min(entity_hits, 5)
            + 0.005 * min(title_hits, 2)
            - table_penalty
        )

    ranked = sorted(rows, key=_score, reverse=True)
    selected = []
    used_indices = set()
    per_report_counts: dict[str, int] = {}

    # Primera pasada: hasta 2 fragmentos por reporte para evitar saturar una única fuente
    for i, row in enumerate(ranked):
        if len(selected) >= top_k:
            break
        rep_id = row[0]
        if per_report_counts.get(rep_id, 0) < 2:
            selected.append(row)
            used_indices.add(i)
            per_report_counts[rep_id] = per_report_counts.get(rep_id, 0) + 1

    # Segunda pasada: completar top_k si aún faltan cupos
    for i, row in enumerate(ranked):
        if len(selected) >= top_k:
            break
        if i not in used_indices:
            selected.append(row)

    return selected


_GENERIC_SPYWARE_WORDS = {
    "pegasus", "predator", "candiru", "quadream", "nso", "group", "intellexa",
    "cytrox", "spyware", "malware", "citizen", "lab", "amnesty", "google", "tag",
    "actualizaciones", "firmar", "utilizada", "utilizado", "reporte", "reportes",
}


_CTI_ANCHOR_TERMS = (
    "zero-click", "0-day", "1-click", "epoll", "backport", "kernel", "sandbox",
    "mvt", "shutdown.log", "safari", "datausage", "imessage", "passkit",
    "forcedentry", "blastpass", "exploit", "vulnerabilities", "flagged", "attackers",
    "profiting", "indicator", "victim", "target", "domain", "spyware",
    "nso", "intellexa", "cytrox", "predator", "pegasus", "candiru",
)

_FALLBACK_ALT_TERMS = {
    "artefactos": ("artifact", "artifacts", "mvt", "shutdown", "datausage", "safari", "cascadefail"),
    "forenses": ("forensic", "forensics", "mvt", "indicator", "indicators"),
    "vulnerabilidades": ("cve", "vulnerability", "exploit", "zero-click"),
    "victimas": ("victim", "victims", "target", "targeted", "journalist", "politician"),
    "sectores": ("sector", "journalist", "defender", "politician", "government"),
    "regiones": ("region", "country", "egypt", "spain", "greece", "catalan"),
    "clave": ("key", "pgp", "private", "signature"),
    "privada": ("private", "pgp", "secret", "signing"),
    "pgp": ("pgp", "gpg", "openpgp"),
    "parche": ("patch", "fix", "backport", "commit", "flagged"),
    "presente": ("present", "backported", "missing", "android", "kernels"),
    "mayoria": ("most", "all", "android", "kernels"),
    "kernels": ("kernel", "kernels", "linux", "android"),
    "android": ("android", "linux", "kernel"),
    "detectarlo": ("detect", "mvt", "indicator", "forensic", "artifacts"),
    "detectar": ("detect", "mvt", "indicator", "forensic", "artifacts"),
}


def _extract_best_excerpt(
    raw_snippet: str,
    query_terms: list[str],
    exact_cves: list[str],
    max_chars: int = 310,
) -> tuple[str, float]:
    stripped = _PDF_HEADER_STRIP_RE.sub(" ", raw_snippet or "")
    cleaned = _clean_pdf_text(stripped)
    cleaned = re.sub(r"^[:;\-–—•.\s]+", "", cleaned)
    # Primero limpiar solo un prefijo truncado previo a una coma ("h cases, the fix..." -> "the fix...")
    cleaned = re.sub(r"^[a-z]{1,4}\s+[a-z]{2,12},\s+", "", cleaned)
    # Solo saltar al siguiente punto si persiste una letra suelta truncada ("s due to...")
    if cleaned and re.match(r"^[B-HJ-Zb-hj-z]\s+[a-z]", cleaned):
        first_break = re.search(r"(?<=[.!?])\s+(?=[A-Z0-9“\"(])", cleaned)
        if first_break and len(cleaned) - first_break.end() >= 110:
            cleaned = cleaned[first_break.end():].strip()
    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]

    raw_sentences = re.split(r"(?<=[.!?])\s+(?=(?:[A-Z0-9“\"(]|[a-z0-9-]+\.[a-z]{2,}))", cleaned)
    candidates = [s.strip() for s in raw_sentences if len(s.strip()) >= 28]
    if not candidates:
        candidates = [cleaned] if cleaned else []

    scored: list[tuple[float, int, str]] = []
    for idx, sent in enumerate(candidates):
        s_norm = _normalize_ascii(sent)
        score = 0.0
        for cve in exact_cves:
            if cve in s_norm:
                score += 8.0
        for qt in query_terms:
            opts = (qt, *_FALLBACK_ALT_TERMS.get(qt, ()))
            if any(opt in s_norm for opt in opts):
                score += 2.0
        anchor_hits = sum(1 for anc in _CTI_ANCHOR_TERMS if anc in s_norm)
        score += min(anchor_hits * 0.9, 4.5)

        if len(sent) < 48:
            score -= 1.0
        alpha_c = sum(1 for ch in sent if ch.isalpha())
        upper_c = sum(1 for ch in sent if ch.isupper())
        if alpha_c >= 20 and (upper_c / alpha_c) > 0.55:
            score -= 5.0
        if (
            "contents" in s_norm
            or "appendix csv" in s_norm
            or "detailed traces" in s_norm
            or "remain committed to updating" in s_norm
            or "remiss if we did not acknowledge" in s_norm
            or "skip to content" in s_norm
            or "opens in a" in s_norm
            or "opens an external" in s_norm
            or "subscribe to our newsletter" in s_norm
            or "digital transnational" in s_norm
            or s_norm.startswith("tabla")
            or len(CVE_CODE_RE.findall(sent)) >= 5
        ):
            score -= 10.0
        if "url:" in s_norm or "fecha:" in s_norm:
            score -= 4.0
        scored.append((score, idx, sent))

    scored.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    if not scored:
        return "", 0.0

    best_score = scored[0][0]
    chosen: list[tuple[int, str]] = []
    total_len = 0
    for sc, idx, sent in scored:
        if len(chosen) >= 2:
            break
        if chosen and sc <= 0.0:
            break
        if any(sent[:40] == prev[:40] for _, prev in chosen):
            continue
        if chosen and total_len + len(sent) + 1 > max_chars + 60:
            continue
        chosen.append((idx, sent))
        total_len += len(sent) + 1

    chosen.sort(key=lambda item: item[0])
    combined = " ".join(s for _, s in chosen).strip()
    if len(combined) > max_chars:
        cut = combined[:max_chars].rsplit(" ", 1)[0].rstrip(" ,;:")
        combined = f"{cut}…"
    return combined, best_score


def _build_extractive_fallback_answer(
    standalone_query: str,
    citations: list[dict],
    linked_ctx: dict,
) -> str:
    """Genera una síntesis extractiva 100% anclada a citas reales si falla el LLM externo."""
    if not citations:
        return "No hay evidencia suficiente en los reportes indexados para responder esta consulta."

    best_sim = max(float(c.get("similarity") or 0.0) for c in citations)
    has_lexical = any(c.get("retrieval_method") != "Semántico" for c in citations)
    if not has_lexical and best_sim < 0.34:
        return "No hay evidencia suficiente en los reportes indexados para responder esta consulta."

    # Guard RNF1 anti-alucinación también en modo extractivo: si la pregunta exige términos específicos ajenos al corpus
    norm_q = _normalize_ascii(standalone_query)
    exact_cves = [c.lower() for c in CVE_CODE_RE.findall(norm_q)]
    q_tokens = [
        t for t in re.findall(r"[a-z0-9]{3,}", norm_q)
        if t not in _STOPWORDS and t not in _GENERIC_SPYWARE_WORDS
    ]
    joined_snippets = _normalize_ascii(
        " ".join(_clean_pdf_text((c.get("snippet") or "") + " " + (c.get("title") or "")) for c in citations)
    )
    is_overview_q = any(trig in norm_q for trig in _OVERVIEW_TRIGGERS) or (len(q_tokens) <= 1 and not exact_cves)
    if not is_overview_q and q_tokens:
        matched_discriminating = 0
        for tok in q_tokens:
            candidates = (tok, *_FALLBACK_ALT_TERMS.get(tok, ()))
            if any(cand in joined_snippets for cand in candidates):
                matched_discriminating += 1
        # Si menciona entidades altamente específicas fuera del corpus que no aparecen en ningún fragmento -> abstenerse
        if any(tr in q_tokens and tr not in joined_snippets for tr in ("pgp", "lockbit", "smbv3", "wannacry", "conti")) or (
            matched_discriminating == 0 and best_sim < 0.56
        ):
            return "No hay evidencia suficiente en los reportes indexados para responder esta consulta."

    orgs = sorted({c["organization"] for c in citations if c.get("organization")})
    corpus_plain = " ".join(_clean_pdf_text(c.get("snippet") or "") for c in citations)
    families = [label for label, pat in ACTOR_PATTERNS if pat.search(corpus_plain)]

    extracted = []
    for c in citations:
        excerpt, rel_score = _extract_best_excerpt(c.get("snippet") or "", q_tokens, exact_cves, max_chars=290)
        if excerpt:
            extracted.append((rel_score, c, excerpt))

    clean_extracted = [item for item in extracted if item[0] > -2.0]
    display_items = (clean_extracted if len(clean_extracted) >= 2 else extracted)[:4]
    lead_item = max(extracted, key=lambda x: x[0]) if extracted else None

    cve_citations: dict[str, int] = {}
    for c in citations:
        for found_cve in CVE_CODE_RE.findall(_clean_pdf_text(c.get("snippet") or "")):
            uc = found_cve.upper()
            if uc not in cve_citations:
                cve_citations[uc] = c["index"]

    fam_phrase = f" sobre {', '.join(families[:3])}" if families else ""
    intro_parts = []
    if lead_item:
        _, best_c, best_excerpt = lead_item
        lead_sentence = best_excerpt.rstrip(".")
        intro_parts.append(
            f"De acuerdo con la documentación técnica publicada por {', '.join(orgs[:3])}{fam_phrase}, {lead_sentence} [{best_c['index']}]."
        )
    else:
        intro_parts.append(
            f"De acuerdo con la documentación técnica publicada por {', '.join(orgs[:3])}{fam_phrase}, los reportes indexados detallan vectores de infección, artefactos e indicadores relevantes [{citations[0]['index']}]."
        )

    if cve_citations:
        cve_refs = ", ".join(f"{cve} [{idx}]" for cve, idx in list(cve_citations.items())[:4])
        intro_parts.append(f"Entre los identificadores documentados en los fragmentos citados destacan {cve_refs}.")

    bullets = []
    seen_prefixes = set()
    for _, c, excerpt in display_items:
        prefix = excerpt[:60].lower()
        if prefix in seen_prefixes:
            continue
        seen_prefixes.add(prefix)
        category = _classify_finding(c["title"], excerpt)
        short_title = c["title"].split(":")[0].strip()
        if len(short_title) > 54:
            short_title = short_title[:51].rsplit(" ", 1)[0] + "…"
        bullets.append(
            f"- **{category} · {short_title} (p.{c['page']}):** {excerpt.rstrip('.')} [{c['index']}]."
        )

    return " ".join(intro_parts) + "\n\n" + "\n".join(bullets)


def _condense_followup_query(query: str, history: list[dict]) -> str:
    if not history:
        return query

    # Solo gastar llamada LLM si la pregunta tiene referencias dependientes del contexto previo
    stripped = query.strip()
    if len(stripped.split()) >= 9 and not _DEPENDENT_FOLLOWUP_RE.search(stripped):
        return query

    recent = history[-4:]
    formatted_hist = "\n".join(f"{t['role'].upper()}: {t['content'][:400]}" for t in recent)
    rewritten, _ = _chat_completion_with_failover(
        messages=[
            {"role": "system", "content": CONDENSE_PROMPT},
            {"role": "user", "content": f"HISTORIAL:\n{formatted_hist}\n\nÚLTIMA PREGUNTA: {query}"},
        ],
        temperature=0.0,
        max_tokens=160,
    )
    if rewritten:
        return rewritten

    # Fallback determinista sin LLM para anclar la entidad del historial
    hist_lower = formatted_hist.lower()
    for fam in ("Pegasus", "Predator", "Candiru", "QuaDream"):
        if fam.lower() in hist_lower and fam.lower() not in query.lower():
            return f"{query} ({fam})"
    return query


def _resolve_source_filter_patterns(source_filter: str | None) -> list[str] | None:
    if not source_filter:
        return None
    norm = _normalize_ascii(source_filter).strip()
    if not norm or "todas" in norm or norm == "all":
        return None
    if "citizen" in norm:
        return ["%citizen lab%"]
    if "amnesty" in norm:
        return ["%amnesty%"]
    if "google" in norm or "tag" in norm:
        return ["%google%", "%tag%"]
    return [f"%{source_filter.strip()}%"]


def run_rag_query(
    question: str,
    top_k: int = 6,
    history: list[dict] | None = None,
    source_filter: str | None = None,
) -> dict:
    history = history or []
    standalone_query = _condense_followup_query(question, history)
    semantic_query, ts_expr, entity_tokens, exact_cves, exact_cve_ts = _prepare_retrieval_queries(standalone_query)
    q_vec = embedder.encode([semantic_query], normalize_embeddings=True)[0].tolist()
    candidate_limit = min(max(top_k * 5, 30), 48)
    org_patterns = _resolve_source_filter_patterns(source_filter)

    with psycopg.connect(DB_DSN) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            # Fusión Híbrida RRF: Top-32 Semántico (pgvector) + Top-32 Léxico OR (GIN tsvector priorizando CVEs exactos)
            cur.execute(
                """
                WITH semantic AS (
                    SELECT
                        dc.id,
                        ROW_NUMBER() OVER (ORDER BY dc.embedding <=> %s::vector) AS vec_rank,
                        1 - (dc.embedding <=> %s::vector) AS cos_sim
                    FROM document_chunks dc
                    JOIN reports r ON dc.report_id = r.id
                    WHERE length(dc.content) >= 120
                      AND (%s::text[] IS NULL OR r.organization ILIKE ANY(%s::text[]))
                    ORDER BY dc.embedding <=> %s::vector
                    LIMIT 32
                ),
                keyword AS (
                    SELECT
                        dc.id,
                        ROW_NUMBER() OVER (
                            ORDER BY
                                (dc.search_vector @@ to_tsquery('simple', %s)) DESC,
                                ts_rank_cd(dc.search_vector, to_tsquery('simple', %s)) DESC
                        ) AS fts_rank
                    FROM document_chunks dc
                    JOIN reports r ON dc.report_id = r.id
                    WHERE length(dc.content) >= 120
                      AND (%s::text[] IS NULL OR r.organization ILIKE ANY(%s::text[]))
                      AND dc.search_vector @@ to_tsquery('simple', %s)
                    LIMIT 32
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
                (
                    q_vec,
                    q_vec,
                    org_patterns,
                    org_patterns,
                    q_vec,
                    exact_cve_ts,
                    ts_expr,
                    org_patterns,
                    org_patterns,
                    ts_expr,
                    candidate_limit,
                ),
            )
            raw_rows = cur.fetchall()
            rows = _select_diverse_topk(raw_rows, entity_tokens, exact_cves, top_k)
            linked_ctx = (
                _fetch_linked_cti_context(cur, list({row[0] for row in rows}))
                if rows
                else {"campaigns": [], "cves": [], "iocs": []}
            )

    if not rows:
        empty_answer = "No hay evidencia suficiente en los reportes indexados para responder esta consulta."
        return {
            "answer": empty_answer,
            "standalone_query": standalone_query,
            "citations": [],
            "model": GROQ_MODEL,
            "analysis": _build_structured_analysis(empty_answer, [], {"campaigns": [], "cves": [], "iocs": []}),
        }

    citations = []
    context_blocks = []

    for idx, row in enumerate(rows, start=1):
        sim = round(float(row[6]), 4)
        method = row[8]
        clean_snip = _clean_pdf_text(row[5])
        citations.append(
            {
                "index": idx,
                "report_id": row[0],
                "title": row[1],
                "organization": row[2],
                "page": row[4],
                "source_url": row[3],
                "snippet": clean_snip,
                "similarity": sim,
                "retrieval_method": method,
            }
        )
        context_blocks.append(
            f"--- FRAGMENTO [{idx}] ({method}) ---\n"
            f"Fuente: {row[1]} ({row[2]}) | Página: {row[4]}\n"
            f"Contenido: {clean_snip[:900]}\n"
        )

    user_prompt = (
        f"FRAGMENTOS DE CONTEXTO:\n{''.join(context_blocks)}\n"
        f"CONSULTA DEL ANALISTA:\n{standalone_query}"
    )

    answer_text, used_model = _chat_completion_with_failover(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.0,
        max_tokens=700,
    )

    if not answer_text:
        answer_text = _build_extractive_fallback_answer(standalone_query, citations, linked_ctx)
        used_model = "omega-extractive-fallback"

    return {
        "answer": answer_text,
        "standalone_query": standalone_query,
        "citations": citations,
        "model": used_model,
        "analysis": _build_structured_analysis(answer_text, citations, linked_ctx),
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
