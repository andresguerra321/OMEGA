import json
import os
import re
import statistics
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")
sys.path.append(str(ROOT_DIR / "api"))

from services import run_rag_query  # noqa: E402
from langchain_groq import ChatGroq  # noqa: E402
from langchain_huggingface import HuggingFaceEmbeddings  # noqa: E402
from ragas import EvaluationDataset, RunConfig, SingleTurnSample, evaluate  # noqa: E402
from ragas.embeddings import LangchainEmbeddingsWrapper  # noqa: E402
from ragas.llms import LangchainLLMWrapper  # noqa: E402
from ragas.metrics import Faithfulness, ResponseRelevancy  # noqa: E402

DATASET_PATH = Path(__file__).resolve().parent / "eval_dataset.json"
REPORT_PATH = Path(__file__).resolve().parent / "eval_report.md"

CITATION_REGEX = re.compile(
    r"\[.+?,\s*P[aá]g(?:ina)?\.?\s*\d+\]|\[.+?,\s*p\.?\s*\d+\]|p[aá]g(?:ina)?\s*\d+.*?\[.+?\]",
    re.IGNORECASE,
)


def execute_benchmark():
    if not DATASET_PATH.exists():
        raise FileNotFoundError("Ejecuta primero generate_dataset.py para crear eval_dataset.json.")

    cases = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    in_domain_samples = []
    latencies = []
    citation_hits = 0
    in_domain_total = 0
    trap_hits = 0
    trap_total = 0
    detailed_rows = []

    print(f"Ejecutando {len(cases)} consultas contra el pipeline RAG de Omega...\n")

    for idx, item in enumerate(cases, start=1):
        t0 = time.perf_counter()
        result = run_rag_query(item["question"], top_k=5)
        elapsed = round(time.perf_counter() - t0, 3)
        latencies.append(elapsed)

        answer = result["answer"]
        contexts = [c["snippet"] for c in result["citations"]]

        if item.get("is_trap"):
            trap_total += 1
            abstained = "no hay evidencia suficiente" in answer.lower()
            if abstained:
                trap_hits += 1
            status = "Abstención correcta (RNF1)" if abstained else "Fallo: posible alucinación"
        else:
            in_domain_total += 1
            has_citation = bool(CITATION_REGEX.search(answer))
            if has_citation:
                citation_hits += 1
            status = "Cita verificada" if has_citation else "Sin formato de cita"

            in_domain_samples.append(
                SingleTurnSample(
                    user_input=item["question"],
                    response=answer,
                    retrieved_contexts=contexts,
                    reference=item["ground_truth"],
                )
            )

        detailed_rows.append(
            {
                "id": idx,
                "type": "Trampa (Fuera de corpus)" if item.get("is_trap") else "Dominio CTI",
                "question": item["question"],
                "latency": elapsed,
                "status": status,
            }
        )
        print(f"  [{idx}/{len(cases)}] {elapsed}s -> {status}")
        time.sleep(8.0)  # Evita saturar TPM de Groq (8000 tokens/min)

    print("\nCalculando métricas RAGAS (Faithfulness y Response Relevancy)...")
    evaluator_llm = LangchainLLMWrapper(
        ChatGroq(
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            temperature=0,
            max_retries=10,
        )
    )
    evaluator_embeddings = LangchainEmbeddingsWrapper(
        HuggingFaceEmbeddings(model_name="sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
    )

    ragas_dataset = EvaluationDataset(samples=in_domain_samples)
    relevancy_metric = ResponseRelevancy(strictness=1, embeddings=evaluator_embeddings)
    ragas_result = evaluate(
        dataset=ragas_dataset,
        metrics=[Faithfulness(), relevancy_metric],
        llm=evaluator_llm,
        embeddings=evaluator_embeddings,
        run_config=RunConfig(max_workers=1, timeout=120),
    )

    df = ragas_result.to_pandas()
    faithfulness_score = round(float(df["faithfulness"].mean()), 4)
    relevancy_score = round(float(df["answer_relevancy"].mean()), 4)
    citation_rate = round((citation_hits / in_domain_total) * 100, 1) if in_domain_total else 0.0
    abstention_rate = round((trap_hits / trap_total) * 100, 1) if trap_total else 0.0
    mean_latency = round(statistics.mean(latencies), 3)
    max_latency = round(max(latencies), 3)

    md_lines = [
        "# Reporte de Evaluación Cuantitativa — Sistema RAG Omega (Objetivo 6)",
        "",
        "## 1. Resumen de Métricas",
        "",
        "| Dimensión Evaluada | Métrica | Resultado | Requerimiento Asociado |",
        "| :--- | :--- | :---: | :--- |",
        f"| **Fidelidad Documental** | RAGAS Faithfulness (0–1) | **{faithfulness_score}** | Objetivo 3, Objetivo 6, RNF1 |",
        f"| **Relevancia de Respuesta** | RAGAS Answer Relevancy (0–1) | **{relevancy_score}** | Objetivo 6, RF4 |",
        f"| **Trazabilidad Estricta** | Cumplimiento de citas `[Reporte, Pág. X]` | **{citation_rate}%** ({citation_hits}/{in_domain_total}) | RNF1 |",
        f"| **Control Anti-Alucinación** | Tasa de abstención fuera de dominio | **{abstention_rate}%** ({trap_hits}/{trap_total}) | RNF1 |",
        f"| **Rendimiento Interactivo** | Latencia media / máxima | **{mean_latency}s** / {max_latency}s | RNF3 |",
        "",
        "## 2. Detalle por Caso de Prueba",
        "",
        "| # | Tipo | Latencia | Estado de Trazabilidad | Consulta |",
        "| :---: | :--- | :---: | :--- | :--- |",
    ]

    for r in detailed_rows:
        q_clean = r["question"].replace("|", "/")
        md_lines.append(f"| {r['id']} | {r['type']} | {r['latency']}s | {r['status']} | {q_clean} |")

    REPORT_PATH.write_text("\n".join(md_lines), encoding="utf-8")
    print(f"\nEvaluación completada. Reporte listo en: {REPORT_PATH}")


if __name__ == "__main__":
    execute_benchmark()
