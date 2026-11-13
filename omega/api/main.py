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
from detection_engineering import generate_mvt_triage_script, generate_yara_for_campaign
from link_verifier import inspect_suspicious_link
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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    return run_rag_query(
        payload.query,
        top_k=payload.top_k,
        history=history_dicts,
        source_filter=payload.source_filter,
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
