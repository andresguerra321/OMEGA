import argparse
import json
import os
from pathlib import Path

from groq import Groq
from sentence_transformers import SentenceTransformer

from eval_common import CorpusDbClient, evaluate_pipeline_suite, run_hybrid_rrf_v1
from java_backend_client import JavaBackendRagClient
from run_ablation_benchmark import write_eval_report

DATASET_PATH = Path(__file__).resolve().parent / "eval_dataset.json"
REPORT_PATH = Path(__file__).resolve().parent / "eval_report.md"


def execute_benchmark() -> None:
    parser = argparse.ArgumentParser(description="Evaluación cuantitativa RAGAS sobre los 23 casos de OMEGA.")
    parser.add_argument("--mode", choices=["corpus", "backend-java"], default="corpus")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--gen-model", default=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"))
    parser.add_argument("--judge-model", default=os.getenv("RAGAS_JUDGE_MODEL", "openai/gpt-oss-20b"))
    parser.add_argument("--inter-query-sleep", type=float, default=14.0)
    parser.add_argument("--ragas-batch-size", type=int, default=1)
    parser.add_argument("--ragas-batch-sleep", type=float, default=20.0)
    args = parser.parse_args()

    if not DATASET_PATH.exists():
        raise FileNotFoundError("Ejecuta primero generate_dataset.py para crear eval_dataset.json.")

    cases = json.loads(DATASET_PATH.read_text(encoding="utf-8"))

    if args.mode == "backend-java":
        client = JavaBackendRagClient()
        client.bootstrap_and_ingest()
        metrics = evaluate_pipeline_suite(
            "Omega V1.0 Backend Java",
            lambda q: client.query(q, top_k=args.top_k),
            cases,
            judge_model=args.judge_model,
            inter_query_sleep_s=1.0,
            ragas_batch_size=args.ragas_batch_size,
            ragas_batch_sleep_s=args.ragas_batch_sleep,
        )
        write_eval_report(metrics, len(cases), "backend-java-chat", args.judge_model)
    else:
        groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"), max_retries=0)
        embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
        db = CorpusDbClient()
        metrics = evaluate_pipeline_suite(
            "Omega V1.0 Híbrido RRF",
            lambda q: run_hybrid_rrf_v1(q, db, embedder, groq_client, args.gen_model, top_k=args.top_k),
            cases,
            judge_model=args.judge_model,
            inter_query_sleep_s=args.inter_query_sleep,
            ragas_batch_size=args.ragas_batch_size,
            ragas_batch_sleep_s=args.ragas_batch_sleep,
        )
        write_eval_report(metrics, len(cases), args.gen_model, args.judge_model)

    print(f"\nEvaluación completada. Reporte listo en: {REPORT_PATH}")


if __name__ == "__main__":
    execute_benchmark()
