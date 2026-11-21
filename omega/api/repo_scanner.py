"""Motor estático de escaneo de repositorios y dependencias en RAM/tmpfs (Fases 1 y 2).

Reglas no negociables (docs/threat_model_repo_scanner.md):
- Nunca ejecuta código ni scripts del repositorio analizado.
- Valida todo archivo comprimido mediante `archive_safety.validate_archive`.
- Procesamiento 100% en memoria con límites de tamaño, archivos y tiempo.
- Redacción honesta: nunca afirma que un repositorio sea 'seguro'.
"""

from __future__ import annotations

from datetime import datetime, timezone
import gzip
import io
import json
import math
from pathlib import Path
import re
import tarfile
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Callable

from archive_safety import validate_archive
from registry_clients import PackageMetadata, RegistryMetadataClient, days_since_iso
from schemas import ScanFinding, ScanStatus

WEIGHTS_PATH = Path(__file__).resolve().parent / "repo_scanner_weights.json"
DEFAULT_MAX_BYTES = 52_428_800  # 50 MiB
DEFAULT_MAX_FILES = 5000
DEFAULT_TIMEOUT_SECONDS = 30.0
SCAN_TTL_SECONDS = 600.0
MAX_STORED_SCANS = 100

_SUSPICIOUS_SCRIPT_RE = re.compile(
    r"(?i)(curl\s+[^|\n]+\|\s*(ba)?sh|wget\s+[^|\n]+\|\s*(ba)?sh|powershell\s+-enc|eval\s*\(|base64\s+-d|nc\s+-e)"
)
_PY_SETUP_EXEC_RE = re.compile(
    r"(?i)(subprocess\.(Popen|run|call)|os\.system\s*\(|urllib\.request\.urlopen|exec\s*\(|__import__\s*\()"
)
_EXFIL_RE = re.compile(
    r"(?i)(discord(app)?\.com/api/webhooks|api\.telegram\.org/bot|ngrok\.io|requestbin)"
)
_OBFUSCATION_EXEC_B64_RE = re.compile(
    r"(?i)(eval|exec|Function)\s*\([^)\n]{0,80}[A-Za-z0-9+/]{64,}={0,2}"
)
_RAW_IP_URL_RE = re.compile(
    r"https?://(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:/[^\s\"'`]*)?"
)

_CREDENTIAL_RULES: tuple[tuple[str, str, re.Pattern[str], str], ...] = (
    (
        "SECRET-CREDENTIAL-GITHUB-01",
        "Token personal o de aplicación de GitHub",
        re.compile(r"\b(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{22,})\b"),
        (
            "Se detectó un token de GitHub expuesto en código fuente. "
            "Guía de rotación: 1) Revócalo inmediatamente en GitHub Settings -> Developer settings -> Personal access tokens. "
            "2) Revisa los eventos recientes del audit log de la organización. "
            "3) Inyéctalo mediante secretos del entorno o GitHub Actions Secrets."
        ),
    ),
    (
        "SECRET-CREDENTIAL-AWS-01",
        "Clave de acceso de AWS IAM (Access Key ID)",
        re.compile(r"\b(AKIA[0-9A-Z]{16})\b"),
        (
            "Se detectó un identificador de llave AWS IAM expuesto. "
            "Guía de rotación: 1) Desactiva y elimina la Access Key en AWS IAM Console. "
            "2) Audita llamadas recientes en AWS CloudTrail para esa credencial. "
            "3) Migra a roles OIDC o perfiles de instancia temporales."
        ),
    ),
    (
        "SECRET-CREDENTIAL-AI-API-01",
        "Llave de API de proveedor LLM / IA",
        re.compile(r"\b(sk-(?:proj-|ant-api03-)?[A-Za-z0-9_-]{24,}|gsk_[A-Za-z0-9]{24,})\b"),
        (
            "Se detectó una llave de API de servicios de IA en texto plano. "
            "Guía de rotación: 1) Revoca la llave en el panel del proveedor (OpenAI / Anthropic / Groq). "
            "2) Establece límites de gasto mensual por proyecto. "
            "3) Carga la credencial desde variables de entorno fuera del control de versiones."
        ),
    ),
    (
        "SECRET-CREDENTIAL-PRIVATE-KEY-01",
        "Llave privada criptográfica PEM / OpenSSH",
        re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"),
        (
            "Se detectó un bloque de llave privada criptográfica dentro del repositorio. "
            "Guía de rotación: 1) Revoca el certificado o elimina la llave pública autorizada en los servidores destino. "
            "2) Genera un nuevo par de llaves fuera del árbol Git. "
            "3) Purga el archivo del historial si el repositorio fue publicado."
        ),
    ),
    (
        "SECRET-CREDENTIAL-OMEGA-01",
        "Token de escaneo de API OMEGA",
        re.compile(r"\b(omega_scan_[A-Za-z0-9_-]{16,})\b"),
        (
            "Se detectó un token de API de OMEGA expuesto en el repositorio. "
            "Guía de rotación: 1) Entra a Proyectos -> CLI y Tokens API en OMEGA y revoca el token de inmediato. "
            "2) Emite un nuevo token con expiración acotada y guárdalo en el gestor de secretos de tu CI."
        ),
    ),
    (
        "SECRET-CREDENTIAL-SLACK-01",
        "Token de bot o webhook de Slack",
        re.compile(r"\b(xox[baprs]-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{20,})\b"),
        (
            "Se detectó un token de integración de Slack expuesto. "
            "Guía de rotación: 1) Regenera o revoca el token en api.slack.com/apps. "
            "2) Restringe los scopes OAuth de la aplicación al mínimo necesario."
        ),
    ),
)

_SAFE_PLACEHOLDER_MARKERS = (
    "example",
    "placeholder",
    "dummy",
    "sample",
    "your_token",
    "tu_token",
    "xxxx",
    "0000000000",
    "1234567890",
    "test_key_do_not_use",
)

_POPULAR_NPM = (
    "lodash", "express", "react", "react-dom", "axios", "chalk", "commander",
    "debug", "moment", "typescript", "webpack", "eslint", "prettier", "dotenv",
    "jsonwebtoken", "bcrypt", "mongoose", "sequelize", "tailwindcss", "vite",
)
_POPULAR_PYPI = (
    "requests", "numpy", "pandas", "flask", "django", "fastapi", "uvicorn",
    "pydantic", "urllib3", "boto3", "cryptography", "pytest", "sqlalchemy",
    "httpx", "pillow", "scipy", "beautifulsoup4", "pyyaml", "celery", "redis",
)

_EPHEMERAL_SCANS: dict[str, tuple[float, ScanStatus]] = {}


def load_scanner_weights() -> dict[str, int]:
    try:
        raw = json.loads(WEIGHTS_PATH.read_text(encoding="utf-8"))
        return {str(k): int(v) for k, v in raw.items()}
    except Exception:
        return {
            "NPM-POSTINSTALL-EXEC-01": 35,
            "PYPI-SETUP-EXEC-01": 35,
            "SECRET-EXFIL-01": 25,
            "CODE-OBFUSCATION-01": 30,
            "PKG-TYPOSQUAT-01": 25,
            "SCRIPT-NET-INDICATOR-01": 20,
            "PKG-NEW-OR-RECENT-01": 15,
            "PKG-MAINTAINER-CHANGE-01": 25,
            "PKG-MALICIOUS-ADVISORY-01": 50,
            "PKG-TEMPORAL-CHAIN-01": 30,
        }


def get_ephemeral_scan(scan_id: str) -> ScanStatus | None:
    _purge_expired_scans()
    entry = _EPHEMERAL_SCANS.get(scan_id)
    return entry[1] if entry else None


def _store_ephemeral_scan(status: ScanStatus) -> None:
    _purge_expired_scans()
    if len(_EPHEMERAL_SCANS) >= MAX_STORED_SCANS:
        oldest_key = min(_EPHEMERAL_SCANS, key=lambda k: _EPHEMERAL_SCANS[k][0])
        _EPHEMERAL_SCANS.pop(oldest_key, None)
    _EPHEMERAL_SCANS[status.scan_id] = (time.monotonic(), status)


def _purge_expired_scans() -> None:
    now = time.monotonic()
    expired = [k for k, (ts, _) in _EPHEMERAL_SCANS.items() if (now - ts) > SCAN_TTL_SECONDS]
    for k in expired:
        _EPHEMERAL_SCANS.pop(k, None)


def scan_archive_bytes(
    filename: str,
    raw: bytes,
    *,
    registry_client: RegistryMetadataClient | None = None,
    advisory_lookup: Callable[[str, str], dict[str, Any] | None] | None = None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_files: int = DEFAULT_MAX_FILES,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    now: datetime | None = None,
) -> ScanStatus:
    """Ejecuta un escaneo estático en memoria sobre un archivo comprimido."""
    scan_id = f"scan_{uuid.uuid4().hex[:16]}"
    if len(raw) > max_bytes:
        raise ValueError("El archivo supera el límite máximo permitido en RAM.")

    validate_archive(filename, raw)

    started = time.monotonic()
    files = _extract_text_files_in_memory(filename, raw, max_files=max_files)
    findings: list[ScanFinding] = []
    limitations: list[str] = []
    dependencies: list[tuple[str, str, str]] = []
    dependency_records: list[dict[str, Any]] = []

    for rel_path, text in files:
        if (time.monotonic() - started) > timeout_seconds:
            limitations.append("Análisis detenido al alcanzar el límite de tiempo configurado.")
            break
        _run_static_content_detectors(rel_path, text, findings, dependencies, dependency_records)

    client = registry_client or RegistryMetadataClient()
    ref_now = now or datetime.now(timezone.utc)
    seen_deps: set[tuple[str, str]] = set()
    normalized_deps: list[dict[str, Any]] = []
    seen_dep_records: set[tuple[str, str, str]] = set()
    for rec in dependency_records:
        key = (
            str(rec.get("ecosystem", "")).lower(),
            str(rec.get("name", "")).lower(),
            str(rec.get("manifest_path", "")),
        )
        if key not in seen_dep_records:
            seen_dep_records.add(key)
            normalized_deps.append(rec)

    for ecosystem, pkg_name, location in dependencies:
        if (time.monotonic() - started) > timeout_seconds:
            limitations.append("Consulta de metadatos acotada por límite de tiempo.")
            break
        dep_key = (ecosystem, pkg_name.lower())
        if dep_key in seen_deps:
            continue
        seen_deps.add(dep_key)

        _check_typosquatting(ecosystem, pkg_name, location, findings)

        if advisory_lookup:
            adv = advisory_lookup(ecosystem, pkg_name)
            if adv:
                findings.append(
                    ScanFinding(
                        rule_id="PKG-MALICIOUS-ADVISORY-01",
                        severity="CRITICAL",
                        confidence=0.98,
                        evidence=f"{ecosystem}:{pkg_name} · {adv.get('id', 'MAL-ADVISORY')}"[:1000],
                        location=location,
                        explanation=(
                            f"La dependencia '{pkg_name}' ({ecosystem}) coincide con un advisory "
                            f"de paquete malicioso en el catálogo ({adv.get('id', 'OSV MAL-')})."
                        ),
                    )
                )

        meta = client.get_package_metadata(ecosystem, pkg_name)
        if meta is not None:
            _run_metadata_context_detectors(meta, location, findings, ref_now)

    score, breakdown = compute_explainable_score(findings)
    summary = (
        f"Se detectaron {len(findings)} señal(es) estática(s) con puntaje compuesto {score}/100."
        if findings
        else "Sin señales detectadas con las reglas actuales."
    )

    status = ScanStatus(
        scan_id=scan_id,
        status="COMPLETED",
        files_scanned=len(files),
        findings=findings,
        dependencies=normalized_deps,
        limitations=limitations,
        score=score,
        score_breakdown=breakdown,
        summary=summary,
    )
    _store_ephemeral_scan(status)
    return status


def _extract_text_files_in_memory(
    filename: str,
    raw: bytes,
    *,
    max_files: int,
) -> list[tuple[str, str]]:
    lower = filename.lower()
    extracted: list[tuple[str, str]] = []

    if lower.endswith(".zip") or raw.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            for item in zf.infolist():
                if item.is_dir():
                    continue
                if len(extracted) >= max_files:
                    break
                data = zf.read(item.filename)
                if b"\x00" not in data[:1024]:
                    extracted.append((item.filename, data.decode("utf-8", errors="replace")))
        return extracted

    if lower.endswith((".tar", ".tgz", ".tar.gz")):
        source = io.BytesIO(raw)
        stream = gzip.GzipFile(fileobj=source) if raw.startswith(b"\x1f\x8b") else source
        with tarfile.open(fileobj=stream, mode="r:*") as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                if len(extracted) >= max_files:
                    break
                fh = tf.extractfile(member)
                if fh is None:
                    continue
                data = fh.read()
                if b"\x00" not in data[:1024]:
                    extracted.append((member.name, data.decode("utf-8", errors="replace")))
        return extracted

    raise ValueError("Formato de archivo no soportado; usa .tar.gz, .tgz o .zip.")


def _build_purl(ecosystem: str, name: str, version: str = "") -> str:
    clean_ver = re.sub(r"^[~^=><!\s]+", "", (version or "").strip())
    clean_name = name.strip()
    if ecosystem == "maven" and ":" in clean_name:
        clean_name = clean_name.replace(":", "/", 1)
    return f"pkg:{ecosystem}/{clean_name}" + (f"@{clean_ver}" if clean_ver else "")


def _run_static_content_detectors(
    rel_path: str,
    text: str,
    findings: list[ScanFinding],
    dependencies: list[tuple[str, str, str]],
    dependency_records: list[dict[str, Any]] | None = None,
) -> None:
    base = rel_path.rsplit("/", 1)[-1].lower()
    dep_records = dependency_records if dependency_records is not None else []

    if base == "package.json":
        try:
            pkg = json.loads(text)
        except json.JSONDecodeError:
            pkg = None
        if isinstance(pkg, dict):
            scripts = pkg.get("scripts") if isinstance(pkg.get("scripts"), dict) else {}
            for hook in ("preinstall", "install", "postinstall"):
                cmd = scripts.get(hook)
                if isinstance(cmd, str) and _SUSPICIOUS_SCRIPT_RE.search(cmd):
                    findings.append(
                        ScanFinding(
                            rule_id="NPM-POSTINSTALL-EXEC-01",
                            severity="HIGH",
                            confidence=0.92,
                            evidence=f'"{hook}": "{cmd[:240]}"',
                            location=f"{rel_path}:scripts.{hook}",
                            explanation=(
                                f"El script '{hook}' de npm contiene patrones de descarga o "
                                "ejecución remota durante la instalación."
                            ),
                        )
                    )
            for section in ("dependencies", "devDependencies", "optionalDependencies"):
                deps = pkg.get(section)
                if isinstance(deps, dict):
                    for dep_name, dep_ver in deps.items():
                        ver_str = str(dep_ver) if isinstance(dep_ver, (str, int, float)) else ""
                        dependencies.append(("npm", str(dep_name), f"{rel_path}:{section}.{dep_name}"))
                        dep_records.append(
                            {
                                "ecosystem": "npm",
                                "name": str(dep_name),
                                "version": ver_str,
                                "purl": _build_purl("npm", str(dep_name), ver_str),
                                "manifest_path": rel_path,
                                "direct": True,
                            }
                        )

    elif base == "package-lock.json":
        try:
            lock = json.loads(text)
        except Exception:
            lock = None
        if isinstance(lock, dict):
            packages = lock.get("packages") or {}
            if isinstance(packages, dict):
                for pkg_path, pkg_info in packages.items():
                    if not pkg_path or "node_modules/" not in str(pkg_path):
                        continue
                    dep_name = str(pkg_path).rsplit("node_modules/", 1)[-1].strip()
                    ver_str = str(pkg_info.get("version", "")) if isinstance(pkg_info, dict) else ""
                    if dep_name:
                        dependencies.append(("npm", dep_name, f"{rel_path}:{dep_name}"))
                        dep_records.append(
                            {
                                "ecosystem": "npm",
                                "name": dep_name,
                                "version": ver_str,
                                "purl": _build_purl("npm", dep_name, ver_str),
                                "manifest_path": rel_path,
                                "direct": str(pkg_path).count("node_modules/") == 1,
                            }
                        )
            legacy_deps = lock.get("dependencies") or {}
            if isinstance(legacy_deps, dict):
                for dep_name, dep_info in legacy_deps.items():
                    ver_str = str(dep_info.get("version", "")) if isinstance(dep_info, dict) else ""
                    dependencies.append(("npm", str(dep_name), f"{rel_path}:{dep_name}"))
                    dep_records.append(
                        {
                            "ecosystem": "npm",
                            "name": str(dep_name),
                            "version": ver_str,
                            "purl": _build_purl("npm", str(dep_name), ver_str),
                            "manifest_path": rel_path,
                            "direct": True,
                        }
                    )

    elif base == "pom.xml":
        try:
            root = ET.fromstring(text)
            for dep in root.iter():
                if dep.tag.endswith("dependency"):
                    gid = ""
                    aid = ""
                    ver = ""
                    for child in dep:
                        if child.tag.endswith("groupId") and child.text:
                            gid = child.text.strip()
                        elif child.tag.endswith("artifactId") and child.text:
                            aid = child.text.strip()
                        elif child.tag.endswith("version") and child.text:
                            ver = child.text.strip()
                    if gid and aid:
                        coord = f"{gid}:{aid}"
                        dependencies.append(("maven", coord, rel_path))
                        dep_records.append(
                            {
                                "ecosystem": "maven",
                                "name": coord,
                                "version": ver,
                                "purl": _build_purl("maven", coord, ver),
                                "manifest_path": rel_path,
                                "direct": True,
                            }
                        )
        except Exception:
            pass

    elif base == "go.mod":
        in_require = False
        for idx, line in enumerate(text.splitlines(), start=1):
            stripped = line.split("//", 1)[0].strip()
            if not stripped:
                continue
            if stripped.startswith("require ("):
                in_require = True
                continue
            if in_require and stripped == ")":
                in_require = False
                continue
            is_indirect = "// indirect" in line
            if stripped.startswith("require "):
                parts = stripped[len("require "):].strip().split()
                if parts:
                    mod = parts[0]
                    ver = parts[1] if len(parts) > 1 else ""
                    dependencies.append(("go", mod, f"{rel_path}:{idx}"))
                    dep_records.append(
                        {
                            "ecosystem": "go",
                            "name": mod,
                            "version": ver,
                            "purl": _build_purl("golang", mod, ver),
                            "manifest_path": rel_path,
                            "direct": not is_indirect,
                        }
                    )
            elif in_require:
                parts = stripped.split()
                if parts:
                    mod = parts[0]
                    ver = parts[1] if len(parts) > 1 else ""
                    dependencies.append(("go", mod, f"{rel_path}:{idx}"))
                    dep_records.append(
                        {
                            "ecosystem": "go",
                            "name": mod,
                            "version": ver,
                            "purl": _build_purl("golang", mod, ver),
                            "manifest_path": rel_path,
                            "direct": not is_indirect,
                        }
                    )

    elif base == "requirements.txt":
        for idx, line in enumerate(text.splitlines(), start=1):
            cleaned = line.split("#", 1)[0].strip()
            if not cleaned or cleaned.startswith("-"):
                continue
            parts = re.split(r"([=<>!~]+)", cleaned, maxsplit=1)
            pkg_name = re.split(r"[\s\[\];]", parts[0], maxsplit=1)[0].strip()
            ver = "".join(parts[1:]).split(";", 1)[0].strip() if len(parts) > 1 else ""
            if pkg_name:
                dependencies.append(("pypi", pkg_name, f"{rel_path}:{idx}"))
                dep_records.append(
                    {
                        "ecosystem": "pypi",
                        "name": pkg_name,
                        "version": ver,
                        "purl": _build_purl("pypi", pkg_name, ver),
                        "manifest_path": rel_path,
                        "direct": True,
                    }
                )

    elif base == "cargo.toml":
        in_deps = False
        for idx, line in enumerate(text.splitlines(), start=1):
            stripped = line.split("#", 1)[0].strip()
            if not stripped:
                continue
            if stripped.startswith("[") and stripped.endswith("]"):
                sec = stripped[1:-1].strip().lower()
                in_deps = sec in ("dependencies", "dev-dependencies", "build-dependencies")
                continue
            if in_deps and "=" in stripped:
                k, v = stripped.split("=", 1)
                pkg_name = k.strip().strip('"')
                ver_match = re.search(r'"([^"]+)"', v)
                ver = ver_match.group(1) if ver_match else ""
                if pkg_name:
                    dependencies.append(("cargo", pkg_name, f"{rel_path}:{idx}"))
                    dep_records.append(
                        {
                            "ecosystem": "cargo",
                            "name": pkg_name,
                            "version": ver,
                            "purl": _build_purl("cargo", pkg_name, ver),
                            "manifest_path": rel_path,
                            "direct": True,
                        }
                    )

    elif base == "setup.py":
        match = _PY_SETUP_EXEC_RE.search(text)
        if match:
            findings.append(
                ScanFinding(
                    rule_id="PYPI-SETUP-EXEC-01",
                    severity="HIGH",
                    confidence=0.88,
                    evidence=match.group(0)[:240],
                    location=rel_path,
                    explanation=(
                        "setup.py incluye llamadas de ejecución de procesos o red que se "
                        "activarían al instalar el paquete."
                    ),
                )
            )

    exfil_match = _EXFIL_RE.search(text)
    if exfil_match:
        findings.append(
            ScanFinding(
                rule_id="SECRET-EXFIL-01",
                severity="MEDIUM",
                confidence=0.78,
                evidence=exfil_match.group(0)[:240],
                location=rel_path,
                explanation=(
                    "Se detectó una referencia a un webhook o túnel externo usado "
                    "frecuentemente para exfiltración de credenciales o telemetría."
                ),
            )
        )

    if base in ("package.json", "setup.py") or rel_path.endswith((".sh", ".ps1")):
        ip_match = _RAW_IP_URL_RE.search(text)
        if ip_match:
            findings.append(
                ScanFinding(
                    rule_id="SCRIPT-NET-INDICATOR-01",
                    severity="HIGH",
                    confidence=0.80,
                    evidence=ip_match.group(0)[:240],
                    location=rel_path,
                    explanation=(
                        "El script apunta directamente a una dirección IP literal en lugar de un "
                        "dominio verificable, patrón común en descargas de payloads."
                    ),
                )
            )

    lower_rel = rel_path.lower()
    if (
        not lower_rel.endswith(".min.js")
        and "/dist/" not in f"/{lower_rel}"
        and "/build/" not in f"/{lower_rel}"
        and lower_rel.endswith((".js", ".mjs", ".cjs", ".ts", ".py"))
    ):
        obf_match = _OBFUSCATION_EXEC_B64_RE.search(text)
        if obf_match:
            findings.append(
                ScanFinding(
                    rule_id="CODE-OBFUSCATION-01",
                    severity="HIGH",
                    confidence=0.84,
                    evidence=obf_match.group(0)[:240],
                    location=rel_path,
                    explanation=(
                        "Se detectó ejecución dinámica (eval/exec/Function) combinada con una "
                        "carga extensa codificada en base64."
                    ),
                )
            )

    _run_credential_detectors(rel_path, text, findings)


def _run_credential_detectors(
    rel_path: str,
    text: str,
    findings: list[ScanFinding],
) -> None:
    """Detecta credenciales expuestas redactando SIEMPRE el valor (solo tipo + ubicación + guía de rotación)."""
    seen_in_file: set[tuple[str, int]] = set()
    for line_no, line in enumerate(text.splitlines(), start=1):
        if len(line) > 4000:
            continue
        lower_line = line.lower()
        if any(marker in lower_line for marker in _SAFE_PLACEHOLDER_MARKERS):
            continue
        for rule_id, cred_label, pattern, rotation_guide in _CREDENTIAL_RULES:
            if pattern.search(line):
                key = (rule_id, line_no)
                if key in seen_in_file:
                    continue
                seen_in_file.add(key)
                findings.append(
                    ScanFinding(
                        rule_id=rule_id,
                        severity="CRITICAL",
                        confidence=0.95,
                        evidence=f"[CREDENTIAL_REDACTED] Tipo: {cred_label} en {rel_path}:{line_no}",
                        location=f"{rel_path}:{line_no}",
                        explanation=f"{cred_label} ({rel_path}:{line_no}). {rotation_guide}",
                    )
                )


def _edit_distance_is_one(a: str, b: str) -> bool:
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diffs = [i for i, (ca, cb) in enumerate(zip(a, b)) if ca != cb]
        if len(diffs) == 1:
            return True
        if len(diffs) == 2 and diffs[1] == diffs[0] + 1:
            return a[diffs[0]] == b[diffs[1]] and a[diffs[1]] == b[diffs[0]]
        return False
    short, long = (a, b) if len(a) < len(b) else (b, a)
    i = j = diffs = 0
    while i < len(short) and j < len(long):
        if short[i] != long[j]:
            diffs += 1
            if diffs > 1:
                return False
            j += 1
        else:
            i += 1
            j += 1
    return True


def _check_typosquatting(
    ecosystem: str,
    pkg_name: str,
    location: str,
    findings: list[ScanFinding],
) -> None:
    clean = pkg_name.strip().lower()
    if len(clean) < 5:
        return
    popular = _POPULAR_NPM if ecosystem == "npm" else _POPULAR_PYPI if ecosystem == "pypi" else ()
    if not popular or clean in popular:
        return
    for target in popular:
        if _edit_distance_is_one(clean, target):
            findings.append(
                ScanFinding(
                    rule_id="PKG-TYPOSQUAT-01",
                    severity="HIGH",
                    confidence=0.79,
                    evidence=f"{ecosystem}:{pkg_name} similar a {target}",
                    location=location,
                    explanation=(
                        f"El paquete '{pkg_name}' tiene distancia de edición 1 respecto al paquete "
                        f"popular '{target}' (posible typosquatting)."
                    ),
                )
            )
            return


def _run_metadata_context_detectors(
    meta: PackageMetadata,
    location: str,
    findings: list[ScanFinding],
    now: datetime,
) -> None:
    age_days = days_since_iso(meta.first_published, now)
    if age_days is not None and age_days < 14.0:
        findings.append(
            ScanFinding(
                rule_id="PKG-NEW-OR-RECENT-01",
                severity="MEDIUM",
                confidence=0.72,
                evidence=f"{meta.ecosystem}:{meta.name} creado hace {age_days:.1f} días",
                location=location,
                explanation=(
                    f"El paquete '{meta.name}' fue publicado por primera vez hace menos de 14 días, "
                    "un patrón habitual en campañas de typosquatting."
                ),
            )
        )

    if meta.maintainer_changed_recently:
        findings.append(
            ScanFinding(
                rule_id="PKG-MAINTAINER-CHANGE-01",
                severity="HIGH",
                confidence=0.82,
                evidence=f"{meta.ecosystem}:{meta.name} cambio de publicador en última versión",
                location=location,
                explanation=(
                    f"Se observó un cambio reciente de mantenedor o publicador en '{meta.name}', "
                    "señal de posible toma de cuenta o transferencia de paquete."
                ),
            )
        )

        if meta.has_install_scripts:
            findings.append(
                ScanFinding(
                    rule_id="PKG-TEMPORAL-CHAIN-01",
                    severity="CRITICAL",
                    confidence=0.91,
                    evidence=f"{meta.ecosystem}:{meta.name} cambio de mantenedor + script de instalación",
                    location=location,
                    explanation=(
                        f"Correlación temporal: '{meta.name}' combina un cambio reciente de "
                        "mantenedor con scripts de instalación declarados."
                    ),
                )
            )


def compute_explainable_score(
    findings: list[ScanFinding],
    weights: dict[str, int] | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    table = weights or load_scanner_weights()
    breakdown: list[dict[str, Any]] = []
    total = 0
    for f in findings:
        pts = int(table.get(f.rule_id, 10))
        total += pts
        breakdown.append(
            {
                "rule_id": f.rule_id,
                "points": pts,
                "severity": f.severity,
                "location": f.location,
                "reason": f.explanation,
            }
        )
    return min(100, total), breakdown
