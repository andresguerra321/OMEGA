import sys
import json
from pathlib import Path
from fastapi import FastAPI, File, Header, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

# Garantizar que el directorio api esté en sys.path al ejecutar desde cualquier raíz
sys.path.insert(0, str(Path(__file__).resolve().parent))

from schemas import (
    ChatRequest,
    ChatResponse,
    IocRawRequest,
    IocVerifyResponse,
    OsintAssetCreate,
    OsintAssetOut,
    OsintExposureReport,
)
from services import (
    get_campaign_detail,
    list_campaigns,
    run_rag_query,
)
from forensic_engine import analyze_forensic_payload
from triage_orchestrator import run_parallel_forensic_triage
from stix_ingestor import sync_stix2_directory
from deep_forensics import build_adb_artifacts_in_ram, extract_ios_manifest_targets
from detection_engineering import generate_mvt_triage_script, generate_yara_for_campaign
from link_verifier import inspect_suspicious_link
from web_intel_loader import load_cti_url_in_ram
from osint_engine import (
    delete_osint_asset,
    list_osint_assets,
    register_osint_asset,
    run_passive_osint_scan,
)

app = FastAPI(
    title="Omega CTI API",
    description="API defensiva de Threat Intelligence sobre spyware comercial (RAG + Verificación MVT + OSINT).",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:4173",
        "tauri://localhost",
        "app://-",
        "null",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def root_redirect():
    """Redirige automáticamente la raíz a la documentación interactiva Swagger UI."""
    return RedirectResponse(url="/docs")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "omega-cti-api"}


# --- Endpoints RAG ---

@app.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(payload: ChatRequest):
    history_dicts = [t.model_dump() for t in payload.history]
    pinned_dict = payload.pinned_context.model_dump() if payload.pinned_context is not None else None
    return run_rag_query(
        payload.query,
        top_k=payload.top_k,
        history=history_dicts,
        source_filter=payload.source_filter,
        pinned_context=pinned_dict,
    )


@app.get("/api/chat", include_in_schema=False)
def chat_get_info():
    return {
        "message": "El endpoint /api/chat requiere el método POST con un payload JSON {'query': '...'}. Pruébalo interactivamente en /docs"
    }


# --- Endpoints IOC / MVT ---

@app.post("/api/ioc/verify/file", response_model=IocVerifyResponse)
async def verify_ioc_file(file: UploadFile = File(...)):
    raw_bytes = await file.read()
    try:
        raw_text = raw_bytes.decode("utf-8", errors="ignore")
        return analyze_forensic_payload(raw_text, filename=file.filename)
    finally:
        del raw_bytes


@app.post("/api/ioc/verify/text", response_model=IocVerifyResponse)
def verify_ioc_text(payload: IocRawRequest):
    return analyze_forensic_payload(payload.indicators_text, filename="consulta_manual.txt")


@app.get("/api/ioc/verify/text", include_in_schema=False)
@app.get("/api/ioc/verify/file", include_in_schema=False)
def ioc_get_info():
    return {
        "message": "Los endpoints de verificación de IOCs requieren método POST. Pruébalos interactivamente en /docs"
    }


# --- Endpoints Campañas ---

@app.get("/api/campaigns")
def campaigns_index():
    return {"campaigns": list_campaigns()}


@app.get("/api/campaigns/{campaign_id}")
def campaign_detail(campaign_id: str):
    detail = get_campaign_detail(campaign_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Campaña no encontrada.")
    return detail


# --- Endpoints OSINT Defensivo (RF8, RNF8) ---

@app.post("/api/osint/assets", response_model=OsintAssetOut)
def create_osint_asset(
    payload: OsintAssetCreate,
    x_workspace_id: str = Header(default="default_analyst"),
):
    try:
        return register_osint_asset(
            payload.asset_type,
            payload.asset_value,
            payload.explicit_consent,
            owner_token=x_workspace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/osint/assets")
def get_osint_assets(x_workspace_id: str = Header(default="default_analyst")):
    return {"assets": list_osint_assets(owner_token=x_workspace_id)}


@app.post("/api/osint/assets/{asset_id}/scan", response_model=OsintExposureReport)
def scan_osint_asset(
    asset_id: str,
    x_workspace_id: str = Header(default="default_analyst"),
):
    report = run_passive_osint_scan(asset_id, owner_token=x_workspace_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail="Activo no encontrado o sin consentimiento explícito vigente.",
        )
    return report


@app.delete("/api/osint/assets/{asset_id}")
def remove_osint_asset(
    asset_id: str,
    x_workspace_id: str = Header(default="default_analyst"),
):
    if not delete_osint_asset(asset_id, owner_token=x_workspace_id):
        raise HTTPException(status_code=404, detail="Activo no encontrado.")
    return {"deleted": True}


# --- Endpoints Triage Forense Paralelo & Ingeniería de Detección (RF5, RF6, RNF4, RNF7) ---

@app.post("/api/triage/parallel")
async def parallel_forensic_triage(files: list[UploadFile] = File(...)):
    """Ejecuta Subagentes A, B y C en paralelo sobre múltiples artefactos en RAM (RF5, RNF4)."""
    artifacts = []
    for f in files:
        content = await f.read()
        artifacts.append({"filename": f.filename or "artifact.bin", "bytes": content})

    try:
        return await run_parallel_forensic_triage(artifacts)
    finally:
        # Liberación explícita de todos los buffers en memoria (RNF4)
        for art in artifacts:
            art["bytes"] = b""
        artifacts.clear()


@app.post("/api/corpus/sync-stix2")
def trigger_stix2_sync():
    """Sincroniza los feeds oficiales .stix2 locales hacia PostgreSQL."""
    return sync_stix2_directory()


class LiveDeviceSnapshot(BaseModel):
    platform: str = "android"
    device: dict
    device_admins_raw: str = ""
    packages_text: str = ""
    processes_text: str = ""
    proc_net_raw: str = ""
    dns_resolver_raw: str = ""
    crashlogs: list[dict] = Field(default_factory=list)
    binary_artifacts: list[dict] = Field(default_factory=list)


@app.post("/api/triage/ios-manifest-targets")
async def ios_manifest_targets(manifest: UploadFile = File(...)):
    """Resuelve en RAM los fileIDs forenses relevantes desde un Manifest.db de iOS."""
    raw_bytes = await manifest.read()
    if len(raw_bytes) > 64 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Manifest.db excede el límite permitido (64 MB).")
    try:
        return extract_ios_manifest_targets(raw_bytes)
    finally:
        raw_bytes = b""


@app.post("/api/triage/device-live")
async def live_device_triage(payload: LiveDeviceSnapshot):
    """Capa 2 unificada: normaliza telemetría USB (Android ADB o iOS) a RAM y ejecuta triage_orchestrator."""
    dump = payload.model_dump()
    device_summary = dict(payload.device or {})
    device_summary.setdefault("platform", payload.platform)
    dump["device"] = device_summary
    artifacts = build_adb_artifacts_in_ram(dump)

    try:
        triage_report = await run_parallel_forensic_triage(artifacts)
    finally:
        for art in artifacts:
            art["bytes"] = b""
        artifacts.clear()

    return {
        "device_summary": device_summary,
        "hardening_checks": triage_report.get("hardening_checks", []),
        "abuse_alerts": triage_report.get("abuse_alerts", []),
        "live_sockets": triage_report.get("live_sockets", []),
        "live_sockets_total": triage_report.get("live_sockets_total", 0),
        "cached_dns_count": triage_report.get("cached_dns_count", 0),
        "cached_dns_sample": triage_report.get("cached_dns_sample", []),
        "yara_hits": triage_report.get("yara_hits", []),
        "behavioral_anomalies": triage_report.get("behavioral_anomalies", []),
        "manifest_findings": triage_report.get("manifest_findings", []),
        "triage": triage_report,
    }


@app.get("/api/campaigns/{campaign_id}/yara")
def campaign_yara_rule(campaign_id: str):
    res = generate_yara_for_campaign(campaign_id)
    if not res:
        raise HTTPException(status_code=404, detail="Campaña no encontrada.")
    return res


@app.get("/api/campaigns/{campaign_id}/mvt-script")
def campaign_mvt_script(campaign_id: str):
    res = generate_mvt_triage_script(campaign_id)
    if not res:
        raise HTTPException(status_code=404, detail="Campaña no encontrada.")
    return res


# --- Endpoints Verificador Pasivo de Enlaces & Gobernanza (RF7, RNF4, RNF7, RNF8) ---

class LinkCheckRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)


@app.post("/api/link/verify")
def verify_link_endpoint(payload: LinkCheckRequest):
    try:
        return inspect_suspicious_link(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/system/governance")
def system_governance_status(x_workspace_id: str = Header(default="default_analyst")):
    """Entrega métricas de trazabilidad del corpus (RF7) y estado de permisos/consentimientos (RNF4, RNF8)."""
    from services import DB_DSN
    import psycopg

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM reports;")
            reports_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM document_chunks;")
            chunks_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM iocs;")
            iocs_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM campaigns;")
            campaigns_count = cur.fetchone()[0]
            cur.execute(
                """
                SELECT COUNT(*)
                FROM osint_monitored_assets
                WHERE owner_token = %s AND explicit_consent = TRUE;
                """,
                (x_workspace_id,),
            )
            consented_assets = cur.fetchone()[0]
            cur.execute(
                """
                SELECT title, organization, publication_date::text, ingested_at::text
                FROM reports
                ORDER BY ingested_at DESC
                LIMIT 20;
                """
            )
            recent_reports = [
                {
                    "title": r[0],
                    "organization": r[1],
                    "publication_date": r[2],
                    "ingested_at": r[3],
                }
                for r in cur.fetchall()
            ]

    return {
        "workspace_id": x_workspace_id,
        "corpus_stats": {
            "reports": reports_count,
            "chunks": chunks_count,
            "iocs": iocs_count,
            "campaigns": campaigns_count,
        },
        "consented_osint_assets": consented_assets,
        "privacy_guarantees": {
            "forensic_volatile_ram": True,
            "passive_link_inspection": True,
            "explicit_osint_consent_enforced": True,
            "offensive_capabilities_disabled": True,
        },
        "indexed_sources": recent_reports,
    }


# --- Extractor CTI Volátil en RAM (LangChain WebBaseLoader RNF4) ---


class WebIntelScanRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)
    active_net4_ips: list[str] = Field(default_factory=list)
    persist_to_db: bool = True


def _lookup_known_cti_indicators(candidates: list[str]) -> list[dict]:
    """Cruza IPs y dominios extraídos contra el catálogo histórico de PostgreSQL."""
    cleaned = sorted({c.strip().lower() for c in candidates if c and c.strip()})[:160]
    if not cleaned:
        return []

    from services import DB_DSN
    import psycopg

    try:
        with psycopg.connect(DB_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT ON (LOWER(i.ioc_value), COALESCE(c.spyware_family, 'Spyware'))
                        i.ioc_value,
                        i.ioc_type,
                        COALESCE(c.spyware_family, 'Spyware'),
                        COALESCE(c.name, 'Catálogo OMEGA')
                    FROM iocs i
                    LEFT JOIN campaigns c ON i.campaign_id = c.id
                    WHERE LOWER(i.ioc_value) = ANY(%s)
                      AND i.ioc_type IN ('ip', 'domain', 'url')
                    ORDER BY
                        LOWER(i.ioc_value),
                        COALESCE(c.spyware_family, 'Spyware'),
                        CASE i.ioc_type WHEN 'ip' THEN 0 WHEN 'url' THEN 1 ELSE 2 END;
                    """,
                    (cleaned,),
                )
                return [
                    {
                        "ioc_value": r[0],
                        "ioc_type": r[1],
                        "spyware_family": r[2],
                        "campaign": r[3],
                    }
                    for r in cur.fetchall()
                ]
    except psycopg.Error:
        return []


@app.post("/api/intel/webloader-scan")
def scan_web_intel_source(payload: WebIntelScanRequest):
    """Ingiere en RAM una URL CTI (Citizen Lab / Amnesty / TAG), destruye HTML, unifica a PostgreSQL y cruza IPv4."""
    try:
        extracted = load_cti_url_in_ram(payload.url, persist_to_db=payload.persist_to_db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo descargar o analizar la fuente CTI en memoria: {exc}",
        )

    active_set = {ip.strip() for ip in payload.active_net4_ips if ip and ip.strip()}
    matched_live_sockets = sorted(active_set.intersection(extracted["ipv4_iocs"]))
    known_cti_matches = _lookup_known_cti_indicators(
        [*extracted["ipv4_iocs"], *extracted["domains"]]
    )

    return {
        **extracted,
        "matched_live_net4": matched_live_sockets,
        "known_cti_matches": known_cti_matches,
        "ram_only": True,
    }
