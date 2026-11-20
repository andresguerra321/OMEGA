"""Worker forense OMEGA; análisis en RAM y contención nativa opcional con bóveda cifrada.

Aislado exclusivamente en la red privada Docker; autentica todas las llamadas
mediante el encabezado compartido `X-Internal-Service-Token` emitido por backend-java.
"""

from __future__ import annotations

import asyncio
import gc
import hmac
import hashlib
import logging
import os
import sys
import subprocess
import zipfile
import tarfile
import psutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from cryptography.exceptions import InvalidTag
import local_auth
from local_auth import signature
from self_integrity import verify_release, IntegrityError

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deep_forensics import build_adb_artifacts_in_ram, extract_ios_manifest_targets
from detection_engineering import generate_mvt_triage_script, generate_yara_for_campaign
from forensic_engine import analyze_forensic_payload
from host_forensics import run_host_live_audit
from persistence_auditor import audit_persistence
from host_runtime import host_scope, application_root
from realtime_watcher import watcher
from ios_backup_crypto import decrypt_binary_artifacts_in_ram, unlock_encrypted_ios_backup_in_ram
from link_verifier import inspect_suspicious_link
from urllib.parse import urlparse
from containment_engine import engine as containment_engine
from evasion_intelligence import inspect_evasion
from owasp_rules import scan_artifacts_with_owasp
from schemas import (
    ScanStatus,
    IocRawRequest,
    IocVerifyResponse,
    LinkCheckRequest,
    LiveDeviceSnapshot,
    MobileUsbAuditRequest,
    PcLiveSnapshot,
    RealtimeToggleRequest,
    HostIocSyncRequest,
    PersistenceAuditResponse,
    ContainmentRequest,
)
from triage_orchestrator import run_parallel_forensic_triage
from usb_device_connector import (
    get_usb_audit_job,
    list_connected_devices,
    start_usb_audit_job,
)
from yara_engine import get_yara_engine_status, scan_artifacts_with_yara

MAX_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 128 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app):
    try:
        verify_release(application_root())
        _app.state.integrity_ok = True
        _app.state.release_id = hashlib.sha256((application_root() / 'integrity-manifest.json').read_bytes()).hexdigest()
    except IntegrityError:
        _app.state.integrity_ok = False
        logging.getLogger(__name__).critical('INTEGRIDAD COMPROMETIDA: vigilancia y operaciones privilegiadas bloqueadas')
        if os.getenv('OMEGA_NATIVE_SENSOR') == '1':
            raise
    watcher.start(enabled=_app.state.integrity_ok and os.getenv('OMEGA_REALTIME_ENABLED', 'false').lower() == 'true')
    try:
        yield
    finally:
        await asyncio.to_thread(watcher.stop)

app = FastAPI(
    lifespan=lifespan,
    title="Omega Stateless Forensic Worker",
    description="Worker forense interno en RAM (MVT, YARA, iOS crypto, correlación temporal y verificación pasiva de enlaces).",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def verify_internal_service_token(request: Request, call_next):
    authenticator = local_auth.ACTIVE
    if authenticator is None and os.getenv('OMEGA_REQUIRE_HMAC', 'false').lower() == 'true':
        token = os.getenv('INTERNAL_SERVICE_TOKEN', '').strip()
        if not token:
            return JSONResponse(status_code=503, content={'detail': 'INTERNAL_SERVICE_TOKEN no configurado'})
        secret = hashlib.sha256(token.encode()).hexdigest()
        if getattr(app.state, 'container_auth_key', None) != secret:
            app.state.container_auth = local_auth.LocalAuthenticator(secret)
            app.state.container_auth_key = secret
        authenticator = app.state.container_auth
    if authenticator is not None:
        body = await request.body()
        target = request.url.path + (('?' + request.url.query) if request.url.query else '')
        if not authenticator.verify(request.method, target, request.headers, body):
            return JSONResponse(status_code=401, content={'detail': 'Firma HMAC inválida o nonce repetido'})
        response = await call_next_with_tenant(request, call_next)
        content = b''.join([chunk async for chunk in response.body_iterator]) if hasattr(response, 'body_iterator') else response.body
        from starlette.responses import Response
        stamp, nonce = request.headers['x-omega-time'], request.headers['x-omega-nonce']
        headers = dict(response.headers)
        headers['x-omega-signature'] = signature(authenticator.secret, 'response', str(response.status_code), target, stamp, nonce, content)
        return Response(content, status_code=response.status_code, headers=headers, media_type=response.media_type)
    if os.getenv('OMEGA_NATIVE_SENSOR') == '1':
        return JSONResponse(status_code=503, content={'detail': 'Bootstrap efímero requerido'})
    expected_token = os.getenv("INTERNAL_SERVICE_TOKEN", "").strip()
    if not expected_token:
        return JSONResponse(
            status_code=503,
            content={"detail": "INTERNAL_SERVICE_TOKEN no configurado en el worker forense."},
        )

    provided_token = request.headers.get("X-Internal-Service-Token", "")
    if not provided_token or not hmac.compare_digest(provided_token, expected_token):
        return JSONResponse(
            status_code=401,
            content={"detail": "Acceso denegado: X-Internal-Service-Token ausente o inválido."},
        )

    return await call_next_with_tenant(request, call_next)


async def call_next_with_tenant(request, call_next):
    if request.url.path.startswith(('/api/host/', '/api/containment/')):
        owner = os.getenv('OMEGA_HOST_OWNER_TENANT_ID', '').strip()
        if not owner:
            return JSONResponse(status_code=503, content={'detail': 'Configura OMEGA_HOST_OWNER_TENANT_ID para vincular este sensor a un único tenant.'})
        supplied = request.headers.get('X-Host-Tenant', '')
        if not hmac.compare_digest(supplied, owner):
            return JSONResponse(status_code=403, content={'detail': 'Este sensor pertenece a otro tenant.'})
    return await call_next(request)


@app.post('/api/containment/execute')
def execute_containment_endpoint(payload: ContainmentRequest, request: Request):
    if not getattr(app.state, 'integrity_ok', False):
        raise HTTPException(status_code=503, detail='Integridad no verificada: contención bloqueada')
    try:
        return containment_engine.execute_containment(payload.actionType, payload.target,
                owner=request.headers['X-Host-Tenant'], dry_run=payload.dryRun, preview_token=payload.previewToken,
                actor_user_id=request.headers.get('X-Host-Actor'))
    except (ValueError, KeyError, psutil.Error) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        raise HTTPException(status_code=503, detail='El sensor no pudo acceder al almacén seguro, a la bóveda o a los permisos requeridos.') from exc


@app.post('/api/containment/rollback/{action_id}')
def rollback_containment_endpoint(action_id: str, request: Request):
    if not getattr(app.state, 'integrity_ok', False):
        raise HTTPException(status_code=503, detail='Integridad no verificada: contención bloqueada')
    try:
        return containment_engine.rollback_containment(action_id, owner=request.headers['X-Host-Tenant'])
    except (ValueError, FileNotFoundError, InvalidTag) as exc:
        raise HTTPException(status_code=409, detail='No se pudo autenticar o localizar el diario de esta acción.') from exc
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        raise HTTPException(status_code=503, detail='No se pudo acceder a la bóveda para restaurar.') from exc


@app.get('/api/containment/history')
def containment_history(request: Request):
    return {'actions': containment_engine.history(request.headers['X-Host-Tenant'])}


@app.get('/api/host/realtime/status')
def host_realtime_status():
    return watcher.status()


@app.post('/api/host/realtime/toggle')
def host_realtime_toggle(payload: RealtimeToggleRequest):
    if payload.enabled and not getattr(app.state, 'integrity_ok', False):
        raise HTTPException(status_code=503, detail='Integridad no verificada: vigilancia bloqueada')
    try:
        return watcher.toggle(payload.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post('/api/host/iocs/sync')
def host_iocs_sync(payload: HostIocSyncRequest):
    watcher.replace_iocs([row.model_dump() for row in payload.indicators])
    return watcher.status()


@app.post('/api/host/persistence/audit', response_model=PersistenceAuditResponse)
def host_persistence_audit():
    if host_scope() != 'native-host':
        raise HTTPException(status_code=409, detail='Esta auditoría requiere un sensor nativo fuera de Docker.')
    try:
        report = audit_persistence(ioc_lookup=watcher.lookup_iocs)
        status = watcher.status()
        if not status['catalogLoaded'] or status['catalogError']:
            report['limitations'].append('Catálogo CTI no disponible o desactualizado para este sensor.')
            report['complete'] = False
        return report
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


async def _read_bounded_upload(upload: UploadFile, current_total: int = 0) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_SINGLE_UPLOAD_BYTES or (current_total + size) > MAX_TOTAL_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail="El tamaño del artefacto forense excede el límite permitido en RAM.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "integrity_verified": getattr(app.state, 'integrity_ok', False),
        "releaseId": getattr(app.state, 'release_id', None),
        "service": "omega-forensic-worker",
        "scope": host_scope(),
        "mode": "native-containment-persistent-vault" if host_scope() == 'native-host' and os.getenv('OMEGA_CONTAINMENT_ENABLED', '').lower() == 'true' else "stateless-ram-only",
        "yara": get_yara_engine_status(),
    }


@app.post("/api/ioc/verify/file", response_model=IocVerifyResponse)
async def verify_ioc_file(file: UploadFile = File(...)):
    raw_bytes = await _read_bounded_upload(file)
    try:
        raw_text = raw_bytes.decode("utf-8", errors="ignore")
        return analyze_forensic_payload(raw_text, filename=file.filename)
    finally:
        raw_bytes = b""
        gc.collect()


@app.post("/api/ioc/verify/text", response_model=IocVerifyResponse)
def verify_ioc_text(payload: IocRawRequest):
    return analyze_forensic_payload(payload.indicators_text, filename="consulta_manual.txt")


@app.post("/api/triage/parallel")
async def parallel_forensic_triage(files: list[UploadFile] = File(...)):
    """Ejecuta el pipeline forense paralelo sobre volcados y dumps en RAM (0 bytes a disco)."""
    artifacts: list[dict] = []
    total_read = 0
    try:
        for f in files:
            content = await _read_bounded_upload(f, total_read)
            total_read += len(content)
            artifacts.append({"filename": f.filename or "artifact.bin", "bytes": content})

        return await run_parallel_forensic_triage(artifacts)
    except (ValueError, zipfile.BadZipFile, tarfile.TarError) as exc:
        raise HTTPException(status_code=400, detail='Archivo forense rechazado: estructura o expansión insegura.') from exc
    finally:
        for art in artifacts:
            art["bytes"] = b""
        artifacts.clear()
        gc.collect()


@app.post("/api/triage/ios-manifest-targets")
async def ios_manifest_targets(manifest: UploadFile = File(...)):
    """Resuelve en RAM fileIDs forenses relevantes desde Manifest.db de iOS."""
    raw_bytes = await _read_bounded_upload(manifest)
    try:
        return extract_ios_manifest_targets(raw_bytes)
    finally:
        raw_bytes = b""
        gc.collect()


@app.post("/api/triage/ios-manifest-decrypt")
async def ios_manifest_decrypt_targets(
    manifest_plist: UploadFile = File(...),
    manifest_db: UploadFile = File(...),
    password: str = Form(...),
):
    """Desbloquea Manifest.db de una copia iOS encriptada exclusivamente en RAM."""
    plist_bytes = await _read_bounded_upload(manifest_plist)
    db_bytes = await _read_bounded_upload(manifest_db, len(plist_bytes))
    try:
        return await asyncio.to_thread(
            unlock_encrypted_ios_backup_in_ram,
            plist_bytes,
            db_bytes,
            password,
        )
    except ValueError as exc:
        msg = str(exc)
        if "INVALID_BACKUP_PASSWORD" in msg:
            raise HTTPException(
                status_code=401,
                detail="Contraseña incorrecta para la copia de seguridad iOS.",
            )
        raise HTTPException(status_code=400, detail=msg)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo desbloquear el respaldo en memoria: {exc}",
        )
    finally:
        plist_bytes = b""
        db_bytes = b""
        password = ""
        gc.collect()


@app.post("/api/triage/device-live")
async def live_device_triage(payload: LiveDeviceSnapshot):
    """Normaliza telemetría móvil en RAM y ejecuta correlación paralela + YARA."""
    dump = payload.model_dump()
    device_summary = dict(payload.device or {})
    device_summary.setdefault("platform", payload.platform)
    dump["device"] = device_summary

    extra_manifest_anomalies: list[dict] = []
    decrypted_count = 0
    if dump.get("ios_unlock_token") or dump.get("ios_backup_auth"):
        auth = dump.get("ios_backup_auth") or {}
        try:
            dec_artifacts, extra_manifest_anomalies, decrypted_count = await asyncio.to_thread(
                decrypt_binary_artifacts_in_ram,
                dump.get("binary_artifacts") or [],
                dump.get("ios_unlock_token") or None,
                auth.get("manifest_plist_b64"),
                auth.get("manifest_db_b64"),
                auth.get("password"),
            )
            dump["binary_artifacts"] = dec_artifacts
        except ValueError as exc:
            if "INVALID_BACKUP_PASSWORD" in str(exc):
                raise HTTPException(
                    status_code=401,
                    detail="Contraseña incorrecta para la copia encriptada de iPhone.",
                )
            raise HTTPException(status_code=400, detail=str(exc))

    artifacts = build_adb_artifacts_in_ram(dump)
    if dump.get("apk_hashes_raw"):
        artifacts.append({"filename": "android_apk_sha256.txt", "bytes": str(dump["apk_hashes_raw"]).encode("utf-8")})
    if dump.get("ca_certs_raw"):
        artifacts.append({"filename": "android_user_cacerts_added.txt", "bytes": str(dump["ca_certs_raw"]).encode("utf-8")})
    if dump.get("proxy_raw"):
        artifacts.append({"filename": "android_net_proxy.txt", "bytes": str(dump["proxy_raw"]).encode("utf-8")})
    if dump.get("ios_profiles_raw"):
        artifacts.append({"filename": "ios_installed_profiles.mobileconfig", "bytes": str(dump["ios_profiles_raw"]).encode("utf-8")})

    try:
        triage_report = await run_parallel_forensic_triage(artifacts)
    finally:
        for art in artifacts:
            art["bytes"] = b""
        artifacts.clear()
        gc.collect()

    if extra_manifest_anomalies:
        existing_anom = triage_report.setdefault("behavioral_anomalies", [])
        seen = {(a.get("category"), str(a.get("indicator", "")).lower()) for a in existing_anom}
        for ma in extra_manifest_anomalies:
            if (ma.get("category"), str(ma.get("indicator", "")).lower()) not in seen:
                existing_anom.insert(0, ma)
                seen.add((ma.get("category"), str(ma.get("indicator", "")).lower()))

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
        "timeline": triage_report.get("timeline", []),
        "timeline_summary": triage_report.get("timeline_summary", {}),
        "yara_engine": triage_report.get("yara_engine", {}),
        "catalog_freshness": triage_report.get("catalog_freshness"),
        "os_scope_notice": triage_report.get("os_scope_notice", ""),
        "platform_mitigations": triage_report.get("platform_mitigations", []),
        "decrypted_artifacts_count": decrypted_count,
        "triage": triage_report,
    }


@app.post("/api/triage/pc-live")
async def pc_live_host_triage(payload: PcLiveSnapshot):
    """Auditoría forense de host local en RAM (procesos, WMI, sockets y YARA)."""
    return await asyncio.to_thread(run_host_live_audit, payload.model_dump())


@app.post("/api/yara")
async def yara_scan_in_ram(files: list[UploadFile] = File(...)):
    """Escanea uno o más artefactos directamente en memoria RAM con el motor YARA."""
    artifacts: list[dict] = []
    total_read = 0
    try:
        for f in files:
            raw = await _read_bounded_upload(f, total_read)
            total_read += len(raw)
            artifacts.append({"filename": f.filename or "artifact.bin", "bytes": raw})

        hits = await asyncio.to_thread(scan_artifacts_with_yara, artifacts)
        owasp_hits = await asyncio.to_thread(scan_artifacts_with_owasp, artifacts)
        return {
            "files_scanned": len(artifacts),
            "total_hits": len(hits) + len(owasp_hits),
            "yara_hits": hits,
            "owasp_hits": owasp_hits,
            "yara_engine": get_yara_engine_status(),
            "ephemeral_notice": "Escaneo YARA + OWASP ejecutado íntegramente en memoria RAM sin escritura en disco (RNF4).",
        }
    finally:
        for art in artifacts:
            art["bytes"] = b""
        artifacts.clear()
        gc.collect()


@app.get("/api/yara/{campaign_id}")
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


@app.post("/api/link/verify")
def verify_link_endpoint(payload: LinkCheckRequest):
    try:
        return inspect_suspicious_link(payload.url, active_probe=payload.activeProbe)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/api/link/infrastructure')
def link_infrastructure(payload: LinkCheckRequest):
    from link_verifier import _refang_url, _is_valid_domain_host
    try:
        normalized = _refang_url(payload.url)
        parsed = urlparse(normalized)
        host = (parsed.hostname or '').lower().rstrip('.').encode('idna').decode('ascii')
        if parsed.username or parsed.password or not _is_valid_domain_host(host):
            raise ValueError('Dominio no válido para inteligencia de infraestructura.')
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return inspect_evasion(normalized, host, active_probe=payload.activeProbe)


@app.get("/api/mobile/usb/devices")
def list_mobile_usb_devices():
    return list_connected_devices()


@app.post("/api/mobile/usb/audit")
def start_mobile_usb_audit(payload: MobileUsbAuditRequest):
    return start_usb_audit_job(
        platform=payload.platform,
        device_id=payload.device_id,
        backup_password=payload.backup_password,
        async_mode=payload.async_mode,
    )


@app.get("/api/mobile/usb/audit/{job_id}")
def get_mobile_usb_audit_status(job_id: str):
    job = get_usb_audit_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Trabajo de auditoría USB no encontrado.")
    return job


@app.get("/api/host/infostealer/scan")
def run_host_infostealer_scan():
    """Escaneo bajo demanda del escudo diario Anti-Infostealer (navegadores, SSH, .env)."""
    from infostealer_shield import scan_infostealer_activity

    alerts = scan_infostealer_activity()
    return {
        "ok": True,
        "count": len(alerts),
        "alerts": alerts,
    }


@app.post("/api/repo/scan", response_model=ScanStatus)
async def run_repo_scan(
    request: Request,
    file: UploadFile = File(...),
    max_files: int = Form(5000),
    timeout_seconds: float = Form(30.0),
):
    """Escaneo estático de repositorio en RAM/tmpfs (Fases 1 y 2)."""
    from repo_scanner import DEFAULT_MAX_BYTES, scan_archive_bytes

    raw = await file.read(DEFAULT_MAX_BYTES + 1)
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Cliente desconectado; escaneo cancelado.")
    if len(raw) > DEFAULT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="El archivo supera el límite máximo permitido (50 MiB).")
    try:
        return scan_archive_bytes(
            file.filename or "repo.tar.gz",
            raw,
            max_files=max(1, min(int(max_files), 20000)),
            timeout_seconds=max(5.0, min(float(timeout_seconds), 120.0)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/repo/scan/{scan_id}", response_model=ScanStatus)
def get_repo_scan_status(scan_id: str):
    """Consulta de resultados efímeros de un escaneo en memoria."""
    from repo_scanner import get_ephemeral_scan

    status = get_ephemeral_scan(scan_id)
    if not status:
        raise HTTPException(status_code=404, detail="Escaneo no encontrado o purgado por zero-retention.")
    return status
