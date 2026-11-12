import sys
import json
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

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
    delete_osint_asset,
    get_campaign_detail,
    list_campaigns,
    list_osint_assets,
    register_osint_asset,
    run_passive_osint_scan,
    run_rag_query,
    verify_indicators_ephemeral,
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
    return run_rag_query(payload.query, payload.top_k)


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
        return verify_indicators_ephemeral(raw_text)
    finally:
        del raw_bytes


@app.post("/api/ioc/verify/text", response_model=IocVerifyResponse)
async def verify_ioc_text(request: Request):
    """
    Verificación resiliente en memoria (RNF4).
    Acepta JSON estándar {"indicators_text": "..."}, texto plano o formato de PowerShell sin fallar.
    """
    raw_bytes = await request.body()
    raw_text = raw_bytes.decode("utf-8", errors="ignore")
    del raw_bytes

    text_to_analyze = raw_text
    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            text_to_analyze = (
                parsed.get("indicators_text")
                or parsed.get("text")
                or parsed.get("indicators")
                or raw_text
            )
        elif isinstance(parsed, list):
            text_to_analyze = " ".join(str(item) for item in parsed)
    except Exception:
        text_to_analyze = raw_text

    return verify_indicators_ephemeral(text_to_analyze)


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
def create_osint_asset(payload: OsintAssetCreate):
    try:
        return register_osint_asset(
            payload.asset_type, payload.asset_value, payload.explicit_consent
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/osint/assets")
def get_osint_assets():
    return {"assets": list_osint_assets()}


@app.post("/api/osint/assets/{asset_id}/scan", response_model=OsintExposureReport)
def scan_osint_asset(asset_id: str):
    report = run_passive_osint_scan(asset_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail="Activo no encontrado o sin consentimiento explícito vigente.",
        )
    return report


@app.delete("/api/osint/assets/{asset_id}")
def remove_osint_asset(asset_id: str):
    if not delete_osint_asset(asset_id):
        raise HTTPException(status_code=404, detail="Activo no encontrado.")
    return {"deleted": True}
