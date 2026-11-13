"""Script de bootstrap STIX 2.1 y smoke test integral para demo en vivo de OMEGA."""

from __future__ import annotations

from pathlib import Path
import httpx

try:
    from stix_ingestor import sync_stix2_directory
except ImportError:  # Ejecución ligera sin dependencias locales de ingestión
    sync_stix2_directory = None

API_URL = "http://localhost:8000/api"


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
    samples_dir = resolve_samples_dir()

    with httpx.Client(timeout=45.0) as client:
        print("1. Sincronizando feeds STIX 2.1 hacia PostgreSQL...")
        stix_res = None
        if sync_stix2_directory is not None:
            try:
                stix_res = sync_stix2_directory()
            except Exception:
                stix_res = None
        if stix_res is None:
            resp = client.post(f"{API_URL}/corpus/sync-stix2")
            resp.raise_for_status()
            stix_res = resp.json()
        print(
            f"   -> Archivos procesados: {stix_res['files_scanned']} | "
            f"IOCs parseados: {stix_res['iocs_parsed']} | IOCs nuevos: {stix_res['iocs_inserted']} | "
            f"Total BD: {stix_res.get('total_db_iocs', 'N/D')}"
        )

        # 2. Gobernanza y estado del corpus
        gov_resp = client.get(f"{API_URL}/system/governance", headers={"X-Workspace-Id": "demo_preflight"})
        gov_resp.raise_for_status()
        gov = gov_resp.json()
        stats = gov.get("corpus_stats") or gov.get("stats", gov)
        print(f"2. Corpus activo: {stats}")

        # 3. Memoria conversacional (Predator -> Windows sin mezclar Candiru)
        r1_resp = client.post(
            f"{API_URL}/chat",
            json={"query": "¿Qué es Predator y cómo se despliega?", "history": [], "top_k": 5},
        )
        r1_resp.raise_for_status()
        r1 = r1_resp.json()
        assert "Predator" in ((r1.get("resolved_context") or {}).get("family") or ""), (
            f"No fijó Predator en contexto: {r1.get('resolved_context')}"
        )

        r2_resp = client.post(
            f"{API_URL}/chat",
            json={
                "query": "¿Cómo actúa en Windows?",
                "history": [
                    {"role": "user", "content": "¿Qué es Predator y cómo se despliega?"},
                    {"role": "assistant", "content": r1["answer"]},
                ],
                "top_k": 5,
                "pinned_context": r1.get("resolved_context"),
            },
        )
        r2_resp.raise_for_status()
        r2 = r2_resp.json()
        assert "Predator" in ((r2.get("resolved_context") or {}).get("family") or ""), (
            f"Perdió Predator en turno 2: {r2.get('resolved_context')}"
        )
        assert "wmiutils.dll" not in r2["answer"].lower(), "Alucinación cruzada con Candiru detectada"
        assert "no hay evidencia suficiente en los reportes indexados" not in r2["answer"].lower(), (
            f"Turno 2 cayó en rechazo seco: {r2['answer']}"
        )
        print(
            f"3. Memoria conversacional y aislamiento de entidades: OK "
            f"(rewritten_query='{r2.get('rewritten_query')}')"
        )

        # 4. Triage Forense Paralelo con los samples reales del repo
        safari_file = samples_dir / "safari_history.json"
        crash_file = samples_dir / "shutdown_crash.ips"
        assert safari_file.exists() and crash_file.exists(), f"Faltan samples en {samples_dir}"
        triage_resp = client.post(
            f"{API_URL}/triage/parallel",
            files=[
                ("files", (safari_file.name, safari_file.read_bytes(), "application/json")),
                ("files", (crash_file.name, crash_file.read_bytes(), "text/plain")),
            ],
        )
        triage_resp.raise_for_status()
        triage = triage_resp.json()
        verdict = triage.get("diagnosis", {}).get("verdict_code")
        assert verdict == "CORROBORATED_INFECTION_PATTERN", triage.get("diagnosis")
        assert (triage.get("total_matches") or 0) >= 1, triage
        print(f"4. Triage paralelo (safari + crash.ips): Veredicto = {verdict} | Matches = {triage.get('total_matches')}")

        # 5. Prueba de Falso Positivo aislado
        fp_file = samples_dir / "false_positive_single_visit.json"
        assert fp_file.exists(), f"Falta sample en {samples_dir}"
        fp_resp = client.post(
            f"{API_URL}/triage/parallel",
            files=[("files", (fp_file.name, fp_file.read_bytes(), "application/json"))],
        )
        fp_resp.raise_for_status()
        fp_res = fp_resp.json()
        fp_code = fp_res.get("diagnosis", {}).get("verdict_code")
        assert fp_code == "LIKELY_FALSE_POSITIVE", fp_res.get("diagnosis")
        print(f"5. Diagnóstico diferencial (falso positivo): {fp_code} — {fp_res.get('diagnosis', {}).get('verdict_label')}")

        # 6. Verificación pasiva de enlace (refang + cruce CTI)
        link_resp = client.post(f"{API_URL}/link/verify", json={"url": "https://free247downloads[.]com/login"})
        link_resp.raise_for_status()
        link_res = link_resp.json()
        assert link_res.get("normalized_url") == "https://free247downloads.com/login", link_res
        assert link_res.get("risk_level") == "HIGH", link_res
        print(f"6. Verificador pasivo de enlace (refang + cruce): riesgo = {link_res.get('risk_level')} | {link_res.get('verdict')}")

    print("\n[OK] Todos los subsistemas de OMEGA respondieron correctamente.")


if __name__ == "__main__":
    run_preflight()
