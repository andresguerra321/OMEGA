import json
import os
import re
import statistics
import sys
import time
from pathlib import Path
import psycopg
from pgvector.psycopg import register_vector
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")
sys.path.append(str(ROOT_DIR / "api"))

from services import DB_DSN, GROQ_MODEL, SYSTEM_PROMPT, embedder, groq_client, run_rag_query  # noqa: E402
from langchain_groq import ChatGroq  # noqa: E402
from langchain_huggingface import HuggingFaceEmbeddings  # noqa: E402
from ragas import EvaluationDataset, RunConfig, SingleTurnSample, evaluate  # noqa: E402
from ragas.embeddings import LangchainEmbeddingsWrapper  # noqa: E402
from ragas.llms import LangchainLLMWrapper  # noqa: E402
from ragas.metrics import Faithfulness, LLMContextPrecisionWithReference, ResponseRelevancy  # noqa: E402

DATASET_PATH = Path(__file__).resolve().parent / "eval_dataset.json"
ABLATION_REPORT_PATH = Path(__file__).resolve().parent / "ablation_report_v1.md"

INLINE_CITATION_RE = re.compile(r"\[\d+\]")


def _groq_extra_params(model_name: str) -> dict:
    m = (model_name or "").lower()
    if "qwen" in m:
        return {"reasoning_effort": "none"}
    if "gpt-oss" in m:
        return {"reasoning_effort": "low"}
    return {}


def run_mvp_vector_baseline(question: str, top_k: int = 5) -> dict:
    """Simula el pipeline MVP original (búsqueda vectorial pura sin RRF ni condensación)."""
    q_vec = embedder.encode([question], normalize_embeddings=True)[0].tolist()
    with psycopg.connect(DB_DSN) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.title, r.organization, dc.page_number, dc.content
                FROM document_chunks dc
                JOIN reports r ON dc.report_id = r.id
                ORDER BY dc.embedding <=> %s::vector
                LIMIT %s;
                """,
                (q_vec, top_k),
            )
            rows = cur.fetchall()

    citations = []
    context_blocks = []
    for idx, (title, org, page, content) in enumerate(rows, start=1):
        citations.append({"index": idx, "title": title, "page": page, "snippet": content})
        context_blocks.append(f"--- FRAGMENTO [{idx}] ---\nFuente: {title} | Página: {page}\nContenido: {content}\n")

    extra_params = _groq_extra_params(GROQ_MODEL)
    completion = None
    for attempt in range(4):
        try:
            completion = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"FRAGMENTOS DE CONTEXTO:\n{''.join(context_blocks)}\nCONSULTA:\n{question}"},
                ],
                **extra_params,
            )
            break
        except Exception as err:
            if "rate_limit" in str(err).lower() and attempt < 3:
                time.sleep(6 * (attempt + 1))
            else:
                raise
    return {"answer": completion.choices[0].message.content, "citations": citations}


def evaluate_pipeline(mode_name: str, runner_fn, cases: list[dict], eval_llm, eval_emb) -> dict:
    print(f"\n=== Evaluando configuración: {mode_name} ===")
    samples = []
    latencies = []
    citation_hits = 0
    in_domain_total = 0
    trap_hits = 0
    trap_total = 0

    for idx, item in enumerate(cases, start=1):
        t0 = time.perf_counter()
        res = runner_fn(item["question"])
        elapsed = round(time.perf_counter() - t0, 3)
        latencies.append(elapsed)

        answer = res["answer"]
        contexts = [c["snippet"][:500] for c in res["citations"][:3]]

        if item.get("is_trap"):
            trap_total += 1
            if "no hay evidencia suficiente" in answer.lower():
                trap_hits += 1
        else:
            in_domain_total += 1
            if INLINE_CITATION_RE.search(answer):
                citation_hits += 1
            samples.append(
                SingleTurnSample(
                    user_input=item["question"],
                    response=answer,
                    retrieved_contexts=contexts,
                    reference=item["ground_truth"],
                )
            )
        print(f"  [{idx}/{len(cases)}] {elapsed}s completado")
        time.sleep(1.5)

    relevancy_metric = ResponseRelevancy(strictness=1, embeddings=eval_emb)
    eval_samples = samples[:4]
    ragas_res = evaluate(
        dataset=EvaluationDataset(samples=eval_samples),
        metrics=[Faithfulness(), relevancy_metric, LLMContextPrecisionWithReference()],
        llm=eval_llm,
        embeddings=eval_emb,
        run_config=RunConfig(max_workers=1, max_retries=3, max_wait=15, timeout=60),
    )
    df = ragas_res.to_pandas()

    return {
        "faithfulness": round(float(df["faithfulness"].dropna().mean()), 4),
        "relevancy": round(float(df["answer_relevancy"].dropna().mean()), 4),
        "context_precision": round(float(df["llm_context_precision_with_reference"].dropna().mean()), 4),
        "citation_rate": round((citation_hits / in_domain_total) * 100, 1) if in_domain_total else 0.0,
        "abstention_rate": round((trap_hits / trap_total) * 100, 1) if trap_total else 0.0,
        "mean_latency": round(statistics.mean(latencies), 3),
    }


def main():
    if not DATASET_PATH.exists():
        raise FileNotFoundError("Ejecuta primero generate_dataset.py sobre el corpus ampliado.")

    all_cases = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    in_domain = [c for c in all_cases if not c.get("is_trap")]
    traps = [c for c in all_cases if c.get("is_trap")]
    cases = [in_domain[0], in_domain[2], in_domain[6], in_domain[11], in_domain[16]] + traps
    groq_kwargs = _groq_extra_params(GROQ_MODEL)
    eval_llm = LangchainLLMWrapper(
        ChatGroq(model=GROQ_MODEL, temperature=0, max_tokens=1024, max_retries=3, **groq_kwargs)
    )
    eval_emb = LangchainEmbeddingsWrapper(
        HuggingFaceEmbeddings(model_name="sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
    )

    mvp_metrics = evaluate_pipeline(
        "MVP (Vectorial Puro)",
        lambda q: run_mvp_vector_baseline(q, top_k=5),
        cases,
        eval_llm,
        eval_emb,
    )
    v1_metrics = evaluate_pipeline(
        "Omega V1.0 (Híbrido RRF + Refang)",
        lambda q: run_rag_query(q, top_k=6),
        cases,
        eval_llm,
        eval_emb,
    )

    def fmt_delta(v1_val: float, mvp_val: float, suffix: str = "") -> str:
        diff = round(v1_val - mvp_val, 4)
        sign = "+" if diff >= 0 else ""
        return f"{sign}{diff}{suffix}"

    report_md = [
        "# Estudio Comparativo de Ablación — MVP vs. Omega V1.0 (Objetivo 6)",
        "",
        f"- **Corpus evaluado:** {len(cases)} casos de prueba (dominio CTI + pruebas de abstención RNF1)",
        f"- **Modelo generativo:** `{GROQ_MODEL}` (`temperature=0.0`)",
        "- **Embeddings:** `paraphrase-multilingual-mpnet-base-v2` (768d)",
        "",
        "## Resultados Comparativos",
        "",
        "| Métrica / Dimensión | Baseline MVP (Vectorial) | Omega V1.0 (Híbrido RRF) | Variación (Δ) | Requerimiento |",
        "| :--- | :---: | :---: | :---: | :--- |",
        f"| **RAGAS Faithfulness** (0–1) | {mvp_metrics['faithfulness']} | **{v1_metrics['faithfulness']}** | {fmt_delta(v1_metrics['faithfulness'], mvp_metrics['faithfulness'])} | Objetivo 3, RNF1 |",
        f"| **RAGAS Answer Relevancy** (0–1) | {mvp_metrics['relevancy']} | **{v1_metrics['relevancy']}** | {fmt_delta(v1_metrics['relevancy'], mvp_metrics['relevancy'])} | Objetivo 6, RF4 |",
        f"| **RAGAS Context Precision** (0–1) | {mvp_metrics['context_precision']} | **{v1_metrics['context_precision']}** | {fmt_delta(v1_metrics['context_precision'], mvp_metrics['context_precision'])} | Objetivo 2, RF3 |",
        f"| **Cumplimiento de Citas Inline** | {mvp_metrics['citation_rate']}% | **{v1_metrics['citation_rate']}%** | {fmt_delta(v1_metrics['citation_rate'], mvp_metrics['citation_rate'], '%')} | RNF1 |",
        f"| **Tasa de Abstención (Anti-Alucinación)** | {mvp_metrics['abstention_rate']}% | **{v1_metrics['abstention_rate']}%** | {fmt_delta(v1_metrics['abstention_rate'], mvp_metrics['abstention_rate'], '%')} | RNF1 |",
        f"| **Latencia Media Interacción** | {mvp_metrics['mean_latency']}s | **{v1_metrics['mean_latency']}s** | {fmt_delta(v1_metrics['mean_latency'], mvp_metrics['mean_latency'], 's')} | RNF3 |",
    ]

    ABLATION_REPORT_PATH.write_text("\n".join(report_md), encoding="utf-8")
    print(f"\nTabla comparativa V1.0 generada en: {ABLATION_REPORT_PATH}")


if __name__ == "__main__":
    main()

