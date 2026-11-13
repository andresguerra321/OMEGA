import sys
import json
from datetime import datetime
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
from deep_forensics import (
    KNOWN_SAFE_ACCESSIBILITY_PREFIXES,
    annotate_sockets_with_cti,
    audit_device_admins,
    parse_dns_resolver_cache,
    parse_kernel_network_sockets,
)
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


@app.post("/api/corpus/sync-stix2")
def trigger_stix2_sync():
    """Sincroniza los feeds oficiales .stix2 locales hacia PostgreSQL."""
    return sync_stix2_directory()


class LiveDeviceSnapshot(BaseModel):
    device: dict
    device_admins_raw: str = ""
    packages_text: str = ""
    processes_text: str = ""
    proc_net_raw: str = ""
    dns_resolver_raw: str = ""


def _evaluate_device_posture(dev: dict, device_admins_raw: str) -> tuple[list[dict], list[dict]]:
    """Evalúa postura defensiva Android (Parche, SELinux, Accesibilidad, Device Admins, DoT, Sideloading)."""
    hardening_checks: list[dict] = []
    abuse_alerts: list[dict] = []

    # 1. Integridad SELinux y Verified Boot
    selinux = str(dev.get("selinux_status") or "Unknown").strip()
    boot_state = str(dev.get("verified_boot_state") or "unknown").strip().lower()
    selinux_ok = selinux.lower() == "enforcing"
    boot_ok = boot_state in ("green", "unknown", "")
    hardening_checks.append(
        {
            "control": "Integridad SELinux y Verified Boot",
            "status": "OK" if (selinux_ok and boot_ok) else "CRITICAL",
            "value": f"SELinux: {selinux} · Boot: {boot_state or 'N/D'}",
            "detail": (
                "Aislamiento obligatorio del kernel y arranque verificado intactos."
                if (selinux_ok and boot_ok)
                else "SELinux en modo Permissive o bootloader alterado; riesgo de manipulación de kernel/rootkit."
            ),
        }
    )

    # 2. Auditoría de nivel de parche de seguridad Android
    patch_str = str(dev.get("security_patch") or "").strip()
    try:
        patch_date = datetime.strptime(patch_str, "%Y-%m-%d")
        age_days = (datetime.now() - patch_date).days
        patch_outdated = age_days > 120
        hardening_checks.append(
            {
                "control": "Nivel de parche de seguridad",
                "status": "WARN" if patch_outdated else "OK",
                "value": patch_str,
                "detail": (
                    f"Parche con {age_days} días de antigüedad; expuesto a vectores 0-click/1-click conocidos."
                    if patch_outdated
                    else f"Parche actualizado ({patch_str})."
                ),
            }
        )
    except ValueError:
        hardening_checks.append(
            {
                "control": "Nivel de parche de seguridad",
                "status": "UNKNOWN",
                "value": patch_str or "N/D",
                "detail": "No se pudo determinar la fecha exacta del parche.",
            }
        )

    # 3. Servicios de Accesibilidad Activos (vector crítico de robo de mensajería y permisos en Android)
    acc_raw = str(dev.get("accessibility_services") or "null").strip()
    if acc_raw and acc_raw.lower() not in ("null", "none", ""):
        services = [s.strip() for s in acc_raw.split(":") if s.strip()]
        suspicious_acc = [
            s for s in services if not any(s.lower().startswith(safe) for safe in KNOWN_SAFE_ACCESSIBILITY_PREFIXES)
        ]
        for svc in suspicious_acc:
            abuse_alerts.append(
                {
                    "severity": "HIGH",
                    "category": "Abuso Potencial de Accesibilidad",
                    "indicator": svc,
                    "detail": "Permite leer contenido en pantalla (WhatsApp/Signal) y automatizar toques sin interacción.",
                }
            )
        hardening_checks.append(
            {
                "control": "Servicios de Accesibilidad Activos",
                "status": "WARN" if suspicious_acc else "OK",
                "value": f"{len(services)} activos ({len(suspicious_acc)} terceros)",
                "detail": (
                    f"Servicios de terceros activos: {', '.join(suspicious_acc)}"
                    if suspicious_acc
                    else "Solo servicios oficiales del sistema habilitados."
                ),
            }
        )
    else:
        hardening_checks.append(
            {
                "control": "Servicios de Accesibilidad Activos",
                "status": "OK",
                "value": "Ninguno",
                "detail": "Sin servicios de lectura de pantalla de terceros habilitados.",
            }
        )

    # 4. Administradores de Dispositivo (dumpsys device_policy)
    admins, suspicious_admins = audit_device_admins(device_admins_raw)
    if device_admins_raw.strip():
        for adm in suspicious_admins:
            abuse_alerts.append(
                {
                    "severity": "HIGH",
                    "category": "Administrador de Dispositivo (Device Admin)",
                    "indicator": adm,
                    "detail": "Privilegio elevado capaz de bloquear desinstalación, imponer políticas o borrar datos.",
                }
            )
        hardening_checks.append(
            {
                "control": "Administradores de Dispositivo",
                "status": "WARN" if suspicious_admins else "OK",
                "value": f"{len(admins)} activos ({len(suspicious_admins)} terceros)" if admins else "Solo sistema",
                "detail": (
                    f"Administradores externos detectados: {', '.join(suspicious_admins)}"
                    if suspicious_admins
                    else "Sin administradores de terceros anómalos en device_policy."
                ),
            }
        )

    # 5. DNS Privado Cifrado (DoT — mitigación en 1 clic)
    dns_mode = str(dev.get("private_dns_mode") or "off").strip().lower()
    dns_host = str(dev.get("private_dns_specifier") or "").strip()
    dns_ok = dns_mode == "hostname" and bool(dns_host) and dns_host.lower() != "null"
    hardening_checks.append(
        {
            "control": "DNS Privado Cifrado (DNS-over-TLS)",
            "status": "OK" if dns_ok else "WARN",
            "value": dns_host if dns_ok else dns_mode,
            "detail": (
                f"Resoluciones DNS cifradas mediante {dns_host}."
                if dns_ok
                else "DNS sin cifrar; expuesto a secuestro DNS o inyección de red en tránsito (mitigable en 1 clic)."
            ),
        }
    )

    # 6. Orígenes desconocidos (sideloading APK legacy)
    unknown_src = str(dev.get("install_non_market_apps") or "").strip().lower()
    if unknown_src:
        hardening_checks.append(
            {
                "control": "Instalación desde orígenes desconocidos",
                "status": "WARN" if unknown_src == "1" else "OK",
                "value": (
                    "Habilitado"
                    if unknown_src == "1"
                    else ("Desactivado" if unknown_src == "0" else "Control por app (Android 8+)")
                ),
                "detail": (
                    "Permite instalar APKs fuera de Google Play; vector común en implantes 1-click Android."
                    if unknown_src == "1"
                    else "Sin habilitación global de sideloading legacy."
                ),
            }
        )

    return hardening_checks, abuse_alerts


@app.post("/api/triage/device-live")
async def live_device_triage(payload: LiveDeviceSnapshot):
    """Auditoría forense profunda en vivo vía USB ADB (Kernel sockets, DNS, Accesibilidad, SELinux e IOCs)."""
    hardening_checks, abuse_alerts = _evaluate_device_posture(payload.device, payload.device_admins_raw)

    live_sockets = annotate_sockets_with_cti(parse_kernel_network_sockets(payload.proc_net_raw))
    cached_dns_domains = parse_dns_resolver_cache(payload.dns_resolver_raw)

    for sock in live_sockets:
        if sock.get("cti_match"):
            abuse_alerts.append(
                {
                    "severity": "CRITICAL",
                    "category": "Socket Vivo a Infraestructura C2",
                    "indicator": f"{sock['remote_ip']}:{sock['remote_port']} ({sock['state']})",
                    "detail": f"Conexión kernel activa contra IP asociada a {sock.get('spyware_family') or 'spyware'}.",
                }
            )

    network_telemetries = "\n".join(
        [f"{s['remote_ip']}:{s['remote_port']} ({s['state']})" for s in live_sockets] + cached_dns_domains
    )

    artifacts = []
    if payload.packages_text.strip():
        artifacts.append({"filename": "adb_installed_packages.txt", "bytes": payload.packages_text.encode("utf-8")})
    if payload.processes_text.strip():
        artifacts.append({"filename": "adb_running_processes.txt", "bytes": payload.processes_text.encode("utf-8")})
    if network_telemetries.strip():
        artifacts.append({"filename": "adb_live_dns_sockets.txt", "bytes": network_telemetries.encode("utf-8")})

    try:
        triage_report = await run_parallel_forensic_triage(artifacts)
    finally:
        for art in artifacts:
            art["bytes"] = b""
        artifacts.clear()

    return {
        "device_summary": payload.device,
        "hardening_checks": hardening_checks,
        "abuse_alerts": abuse_alerts,
        "live_sockets": live_sockets[:40],
        "live_sockets_total": len(live_sockets),
        "cached_dns_count": len(cached_dns_domains),
        "cached_dns_sample": cached_dns_domains[:25],
        "yara_hits": triage_report.get("yara_hits", []),
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
