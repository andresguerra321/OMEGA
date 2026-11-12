import hashlib
import json
import os
from pathlib import Path
import fitz  # PyMuPDF
import psycopg
from pgvector.psycopg import register_vector
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

CORPUS_DIR = Path(__file__).resolve().parent.parent / "corpus_mvp"
PDFS_DIR = CORPUS_DIR / "pdfs"
MANIFEST_PATH = CORPUS_DIR / "corpus_manifest.json"

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@localhost:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

print("Cargando modelo de embeddings (768d)...")
embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-mpnet-base-v2")


def compute_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def chunk_page_text(text: str, chunk_size: int = 1100, overlap: int = 200) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    chunks = []
    start = 0
    while start < len(cleaned):
        end = start + chunk_size
        chunks.append(cleaned[start:end])
        start += chunk_size - overlap
    return chunks


def load_manifest_index() -> dict:
    if not MANIFEST_PATH.exists():
        return {}
    data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    items = data if isinstance(data, list) else data.get("reports", [])
    return {item["local_filename"]: item for item in items if "local_filename" in item}


def ingest_pdfs():
    manifest = load_manifest_index()
    pdf_files = sorted(PDFS_DIR.glob("*.pdf"))

    if not pdf_files:
        print(f"No se encontraron PDFs en {PDFS_DIR}")
        return

    with psycopg.connect(DB_DSN) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for pdf_path in pdf_files:
                file_hash = compute_sha256(pdf_path)

                cur.execute("SELECT id FROM reports WHERE file_hash = %s;", (file_hash,))
                if cur.fetchone():
                    print(f"[OMITIDO] Ya indexado: {pdf_path.name}")
                    continue

                meta = manifest.get(pdf_path.name, {})
                title = meta.get("title", pdf_path.stem.replace("_", " "))
                org = meta.get("organization", "Fuente Pública CTI")
                pub_date = meta.get("publication_date") or None
                source_url = meta.get("source_url", f"local://{pdf_path.name}")

                cur.execute(
                    """
                    INSERT INTO reports (title, organization, publication_date, source_url, local_filename, file_hash)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (title, org, pub_date, source_url, pdf_path.name, file_hash),
                )
                report_id = cur.fetchone()[0]

                doc = fitz.open(pdf_path)
                records = []
                chunk_idx = 0

                for page_num, page in enumerate(doc, start=1):
                    page_text = page.get_text("text")
                    for piece in chunk_page_text(page_text):
                        records.append((chunk_idx, page_num, piece))
                        chunk_idx += 1

                if not records:
                    print(f"[AVISO] Sin texto extraíble en {pdf_path.name}")
                    continue

                texts = [r[2] for r in records]
                vectors = embedder.encode(texts, normalize_embeddings=True)

                for (idx, p_num, content), vec in zip(records, vectors):
                    cur.execute(
                        """
                        INSERT INTO document_chunks (report_id, chunk_index, page_number, content, embedding, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s);
                        """,
                        (
                            report_id,
                            idx,
                            p_num,
                            content,
                            vec.tolist(),
                            json.dumps({"filename": pdf_path.name, "organization": org}),
                        ),
                    )

                conn.commit()
                print(f"[OK] {pdf_path.name} -> {len(records)} chunks en {len(doc)} páginas.")


if __name__ == "__main__":
    ingest_pdfs()

