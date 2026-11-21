#!/usr/bin/env python3
"""
Evaluación MANUAL con proveedores reales (Groq y Ollama) para el perfil LEGAL.
NUNCA se ejecuta en CI. Lee credenciales exclusivamente desde variables de entorno.

Compara recuperación en modo LOCAL_TEXT (tsvector) frente a embeddings reales (OpenAI/Ollama)
sobre el conjunto difícil (hard_benchmark_cases.json: contradicciones entre documentos,
casi-aciertos, paráfrasis semánticas y preguntas cruzadas entre expedientes).

Uso:
  python scripts/eval_legal_live_providers.py --provider groq --base-url http://127.0.0.1:8080
  python scripts/eval_legal_live_providers.py --provider ollama --base-url http://127.0.0.1:8080
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "omega" / "backend-java" / "src" / "test" / "resources" / "legal_benchmark" / "hard_benchmark_cases.json"


def _minimal_pdf_bytes(pages: list[str]) -> bytes:
    """Genera un PDF mínimo sintético válido (%PDF-1.4) sin dependencias externas."""
    objects: list[bytes] = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(len(pages)))
    objects.append(f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>\nendobj\n".encode("latin-1"))
    font_obj_num = 3 + len(pages) * 2
    for i, text in enumerate(pages):
        page_num = 3 + i * 2
        content_num = page_num + 1
        safe = text.encode("latin-1", errors="replace").decode("latin-1")
        safe = safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 11 Tf 50 700 Td ({safe}) Tj ET".encode("latin-1")
        objects.append(
            f"{page_num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_obj_num} 0 R >> >> /Contents {content_num} 0 R >>\nendobj\n".encode("latin-1")
        )
        objects.append(
            f"{content_num} 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode("latin-1")
            + stream
            + b"\nendstream\nendobj\n"
        )
    objects.append(f"{font_obj_num} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".encode("latin-1"))

    buf = io.BytesIO()
    buf.write(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(buf.tell())
        buf.write(obj)
    xref_pos = buf.tell()
    buf.write(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("latin-1"))
    for off in offsets[1:]:
        buf.write(f"{off:010d} 00000 n \n".encode("latin-1"))
    buf.write(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    return buf.getvalue()


def _http_json(url: str, method: str = "GET", body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else {}


def _http_upload_pdf(url: str, filename: str, pdf_bytes: bytes, token: str) -> dict:
    boundary = f"----OmegaBench{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + pdf_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluación manual del perfil LEGAL con proveedores reales (Groq/Ollama).")
    parser.add_argument("--provider", choices=["groq", "ollama"], required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    args = parser.parse_args()

    if args.provider == "groq" and not os.environ.get("GROQ_API_KEY"):
        print("ERROR: Define GROQ_API_KEY en el entorno antes de ejecutar la evaluación manual con Groq.", file=sys.stderr)
        return 2
    if args.provider == "ollama":
        ollama_url = os.environ.get("OMEGA_OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        print(f"[INFO] Evaluando contra Ollama local en {ollama_url} via backend {args.base_url}")

    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    api = args.base_url.rstrip("/") + "/api/v1"
    slug = f"legal-live-{uuid.uuid4().hex[:8]}"

    reg = _http_json(
        f"{api}/auth/tenants/register",
        method="POST",
        body={
            "tenantSlug": slug,
            "tenantName": "Evaluacion Sintetica Live",
            "adminEmail": f"eval@{slug}.invalid",
            "adminPassword": f"OmegaLive!{uuid.uuid4().hex[:6]}",
            "adminFullName": "Evaluador Sintetico",
        },
    )
    token = reg["accessToken"]
    _http_json(f"{api}/profile", method="PUT", body={"profile": "LEGAL", "confirmed": True}, token=token)

    policy = _http_json(f"{api}/legal/document-ai/policy", token=token)
    indexing_provider = policy.get("disclosure", {}).get("indexing", {}).get("provider", "UNKNOWN")
    indexing_model = policy.get("disclosure", {}).get("indexing", {}).get("model", "UNKNOWN")
    resp_providers = [r.get("provider") for r in policy.get("disclosure", {}).get("responses", [])]
    print(f"[POLICY] Indexación: {indexing_provider} ({indexing_model}) | Respuestas: {resp_providers}")

    _http_json(
        f"{api}/legal/document-ai/consent",
        method="POST",
        body={"fingerprint": policy["fingerprint"]},
        token=token,
    )

    case_ids: dict[str, str] = {}
    doc_ids: dict[str, str] = {}
    for c in fixture["cases"]:
        created = _http_json(
            f"{api}/expedientes",
            method="POST",
            body={"title": c["title"], "classification": "CONFIDENTIAL"},
            token=token,
        )
        case_ids[c["key"]] = created["id"]
        for d in c["documents"]:
            pdf = _minimal_pdf_bytes(d["pages"])
            up = _http_upload_pdf(f"{api}/expedientes/{created['id']}/documents", d["filename"], pdf, token)
            doc_id = up["id"]
            doc_ids[d["key"]] = doc_id
            for _ in range(60):
                st = _http_json(f"{api}/expedientes/{created['id']}/documents/{doc_id}", token=token)
                if st.get("status") in ("INDEXED", "FAILED", "REJECTED"):
                    break
                time.sleep(0.5)

    results = []
    for q in fixture["questions"]:
        t0 = time.perf_counter()
        res = _http_json(
            f"{api}/expedientes/{case_ids[q['caseKey']]}/query",
            method="POST",
            body={"question": q["question"], "topK": 6},
            token=token,
        )
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        answer = res.get("answer", "")
        citations = res.get("citations", [])
        cited_docs = {c.get("documentId") for c in citations}

        cat = q["category"]
        passed = False
        if cat == "CONTRADICTORY_DOCS":
            expected_docs = {doc_ids[k] for k in q["expectedDocKeys"]}
            passed = expected_docs.issubset(cited_docs) and all(t in answer for t in q["expectedTerms"])
        elif cat == "SEMANTIC_PARAPHRASE":
            expected_docs = {doc_ids[k] for k in q["expectedDocKeys"]}
            passed = expected_docs.issubset(cited_docs) and any(t.lower() in answer.lower() for t in q["expectedTerms"])
        elif cat == "CROSS_CASE":
            passed = (q["forbiddenTerm"].lower() not in answer.lower()) and (len(citations) == 0 or "No hay fragmentos relevantes suficientes" in answer)
        elif cat == "NEAR_MISS":
            forb = q.get("forbiddenFabrication", "")
            passed = (not forb or forb.lower() not in answer.lower())
        results.append((q["id"], cat, passed, len(citations), elapsed_ms, res.get("status")))

    print("\n=== RESULTADOS EVALUACIÓN REAL (MANUAL) ===")
    print(f"Proveedor solicitado: {args.provider} | Modo indexación real: {indexing_provider} ({indexing_model})")
    print(f"{'ID':<5} {'Categoría':<22} {'OK':<6} {'Citas':<6} {'ms':<7} {'Status'}")
    for row in results:
        print(f"{row[0]:<5} {row[1]:<22} {str(row[2]):<6} {row[3]:<6} {row[4]:<7} {row[5]}")
    ok_count = sum(1 for r in results if r[2])
    print(f"\nTotal superadas: {ok_count}/{len(results)} ({ok_count / len(results) * 100:.1f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
