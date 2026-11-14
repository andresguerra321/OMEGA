"""Microservicio Forense Stateless OMEGA (Zero-Disk / In-RAM Only).

Aislado exclusivamente en la red privada Docker; autentica todas las llamadas
mediante el encabezado compartido `X-Internal-Service-Token` emitido por backend-java.
"""

from __future__ import annotations

import asyncio
import gc
import hmac
import os
import sys
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deep_forensics import build_adb_artifacts_in_ram, extract_ios_manifest_targets
from detection_engineering import generate_mvt_triage_script, generate_yara_for_campaign
from forensic_engine import analyze_forensic_payload
from host_forensics import run_host_live_audit
from ios_backup_crypto import decrypt_binary_artifacts_in_ram, unlock_encrypted_ios_backup_in_ram
from link_verifier import inspect_suspicious_link
from schemas import (
    IocRawRequest,
    IocVerifyResponse,
    LinkCheckRequest,
    LiveDeviceSnapshot,
    PcLiveSnapshot,
)
from triage_orchestrator import run_parallel_forensic_triage
from yara_engine import get_yara_engine_status, scan_artifacts_with_yara

MAX_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 128 * 1024 * 1024

app = FastAPI(
    title="Omega Stateless Forensic Worker",
    description="Worker forense interno en RAM (MVT, YARA, iOS crypto, correlación temporal y verificación pasiva de enlaces).",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def verify_internal_service_token(request: Request, call_next):
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

    return await call_next(request)


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
        "service": "omega-forensic-worker",
        "mode": "stateless-ram-only",
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
        return {
            "files_scanned": len(artifacts),
            "total_hits": len(hits),
            "yara_hits": hits,
            "yara_engine": get_yara_engine_status(),
            "ephemeral_notice": "Escaneo YARA ejecutado íntegramente en memoria RAM sin escritura en disco (RNF4).",
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
        return inspect_suspicious_link(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
