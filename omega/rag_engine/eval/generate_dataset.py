import json
import os
from pathlib import Path
import psycopg
from groq import Groq
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@localhost:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
OUTPUT_PATH = Path(__file__).resolve().parent / "eval_dataset.json"

QA_GEN_PROMPT = """Eres un evaluador académico de Cyber Threat Intelligence.
A partir del FRAGMENTO técnico proporcionado, genera UNA pregunta específica en español que un analista haría sobre ese contenido y su respuesta esperada (ground truth) basada EXCLUSIVAMENTE en el fragmento.
Devuelve un objeto JSON válido con esta estructura:
{
  "question": "Pregunta técnica concreta en español",
  "ground_truth": "Respuesta factual concisa extraída únicamente del fragmento"
}"""

TRAP_QUESTIONS = [
    {
        "question": "¿Qué infraestructura de comando y control utilizó el ransomware LockBit 3.0 en Colombia durante 2025?",
        "ground_truth": "No hay evidencia suficiente en los reportes indexados para responder esta consulta.",
        "is_trap": True,
        "source_title": "N/A (Prueba de abstención RNF1)",
        "source_page": 0,
    },
    {
        "question": "¿Cuál es la clave privada PGP utilizada por NSO Group para firmar actualizaciones de Pegasus?",
        "ground_truth": "No hay evidencia suficiente en los reportes indexados para responder esta consulta.",
        "is_trap": True,
        "source_title": "N/A (Prueba de abstención RNF1)",
        "source_page": 0,
    },
    {
        "question": "¿Qué vulnerabilidad crítica afecta al kernel de Windows Server 2022 en el módulo SMBv3 según los reportes?",
        "ground_truth": "No hay evidencia suficiente en los reportes indexados para responder esta consulta.",
        "is_trap": True,
        "source_title": "N/A (Prueba de abstención RNF1)",
        "source_page": 0,
    },
]


def build_dataset(target_samples: int = 10):
    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT dc.content, dc.page_number, r.title
                FROM document_chunks dc
                JOIN reports r ON dc.report_id = r.id
                WHERE LENGTH(dc.content) > 350
                ORDER BY RANDOM()
                LIMIT %s;
                """,
                (target_samples,),
            )
            rows = cur.fetchall()

    if not rows:
        raise RuntimeError("No hay fragmentos suficientes en document_chunks para generar el dataset.")

    dataset = []
    for idx, (content, page_num, title) in enumerate(rows, start=1):
        res = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": QA_GEN_PROMPT},
                {"role": "user", "content": f"Reporte: {title} (Pág. {page_num})\n\nFRAGMENTO:\n{content}"},
            ],
        )
        parsed = json.loads(res.choices[0].message.content)
        dataset.append(
            {
                "question": parsed["question"],
                "ground_truth": parsed["ground_truth"],
                "is_trap": False,
                "source_title": title,
                "source_page": page_num,
            }
        )
        print(f"[{idx}/{len(rows)}] Generada pregunta sobre '{title}' (Pág. {page_num})")

    dataset.extend(TRAP_QUESTIONS)
    OUTPUT_PATH.write_text(json.dumps(dataset, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDataset guardado en {OUTPUT_PATH} ({len(dataset)} casos de prueba en total).")


if __name__ == "__main__":
    build_dataset(target_samples=10)

