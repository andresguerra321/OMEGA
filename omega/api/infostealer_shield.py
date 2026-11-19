"""Daily Anti-Infostealer shield for host telemetry.

Detects unsigned or unexpected processes attempting to read browser credential/cookie
stores, SSH private keys, or environment secret files (.env, .aws/credentials, .kube/config).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

import psutil

from host_forensics import verify_binary_signature

BROWSER_PROCESS_NAMES = {
    "chrome.exe", "chrome", "google chrome",
    "msedge.exe", "msedge", "microsoft edge",
    "brave.exe", "brave", "brave browser",
    "firefox.exe", "firefox",
    "opera.exe", "opera", "vivaldi.exe", "vivaldi", "safari",
}

SSH_ALLOWED_NAMES = {
    "ssh.exe", "ssh", "ssh-agent.exe", "ssh-agent", "sshd.exe", "sshd",
    "git.exe", "git", "scp.exe", "scp", "sftp.exe", "sftp", "pageant.exe",
}

SENSITIVE_RULES: tuple[tuple[str, str, tuple[str, ...], set[str]], ...] = (
    (
        "BROWSER_CREDENTIAL_STORE",
        "CRITICAL",
        (
            "/login data",
            "/web data",
            "/local state",
            "/network/cookies",
            "/cookies",
            "/logins.json",
            "/key4.db",
            "/cookies.sqlite",
        ),
        BROWSER_PROCESS_NAMES,
    ),
    (
        "SSH_PRIVATE_KEY",
        "CRITICAL",
        (
            "/.ssh/id_rsa",
            "/.ssh/id_ed25519",
            "/.ssh/id_ecdsa",
            "/.ssh/id_dsa",
            "/.ssh/identity",
        ),
        SSH_ALLOWED_NAMES,
    ),
    (
        "SECRET_ENV_OR_CLOUD_CREDENTIAL",
        "HIGH",
        (
            "/.aws/credentials",
            "/.kube/config",
            "/.npmrc",
            "/.pypirc",
            "/.env",
        ),
        set(),
    ),
)


def _norm_path(raw: str) -> str:
    return str(raw or "").replace("\\", "/").strip().lower()


_BROWSER_PROFILE_MARKERS = (
    "chrome",
    "edge",
    "brave",
    "opera",
    "vivaldi",
    "mozilla",
    "firefox",
    "safari",
    "chromium",
    "waterfox",
    "librewolf",
    "user data",
)


def classify_sensitive_target(raw_path: str) -> tuple[str, str, set[str]] | None:
    """Devuelve (categoria_objetivo, severidad, procesos_legitimos) si la ruta es sensible."""
    norm = _norm_path(raw_path)
    if not norm:
        return None
    for target_kind, severity, patterns, allowed in SENSITIVE_RULES:
        for pat in patterns:
            if pat == "/.env":
                if norm.endswith("/.env") or norm == ".env" or "/.env." in norm:
                    if not norm.endswith((".env.example", ".env.sample", ".env.template")):
                        return target_kind, severity, allowed
            elif pat in norm:
                # Evitar falsos positivos de apps Electron (ej. Docker Desktop, VS Code) leyendo sus propias cookies
                if target_kind == "BROWSER_CREDENTIAL_STORE" and not any(
                    b in norm for b in _BROWSER_PROFILE_MARKERS
                ):
                    continue
                return target_kind, severity, allowed
    return None


def evaluate_process_for_infostealer(
    proc_info: dict[str, Any],
    *,
    signature_verifier: Callable[[str], dict[str, Any]] = verify_binary_signature,
) -> list[dict[str, Any]]:
    """Evalúa un proceso (open_files + cmdline) buscando acceso sospechoso a secretos."""
    name = str(proc_info.get("name") or "").strip().lower()
    exe_path = str(proc_info.get("exe_path") or "").strip()
    pid = proc_info.get("pid")
    open_files = proc_info.get("open_files") or []
    cmdline = proc_info.get("cmdline") or []

    candidate_paths: list[str] = [str(p) for p in open_files if p]
    for arg in cmdline[1:] if len(cmdline) > 1 else []:
        s = str(arg or "").strip().strip('"').strip("'")
        if "/" in s or "\\" in s or s.endswith(".env"):
            candidate_paths.append(s)

    if not candidate_paths:
        return []

    signature = proc_info.get("signature")
    if signature is None:
        signature = signature_verifier(exe_path) if exe_path else {"status": "Unknown", "publisher": ""}
    sig_status = str(signature.get("status") or "Unknown")
    is_signed_valid = sig_status == "Valid"

    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for raw_target in candidate_paths:
        matched = classify_sensitive_target(raw_target)
        if not matched:
            continue
        target_kind, severity, allowed_names = matched

        # Procesos esperados con firma válida se permiten para su propia categoría
        if name in allowed_names and is_signed_valid:
            continue
        # En .env / cloud config, solo alertar si el proceso NO está firmado válidamente
        if target_kind == "SECRET_ENV_OR_CLOUD_CREDENTIAL" and is_signed_valid:
            continue

        dedup_key = (target_kind, _norm_path(raw_target))
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        findings.append(
            {
                "category": "INFOSTEALER_CREDENTIAL_ACCESS",
                "severity": severity,
                "targetKind": target_kind,
                "pid": pid,
                "processName": proc_info.get("name") or "desconocido",
                "exePath": exe_path,
                "signatureStatus": sig_status,
                "sensitivePath": raw_target,
                "userFriendlyTitle": (
                    f"Posible infostealer: {proc_info.get('name') or 'proceso no verificado'} "
                    f"accediendo a {target_kind.replace('_', ' ').lower()}"
                ),
                "detail": (
                    f"El proceso '{proc_info.get('name') or 'desconocido'}' (PID {pid}, firma: {sig_status}) "
                    f"está accediendo a una ruta sensible ({Path(raw_target).name}). "
                    "Los infostealers suelen leer bases de contraseñas/cookies del navegador, llaves SSH o archivos .env."
                ),
            }
        )

    return findings


def scan_infostealer_activity(
    *,
    max_processes: int = 250,
    signature_verifier: Callable[[str], dict[str, Any]] = verify_binary_signature,
) -> list[dict[str, Any]]:
    """Escanea procesos activos buscando acceso no autorizado a credenciales y secretos locales."""
    own_pid = os.getpid()
    alerts: list[dict[str, Any]] = []
    scanned = 0

    for proc in psutil.process_iter(attrs=["pid", "name", "exe", "cmdline"]):
        if scanned >= max_processes:
            break
        try:
            pid = proc.info.get("pid")
            if not pid or pid == own_pid or pid <= 4:
                continue
            scanned += 1
            open_paths: list[str] = []
            try:
                open_paths = [f.path for f in proc.open_files()[:64] if getattr(f, "path", None)]
            except (psutil.Error, OSError):
                open_paths = []

            cmdline = proc.info.get("cmdline") or []
            if not open_paths and len(cmdline) <= 1:
                continue

            # Pre-filtro rápido antes de verificar firma digital para mantener CPU bajo
            has_candidate = any(classify_sensitive_target(p) is not None for p in open_paths) or any(
                classify_sensitive_target(str(a)) is not None for a in cmdline[1:]
            )
            if not has_candidate:
                continue

            proc_info = {
                "pid": pid,
                "name": proc.info.get("name") or "",
                "exe_path": proc.info.get("exe") or "",
                "cmdline": cmdline,
                "open_files": open_paths,
            }
            alerts.extend(evaluate_process_for_infostealer(proc_info, signature_verifier=signature_verifier))
        except (psutil.Error, OSError):
            continue

    return alerts
