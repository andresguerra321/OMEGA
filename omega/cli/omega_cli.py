"""CLI oficial de OMEGA (`omega scan <ruta>`) usando solo stdlib + módulos internos."""

from __future__ import annotations

import argparse
import fnmatch
import io
import json
import os
from pathlib import Path
import sys
import tarfile
from typing import Any
import urllib.error
import urllib.parse
import urllib.request
import uuid

# Permitir importar sarif_exporter y repo_scanner sin duplicar lógica
_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_DIR = _REPO_ROOT / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

from sarif_exporter import sanitize_untrusted_text, scan_status_to_sarif  # noqa: E402
from terminal_ui import TerminalRenderer  # noqa: E402

EXIT_CLEAN = 0
EXIT_FINDINGS = 1
EXIT_USAGE = 2
EXIT_NETWORK_AUTH = 3
EXIT_LIMITS = 4

DEFAULT_MAX_BYTES = 52_428_800  # 50 MiB
DEFAULT_MAX_FILES = 5000

SEVERITY_ORDER = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}

# Exclusiones obligatorias de seguridad (nunca se desactivan, ni con --include-ignored)
MANDATORY_SECRET_NAMES = {
    ".env",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "id_rsa",
    "id_rsa.pub",
    "id_ed25519",
    "id_ed25519.pub",
    "id_ecdsa",
    "credentials.json",
    "secrets.json",
}
MANDATORY_SECRET_PREFIXES = (".env.",)
MANDATORY_SECRET_EXTENSIONS = (".pem", ".key", ".p12", ".pfx", ".jks", ".kdbx")
INTERNAL_EXCLUDED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}


def parse_gitignore(root: Path) -> list[tuple[str, bool]]:
    """Parser propio de .gitignore (sin subprocess/git).

    Límites documentados: evalúa el .gitignore raíz con patrones glob/fnmatch y negaciones (!);
    no procesa .gitignore anidados en subdirectorios ni clases de caracteres extendidas.
    """
    gi_path = root / ".gitignore"
    if not gi_path.is_file():
        return []
    rules: list[tuple[str, bool]] = []
    for raw_line in gi_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        negated = line.startswith("!")
        if negated:
            line = line[1:].strip()
        if line:
            rules.append((line, negated))
    return rules


def matches_gitignore(rel_posix: str, is_dir: bool, rules: list[tuple[str, bool]]) -> bool:
    ignored = False
    name = rel_posix.rsplit("/", 1)[-1]
    for pattern, negated in rules:
        dir_only = pattern.endswith("/")
        clean = pattern.rstrip("/")
        if dir_only and not is_dir:
            # Si el patrón es un directorio (ej. dist/), también ignora archivos dentro
            if rel_posix.startswith(clean.lstrip("/") + "/"):
                ignored = not negated
            continue
        anchored = clean.startswith("/")
        clean = clean.lstrip("/")
        matched = (
            fnmatch.fnmatch(rel_posix, clean)
            if anchored or "/" in clean
            else fnmatch.fnmatch(name, clean) or fnmatch.fnmatch(rel_posix, f"*/{clean}")
        )
        if matched:
            ignored = not negated
    return ignored


def is_mandatory_secret(rel_posix: str) -> bool:
    name = rel_posix.rsplit("/", 1)[-1].lower()
    if name in MANDATORY_SECRET_NAMES:
        return True
    if any(name.startswith(pref) for pref in MANDATORY_SECRET_PREFIXES):
        return True
    if any(name.endswith(ext) for ext in MANDATORY_SECRET_EXTENSIONS):
        return True
    return False


def collect_repo_files(
    target_dir: Path,
    *,
    include_ignored: bool = False,
    max_files: int = DEFAULT_MAX_FILES,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> tuple[list[tuple[Path, str]], dict[str, int]]:
    """Recorre target_dir de forma segura excluyendo secretos y aplicando límites antes de empaquetar."""
    rules = [] if include_ignored else parse_gitignore(target_dir)
    included: list[tuple[Path, str]] = []
    excluded_counts = {"secretos": 0, "gitignore": 0, "directorios_internos": 0}
    total_raw_bytes = 0

    for current_root, dirs, files in os.walk(target_dir, followlinks=False):
        rel_root = Path(current_root).relative_to(target_dir).as_posix()
        kept_dirs: list[str] = []
        for d in sorted(dirs):
            rel_d = d if rel_root == "." else f"{rel_root}/{d}"
            if d in INTERNAL_EXCLUDED_DIRS:
                excluded_counts["directorios_internos"] += 1
                continue
            if not include_ignored and matches_gitignore(rel_d, True, rules):
                excluded_counts["gitignore"] += 1
                continue
            kept_dirs.append(d)
        dirs[:] = kept_dirs

        for fname in sorted(files):
            fpath = Path(current_root) / fname
            if fpath.is_symlink():
                excluded_counts["directorios_internos"] += 1
                continue
            rel_f = fname if rel_root == "." else f"{rel_root}/{fname}"
            if is_mandatory_secret(rel_f):
                excluded_counts["secretos"] += 1
                continue
            if not include_ignored and matches_gitignore(rel_f, False, rules):
                excluded_counts["gitignore"] += 1
                continue

            size = fpath.stat().st_size
            total_raw_bytes += size
            included.append((fpath, rel_f))

            if len(included) > max_files:
                raise ValueError(
                    f"El directorio supera el límite local de archivos ({max_files})."
                )
            if total_raw_bytes > max_bytes:
                raise ValueError(
                    f"El directorio supera el límite local de tamaño ({max_bytes // (1024 * 1024)} MiB)."
                )

    return included, excluded_counts


def build_tar_gz_bytes(files: list[tuple[Path, str]], *, max_bytes: int = DEFAULT_MAX_BYTES) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for fpath, rel_posix in files:
            tf.add(fpath, arcname=rel_posix, recursive=False)
    raw = buf.getvalue()
    if len(raw) > max_bytes:
        raise ValueError(
            f"El archivo comprimido supera el límite máximo permitido ({max_bytes // (1024 * 1024)} MiB)."
        )
    return raw


def validate_server_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PermissionError("URL del servidor OMEGA inválida.")
    host = (parsed.hostname or "").lower()
    if parsed.scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        raise PermissionError(
            "Se rechaza http:// fuera de localhost para proteger el token de API; usa https://."
        )
    return url.rstrip("/")


def upload_archive_scan(base_url: str, token: str, archive_bytes: bytes) -> dict[str, Any]:
    boundary = f"----omega-{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="repo.tar.gz"\r\n'
        "Content-Type: application/gzip\r\n\r\n"
    ).encode("utf-8") + archive_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        f"{base_url}/api/v1/repo/scan",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "omega-cli/2.0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 429):
            raise PermissionError(f"Autenticación o cuota rechazada (HTTP {exc.code}).") from exc
        if exc.code in (400, 413):
            raise ValueError(f"Escaneo rechazado por límites del servidor (HTTP {exc.code}).") from exc
        raise ConnectionError(f"Error del servidor OMEGA (HTTP {exc.code}).") from exc
    except urllib.error.URLError as exc:
        raise ConnectionError("No se pudo conectar con el servidor OMEGA.") from exc


class _OfflineNoopRegistryClient:
    """Stub sin red para modo --offline."""

    def get_package_metadata(self, ecosystem: str, name: str) -> None:  # noqa: ARG002
        return None


def run_offline_scan(archive_bytes: bytes) -> dict[str, Any]:
    from repo_scanner import scan_archive_bytes  # noqa: E402

    status = scan_archive_bytes(
        "repo.tar.gz",
        archive_bytes,
        registry_client=_OfflineNoopRegistryClient(),
    )
    data = status.model_dump()
    limitations = list(data.get("limitations") or [])
    limitations.append(
        "Modo --offline: solo detectores estáticos locales; sin consultas a registries ni advisories externos."
    )
    data["limitations"] = limitations
    return data


def _resolve_token(args: argparse.Namespace, ui_err: TerminalRenderer) -> str | None:
    if getattr(args, "token", None):
        ui_err.warn(
            "Riesgo de seguridad: pasar --token por argumento puede quedar en el historial o lista de procesos. "
            "Usa la variable OMEGA_API_TOKEN o --token-stdin."
        )
        return str(args.token).strip()
    if getattr(args, "token_stdin", False):
        return sys.stdin.read().strip()
    env_tok = os.environ.get("OMEGA_API_TOKEN", "").strip()
    return env_tok or None


def main(argv: list[str] | None = None, *, stdout=None, stderr=None) -> int:
    parser = argparse.ArgumentParser(prog="omega", description="CLI de análisis estático OMEGA")
    sub = parser.add_subparsers(dest="command", required=True)

    scan_p = sub.add_parser("scan", help="Empaqueta y analiza un repositorio de forma estática")
    scan_p.add_argument("path", help="Ruta al directorio del repositorio")
    scan_p.add_argument("--url", default="http://127.0.0.1:8080", help="URL base del backend OMEGA")
    scan_p.add_argument("--token", default="", help="Token de API (preferir OMEGA_API_TOKEN o --token-stdin)")
    scan_p.add_argument("--token-stdin", action="store_true", help="Leer el token de API desde stdin")
    scan_p.add_argument("--offline", action="store_true", help="Ejecutar solo detectores locales sin red")
    scan_p.add_argument("--format", choices=["text", "json", "sarif"], default="text", help="Formato de salida")
    scan_p.add_argument("--output", default="", help="Escribir salida a archivo en lugar de stdout")
    scan_p.add_argument(
        "--fail-on",
        choices=["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        default="",
        help="Fallar (código 1) si hay hallazgos con severidad >= umbral",
    )
    scan_p.add_argument("--include-ignored", action="store_true", help="Incluir archivos ignorados por .gitignore (nunca secretos)")
    scan_p.add_argument("--preview", action="store_true", help="Mostrar archivos a incluir y exclusiones sin subir")

    args = parser.parse_args(argv)
    out_stream = stdout or sys.stdout
    err_stream = stderr or sys.stderr
    ui = TerminalRenderer(out_stream)
    ui_err = TerminalRenderer(err_stream)

    target = Path(args.path).resolve()
    if not target.is_dir():
        ui_err.error(f"La ruta no es un directorio válido: {args.path}")
        return EXIT_USAGE

    try:
        files, excluded = collect_repo_files(target, include_ignored=args.include_ignored)
        archive_bytes = b"" if args.preview else build_tar_gz_bytes(files)
    except ValueError as exc:
        ui_err.error(sanitize_untrusted_text(str(exc)))
        return EXIT_LIMITS

    if args.format == "text" or args.preview:
        ui_err.step(
            f"Archivos seleccionados: {len(files)} | Excluidos -> secretos: {excluded['secretos']}, "
            f".gitignore: {excluded['gitignore']}, internos: {excluded['directorios_internos']}"
        )

    if args.preview:
        for _, rel_f in files[:50]:
            out_stream.write(f"  {sanitize_untrusted_text(rel_f)}\n")
        if len(files) > 50:
            out_stream.write(f"  ... ({len(files) - 50} más)\n")
        return EXIT_CLEAN

    if args.offline:
        result = run_offline_scan(archive_bytes)
    else:
        token = _resolve_token(args, ui_err)
        if not token:
            ui_err.error("Falta token de API. Configura OMEGA_API_TOKEN o usa --token-stdin.")
            return EXIT_NETWORK_AUTH
        try:
            base_url = validate_server_url(args.url)
            result = upload_archive_scan(base_url, token, archive_bytes)
        except PermissionError as exc:
            ui_err.error(sanitize_untrusted_text(str(exc)))
            return EXIT_NETWORK_AUTH
        except ValueError as exc:
            ui_err.error(sanitize_untrusted_text(str(exc)))
            return EXIT_LIMITS
        except ConnectionError as exc:
            ui_err.error(sanitize_untrusted_text(str(exc)))
            return EXIT_NETWORK_AUTH

    if args.format == "sarif":
        payload = json.dumps(scan_status_to_sarif(result), indent=2, ensure_ascii=False)
        if args.output:
            Path(args.output).write_text(payload, encoding="utf-8")
        else:
            out_stream.write(payload + "\n")
    elif args.format == "json":
        payload = json.dumps(result, indent=2, ensure_ascii=False)
        if args.output:
            Path(args.output).write_text(payload, encoding="utf-8")
        else:
            out_stream.write(payload + "\n")
    else:
        if args.output:
            buf = io.StringIO()
            TerminalRenderer(buf, force_color=False, force_ascii=True).render_scan_result(
                result, sanitizer=sanitize_untrusted_text
            )
            Path(args.output).write_text(buf.getvalue(), encoding="utf-8")
        else:
            ui.render_scan_result(result, sanitizer=sanitize_untrusted_text)

    if args.fail_on:
        threshold = SEVERITY_ORDER[args.fail_on]
        for finding in result.get("findings") or []:
            sev = str(finding.get("severity") or "LOW").upper()
            if SEVERITY_ORDER.get(sev, 1) >= threshold:
                return EXIT_FINDINGS

    return EXIT_CLEAN


if __name__ == "__main__":
    raise SystemExit(main())
