import os
import time
import urllib.error
import urllib.request
import uuid
import json
from pathlib import Path

from eval_common import ABSTENTION_CANONICAL, ROOT_DIR


class JavaBackendRagClient:
    """Evalua el endpoint real Spring Boot POST /api/v1/expedientes/{id}/query (requiere OPENAI_API_KEY)."""

    def __init__(self, base_url: str | None = None, corpus_pdf_dir: Path | None = None):
        self.base_url = (base_url or os.getenv("OMEGA_JAVA_URL", "http://127.0.0.1:8080")).rstrip("/")
        self.corpus_pdf_dir = corpus_pdf_dir or (ROOT_DIR / "corpus_mvp" / "pdfs")
        self.token: str | None = None
        self.expediente_id: str | None = None

    def _json_request(self, method: str, path: str, payload: dict | None = None, auth: bool = True) -> dict:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"}
        if auth and self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def bootstrap_and_ingest(self, max_pdfs: int | None = None) -> None:
        slug = f"eval-{uuid.uuid4().hex[:8]}"
        reg = self._json_request(
            "POST",
            "/api/v1/auth/tenants/register",
            {
                "tenantSlug": slug,
                "tenantName": f"Eval {slug}",
                "adminEmail": f"eval@{slug}.local",
                "adminPassword": "EvalPassword2026!",
                "adminFullName": "Benchmark Evaluator",
            },
            auth=False,
        )
        self.token = reg["accessToken"]
        exp = self._json_request(
            "POST",
            "/api/v1/expedientes",
            {"title": f"RAG Benchmark {slug}", "classification": "INTERNAL"},
        )
        self.expediente_id = exp["id"]

        pdfs = sorted(self.corpus_pdf_dir.glob("*.pdf"))
        if max_pdfs:
            pdfs = pdfs[:max_pdfs]
        if not pdfs:
            raise FileNotFoundError(f"No hay PDFs en {self.corpus_pdf_dir}")

        import http.client
        from urllib.parse import urlparse

        parsed = urlparse(self.base_url)
        for pdf in pdfs:
            boundary = f"----OmegaBoundary{uuid.uuid4().hex}"
            pdf_bytes = pdf.read_bytes()
            body = (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{pdf.name}"\r\n'
                f"Content-Type: application/pdf\r\n\r\n"
            ).encode("utf-8") + pdf_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

            conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 8080, timeout=120)
            conn.request(
                "POST",
                f"/api/v1/expedientes/{self.expediente_id}/documents",
                body=body,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                },
            )
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8")
            conn.close()
            if resp.status not in (200, 202):
                raise RuntimeError(f"Error ingiriendo {pdf.name} en backend-java ({resp.status}): {raw}")
            doc_id = json.loads(raw)["id"]

            deadline = time.time() + 180
            while time.time() < deadline:
                st = self._json_request("GET", f"/api/v1/expedientes/{self.expediente_id}/documents/{doc_id}")
                if st["status"] == "INDEXED":
                    break
                if st["status"] in {"FAILED", "REINDEX_REQUIRED"}:
                    raise RuntimeError(f"Indexación fallida para {pdf.name}: {st}")
                time.sleep(1.0)
            else:
                raise TimeoutError(f"Timeout esperando indexación de {pdf.name}")
            print(f"  [Java Ingest] {pdf.name} -> INDEXED (SHA-256 Zero-Retention)")

    def query(self, question: str, top_k: int = 5) -> dict:
        if not self.expediente_id:
            raise RuntimeError("Ejecuta bootstrap_and_ingest() primero.")
        t0 = time.perf_counter()
        res = self._json_request(
            "POST",
            f"/api/v1/expedientes/{self.expediente_id}/query",
            {"question": question, "topK": top_k},
        )
        net_s = time.perf_counter() - t0
        citations = [
            {
                "index": idx,
                "title": c["originalFilename"],
                "organization": "Backend Java Zero-Retention",
                "page": c["pageNumber"],
                "snippet": c["excerpt"],
                "similarity": float(c["vectorScore"]),
                "rrf_score": float(c["rrfScore"]),
                "retrieval_method": "Java Híbrido RRF",
            }
            for idx, c in enumerate(res.get("citations", []), start=1)
        ]
        return {
            "answer": res.get("answer") or ABSTENTION_CANONICAL,
            "citations": citations,
            "net_latency_s": net_s,
            "backoff_s": 0.0,
            "retries": 0,
        }
