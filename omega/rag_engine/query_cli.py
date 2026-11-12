import os
from pathlib import Path
import psycopg
from pgvector.psycopg import register_vector
from sentence_transformers import SentenceTransformer
from groq import Groq
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@localhost:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")

SYSTEM_PROMPT = """Eres el motor analítico de Omega, una plataforma defensiva de Cyber Threat Intelligence sobre spyware comercial.
REGLAS ESTRICTAS DE TRAZABILIDAD (RNF1):
1. Responde ÚNICAMENTE utilizando la información contenida en los FRAGMENTOS DE CONTEXTO proporcionados.
2. Cada afirmación técnica, CVE, dominio, actor o fecha DEBE incluir una cita explícita en el formato: [Título del Reporte, Pág. X].
3. Si los fragmentos no contienen evidencia suficiente para responder, declara exactamente: "No hay evidencia suficiente en los reportes indexados para responder esta consulta." No extrapoles ni uses conocimiento externo.
4. Responde en español técnico, claro y estructurado."""


def retrieve_context(query: str, top_k: int = 5) -> list[dict]:
    q_vec = embedder.encode([query], normalize_embeddings=True)[0].tolist()
    with psycopg.connect(DB_DSN) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    r.title,
                    r.organization,
                    r.source_url,
                    dc.page_number,
                    dc.content,
                    1 - (dc.embedding <=> %s::vector) AS similarity
                FROM document_chunks dc
                JOIN reports r ON dc.report_id = r.id
                ORDER BY dc.embedding <=> %s::vector
                LIMIT %s;
                """,
                (q_vec, q_vec, top_k),
            )
            rows = cur.fetchall()

    return [
        {
            "title": row[0],
            "organization": row[1],
            "source_url": row[2],
            "page": row[3],
            "content": row[4],
            "similarity": round(float(row[5]), 4),
        }
        for row in rows
    ]


def ask_omega(question: str):
    chunks = retrieve_context(question, top_k=5)
    if not chunks:
        print("\n[Omega]: La base vectorial está vacía. Ejecuta primero ingest.py.\n")
        return

    context_blocks = []
    for i, c in enumerate(chunks, start=1):
        context_blocks.append(
            f"--- FRAGMENTO {i} (Similitud: {c['similarity']}) ---\n"
            f"Fuente: {c['title']} ({c['organization']}) | Página: {c['page']}\n"
            f"Contenido: {c['content']}\n"
        )

    user_prompt = (
        f"FRAGMENTOS DE CONTEXTO:\n{''.join(context_blocks)}\n"
        f"CONSULTA DEL ANALISTA:\n{question}"
    )

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )

    print("\n" + "=" * 70)
    print(completion.choices[0].message.content)
    print("\nFuentes recuperadas:")
    for c in chunks:
        print(f" - [{c['title']} | Pág. {c['page']}] (similitud: {c['similarity']})")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    print(f"Omega RAG CLI activo ({GROQ_MODEL}). Escribe 'salir' para terminar.\n")
    while True:
        q = input("Consulta CTI > ").strip()
        if q.lower() in {"salir", "exit", "quit"}:
            break
        if q:
            ask_omega(q)

