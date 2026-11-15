import argparse
import json
import os
import time
from pathlib import Path

from groq import Groq
from sentence_transformers import SentenceTransformer

from eval_common import (
    CorpusDbClient,
    evaluate_pipeline_suite,
    run_hybrid_rrf_v1,
    run_vector_baseline,
)
from java_backend_client import JavaBackendRagClient

DATASET_PATH = Path(__file__).resolve().parent / "eval_dataset.json"
ABLATION_REPORT_PATH = Path(__file__).resolve().parent / "ablation_report_v1.md"
EVAL_REPORT_PATH = Path(__file__).resolve().parent / "eval_report.md"


def fmt_delta(v1_val: float, mvp_val: float, suffix: str = "") -> str:
    diff = round(v1_val - mvp_val, 4)
    sign = "+" if diff >= 0 else ""
    return f"{sign}{diff}{suffix}"


def write_eval_report(v1_metrics: dict, cases_count: int, gen_model: str, judge_model: str) -> None:
    lines = [
        "![OMEGA — Visualización de Marca](../../../img/banner.png)",
        "",
        "# Reporte de Evaluación Cuantitativa — Sistema RAG Omega V1.0 (Objetivo 6)",
        "",
        f"- **Dataset evaluado:** {cases_count} casos (`{v1_metrics['in_domain_total']}` dominio CTI + `{v1_metrics['trap_total']}` abstención RNF1)",
        f"- **Modelo generativo:** `{gen_model}` (`temperature=0.0`)",
        f"- **Juez RAGAS:** `{judge_model}` (fragmentos completos sin truncamiento)",
        f"- **Muestras RAGAS válidas:** Faithfulness `{v1_metrics['ragas_valid_faith']}/{v1_metrics['ragas_total']}`, Answer Relevancy `{v1_metrics['ragas_valid_rel']}/{v1_metrics['ragas_total']}`, Context Precision `{v1_metrics['ragas_valid_prec']}/{v1_metrics['ragas_total']}`",
        "",
        "## 1. Resumen de Métricas",
        "",
        "| Dimensión Evaluada | Métrica | Resultado | Requerimiento Asociado |",
        "| :--- | :--- | :---: | :--- |",
        f"| **Fidelidad Documental** | RAGAS Faithfulness (0–1) | **{v1_metrics['faithfulness']}** | Objetivo 3, Objetivo 6, RNF1 |",
        f"| **Relevancia de Respuesta** | RAGAS Answer Relevancy (0–1) | **{v1_metrics['relevancy']}** | Objetivo 6, RF4 |",
        f"| **Precisión de Contexto** | RAGAS Context Precision (0–1) | **{v1_metrics['context_precision']}** | Objetivo 2, RF3 |",
        f"| **Recuperación Top-K** | Hit@3 / Hit@5 / MRR@5 | **{v1_metrics['hit_at_3']}% / {v1_metrics['hit_at_5']}% / {v1_metrics['mrr_at_5']}** | Objetivo 2, RF3 |",
        f"| **Trazabilidad Estricta** | Cumplimiento de citas verificables | **{v1_metrics['citation_rate']}%** ({v1_metrics['citation_hits']}/{v1_metrics['in_domain_total']}) | RNF1 |",
        f"| **Control Anti-Alucinación** | Tasa de abstención fuera de dominio | **{v1_metrics['abstention_rate']}%** ({v1_metrics['trap_hits']}/{v1_metrics['trap_total']}) | RNF1 |",
        f"| **Rendimiento Interactivo (Neto)** | Latencia media / máxima (sin backoff 429) | **{v1_metrics['mean_latency']}s** / {v1_metrics['max_latency']}s | RNF3 |",
        "",
        "## 2. Detalle por Caso de Prueba",
        "",
        "| # | Tipo | Latencia Neta | Estado de Trazabilidad | Consulta |",
        "| :---: | :--- | :---: | :--- | :--- |",
    ]
    for row in v1_metrics["detailed_rows"]:
        q_clean = row["question"].replace("|", "/")
        lines.append(f"| {row['id']} | {row['type']} | {row['net_latency']}s | {row['status']} | {q_clean} |")

    EVAL_REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _select_stratified(in_domain: list[dict], limit: int) -> list[dict]:
    if limit <= 0 or limit >= len(in_domain):
        return in_domain
    step = len(in_domain) / limit
    indices = [min(len(in_domain) - 1, int(i * step)) for i in range(limit)]
    # Garantizar índices únicos preservando orden
    seen = set()
    unique = []
    for idx in indices:
        while idx in seen and idx + 1 < len(in_domain):
            idx += 1
        seen.add(idx)
        unique.append(in_domain[idx])
    return unique


def main() -> None:
    parser = argparse.ArgumentParser(description="Estudio comparativo de ablación RAG para OMEGA (corregido).")
    parser.add_argument("--mode", choices=["corpus", "backend-java"], default="corpus")
    parser.add_argument("--in-domain-limit", type=int, default=0, help="0 = evaluar todos los casos in-domain")
    parser.add_argument("--stratified", action="store_true", help="Distribuir uniformemente la muestra entre reportes")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--gen-model", default=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"))
    parser.add_argument("--judge-model", default=os.getenv("RAGAS_JUDGE_MODEL", "qwen/qwen3.8-27b"))
    parser.add_argument("--inter-query-sleep", type=float, default=12.0)
    parser.add_argument("--ragas-batch-size", type=int, default=1)
    parser.add_argument("--ragas-batch-sleep", type=float, default=18.0)
    parser.add_argument("--update-eval-report", action="store_true")
    args = parser.parse_args()

    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Dataset no encontrado en {DATASET_PATH}")

    all_cases = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    in_domain = [c for c in all_cases if not c.get("is_trap")]
    traps = [c for c in all_cases if c.get("is_trap")]
    if args.in_domain_limit > 0:
        in_domain = _select_stratified(in_domain, args.in_domain_limit) if args.stratified else in_domain[: args.in_domain_limit]
    cases = in_domain + traps

    if args.mode == "backend-java":
        client = JavaBackendRagClient()
        print("Ingiriendo corpus PDF en backend Java (Zero-Retention)...")
        client.bootstrap_and_ingest()
        v1_metrics = evaluate_pipeline_suite(
            "Omega V1.0 Backend Java (Híbrido RRF + OpenAI)",
            lambda q: client.query(q, top_k=args.top_k),
            cases,
            judge_model=args.judge_model,
            inter_query_sleep_s=1.0,
            ragas_batch_size=args.ragas_batch_size,
            ragas_batch_sleep_s=args.ragas_batch_sleep,
        )
        write_eval_report(v1_metrics, len(cases), "backend-java-chat", args.judge_model)
        print(f"Reporte Backend Java generado en: {EVAL_REPORT_PATH}")
        return

    groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"), max_retries=0)
    embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
    db = CorpusDbClient()

    mvp_metrics = evaluate_pipeline_suite(
        "Baseline MVP (Vectorial Puro Top-K)",
        lambda q: run_vector_baseline(q, db, embedder, groq_client, args.gen_model, top_k=args.top_k),
        cases,
        judge_model=args.judge_model,
        inter_query_sleep_s=args.inter_query_sleep,
        ragas_batch_size=args.ragas_batch_size,
        ragas_batch_sleep_s=args.ragas_batch_sleep,
    )

    print("\nEsperando 30s para liberar cuota TPM de Groq antes de evaluar Omega V1.0...")
    time.sleep(30.0)

    v1_metrics = evaluate_pipeline_suite(
        "Omega V1.0 (Híbrido RRF + Bilingüe OR + Frase CVE)",
        lambda q: run_hybrid_rrf_v1(q, db, embedder, groq_client, args.gen_model, top_k=args.top_k),
        cases,
        judge_model=args.judge_model,
        inter_query_sleep_s=args.inter_query_sleep,
        ragas_batch_size=args.ragas_batch_size,
        ragas_batch_sleep_s=args.ragas_batch_sleep,
    )

    judge_max_tokens = 1600 if "qwen" in args.judge_model.lower() else 2048
    report_md = [
        "![OMEGA — Visualización de Marca](../../../img/banner.png)",
        "",
        "# Estudio Comparativo de Ablación — MVP vs. Omega V1.0 (Objetivo 6)",
        "",
        f"- **Corpus evaluado:** {len(cases)} casos ({len(in_domain)} dominio CTI + {len(traps)} abstención RNF1)",
        f"- **Modelo generativo (idéntico en ambos):** `{args.gen_model}` (`temperature=0.0`, `top_k={args.top_k}`)",
        f"- **Juez RAGAS:** `{args.judge_model}` (`max_tokens={judge_max_tokens}`, fragmentos completos sin truncar)",
        "- **Embeddings de recuperación:** `paraphrase-multilingual-mpnet-base-v2` (768d) sobre `public.document_chunks`",
        "",
        "## Nota Metodológica (Corrección del Arnés y Recuperación)",
        "",
        "La versión inicial del estudio presentó `Faithfulness = 0.0` y falsas abstenciones por defectos combinados de arnés y recuperación, ya aislados y corregidos:",
        "1. **Reconstrucción completa de página (`(report_id, page_number)`):** Cada página PDF se divide en 2–5 chunks solapados; recuperar sub-chunks aislados privaba al generador de evidencia contigua presente en la misma página y provocaba abstenciones innecesarias.",
        "2. **Componentización léxica compatible con `pg_catalog.simple` (`to_tsquery`):** Los identificadores con guiones (`CVE-YYYY-NNNN` y fechas `YYYY-MM-DD`) son tokenizados por PostgreSQL con prefijo negativo (`-2021`, `-1048`); se añadieron disyunciones firmadas exactas además de expansión técnica bilingüe español→inglés.",
        "3. **Normalización de citas Unicode y sin truncamiento al juez:** Se convirtieron corchetes fullwidth (`【1】 -> [1]`) en post-procesamiento, se pasó el 100% de los fragmentos reconstruidos a RAGAS sin recortar (`[:500]`) y se evaluó secuencialmente por métrica para respetar cuotas OTPM/TPM.",
        "4. **Medición limpia de latencia:** La latencia neta separa los `time.sleep` de backoff por cuota gratuita (8,000 TPM en Groq) del tiempo real de recuperación e inferencia.",
        "",
        "## Resultados Comparativos",
        "",
        "| Métrica / Dimensión | Baseline MVP (Vectorial) | Omega V1.0 (Híbrido RRF) | Variación (Δ) | Requerimiento |",
        "| :--- | :---: | :---: | :---: | :--- |",
        f"| **RAGAS Faithfulness** (0–1) | {mvp_metrics['faithfulness']} ({mvp_metrics['ragas_valid_faith']}/{mvp_metrics['ragas_total']}) | **{v1_metrics['faithfulness']}** ({v1_metrics['ragas_valid_faith']}/{v1_metrics['ragas_total']}) | {fmt_delta(v1_metrics['faithfulness'], mvp_metrics['faithfulness'])} | Objetivo 3, RNF1 |",
        f"| **RAGAS Answer Relevancy** (0–1) | {mvp_metrics['relevancy']} ({mvp_metrics['ragas_valid_rel']}/{mvp_metrics['ragas_total']}) | **{v1_metrics['relevancy']}** ({v1_metrics['ragas_valid_rel']}/{v1_metrics['ragas_total']}) | {fmt_delta(v1_metrics['relevancy'], mvp_metrics['relevancy'])} | Objetivo 6, RF4 |",
        f"| **RAGAS Context Precision** (0–1) | {mvp_metrics['context_precision']} ({mvp_metrics['ragas_valid_prec']}/{mvp_metrics['ragas_total']}) | **{v1_metrics['context_precision']}** ({v1_metrics['ragas_valid_prec']}/{v1_metrics['ragas_total']}) | {fmt_delta(v1_metrics['context_precision'], mvp_metrics['context_precision'])} | Objetivo 2, RF3 |",
        f"| **Recuperación Hit@3 / Hit@5** | {mvp_metrics['hit_at_3']}% / {mvp_metrics['hit_at_5']}% | **{v1_metrics['hit_at_3']}% / {v1_metrics['hit_at_5']}%** | {fmt_delta(v1_metrics['hit_at_5'], mvp_metrics['hit_at_5'], '%')} (Hit@5) | Objetivo 2, RF3 |",
        f"| **MRR@5 (Ranking de Fuente Exacta)** | {mvp_metrics['mrr_at_5']} | **{v1_metrics['mrr_at_5']}** | {fmt_delta(v1_metrics['mrr_at_5'], mvp_metrics['mrr_at_5'])} | Objetivo 2, RF3 |",
        f"| **Cumplimiento de Citas Inline** | {mvp_metrics['citation_rate']}% ({mvp_metrics['citation_hits']}/{mvp_metrics['in_domain_total']}) | **{v1_metrics['citation_rate']}%** ({v1_metrics['citation_hits']}/{v1_metrics['in_domain_total']}) | {fmt_delta(v1_metrics['citation_rate'], mvp_metrics['citation_rate'], '%')} | RNF1 |",
        f"| **Tasa de Abstención (Anti-Alucinación)** | {mvp_metrics['abstention_rate']}% ({mvp_metrics['trap_hits']}/{mvp_metrics['trap_total']}) | **{v1_metrics['abstention_rate']}%** ({v1_metrics['trap_hits']}/{v1_metrics['trap_total']}) | {fmt_delta(v1_metrics['abstention_rate'], mvp_metrics['abstention_rate'], '%')} | RNF1 |",
        f"| **Latencia Media Neta** (sin backoff 429) | {mvp_metrics['mean_latency']}s | **{v1_metrics['mean_latency']}s** | {fmt_delta(v1_metrics['mean_latency'], mvp_metrics['mean_latency'], 's')} | RNF3 |",
    ]

    ABLATION_REPORT_PATH.write_text("\n".join(report_md) + "\n", encoding="utf-8")
    print(f"\nTabla comparativa corregida generada en: {ABLATION_REPORT_PATH}")

    if args.update_eval_report:
        write_eval_report(v1_metrics, len(cases), args.gen_model, args.judge_model)
        print(f"Reporte cuantitativo actualizado en: {EVAL_REPORT_PATH}")


if __name__ == "__main__":
    main()
