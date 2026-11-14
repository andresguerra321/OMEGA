"""Smoke test del microservicio forense stateless (omega/api/) usando X-Internal-Service-Token."""

from __future__ import annotations

import os
from pathlib import Path
import httpx

API_URL = os.getenv("OMEGA_WORKER_URL", "http://localhost:8000/api")
INTERNAL_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")


def resolve_samples_dir() -> Path:
    api_dir = Path(__file__).resolve().parent
    for candidate in (
        api_dir.parent / "corpus_mvp" / "mvt_samples",
        api_dir / "corpus_mvp" / "mvt_samples",
        Path("/app/corpus_mvp/mvt_samples"),
    ):
        if candidate.is_dir():
            return candidate
    return api_dir.parent / "corpus_mvp" / "mvt_samples"


def run_preflight() -> None:
    if not INTERNAL_TOKEN:
        raise RuntimeError("Define INTERNAL_SERVICE_TOKEN en el entorno para autenticar contra el worker interno.")

    samples_dir = resolve_samples_dir()
    headers = {"X-Internal-Service-Token": INTERNAL_TOKEN}

    with httpx.Client(timeout=30.0) as client:
        # 1. Fail-closed sin header interno
        unauth = client.post(f"{API_URL}/link/verify", json={"url": "https://example.com"})
        assert unauth.status_code == 401, f"Se esperaba 401 sin token interno, recibido: {unauth.status_code}"
        print("1. Aislamiento por X-Internal-Service-Token (401 fail-closed): OK")

        # 2. Triage forense paralelo con los samples reales del repo
        safari_file = samples_dir / "safari_history.json"
        crash_file = samples_dir / "shutdown_crash.ips"
        assert safari_file.exists() and crash_file.exists(), f"Faltan samples en {samples_dir}"
        triage_resp = client.post(
            f"{API_URL}/triage/parallel",
            headers=headers,
            files=[
                ("files", (safari_file.name, safari_file.read_bytes(), "application/json")),
                ("files", (crash_file.name, crash_file.read_bytes(), "text/plain")),
            ],
        )
        triage_resp.raise_for_status()
        triage = triage_resp.json()
        print(
            f"2. Triage paralelo en RAM: Veredicto = {triage.get('diagnosis', {}).get('verdict_code')} "
            f"| Matches = {triage.get('total_matches')}"
        )

        # 3. Verificación pasiva de enlace
        link_resp = client.post(
            f"{API_URL}/link/verify",
            headers=headers,
            json={"url": "https://free247downloads[.]com/login"},
        )
        link_resp.raise_for_status()
        link_res = link_resp.json()
        assert link_res.get("normalized_url") == "https://free247downloads.com/login", link_res
        print(f"3. Verificador pasivo de enlace: riesgo = {link_res.get('risk_level')} | {link_res.get('verdict')}")

    print("\n[OK] Worker forense stateless verificado.")


if __name__ == "__main__":
    run_preflight()
