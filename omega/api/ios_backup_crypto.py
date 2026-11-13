"""Desbloqueo y descifrado de copias de seguridad encriptadas de iOS 100% en RAM (RNF4).

Usa BackupKeyBag (PBKDF2-HMAC-SHA256/SHA1 + AES KeyWrap RFC 3394 + AES-256-CBC)
y sqlite3.Connection.deserialize() de Python 3.11+ para abrir Manifest.db y los
artefactos forenses exclusivamente en memoria volátil, sin crear archivos temporales
en disco ni persistir contraseñas.
"""

from __future__ import annotations

import base64
import plistlib
import re
import secrets
import sqlite3
import struct
import threading
import time
from typing import Any

try:
    from iphone_backup_decrypt import utils as _ibd_utils  # type: ignore

    HAS_IOS_CRYPTO = True
except ImportError:  # pragma: no cover
    _ibd_utils = None
    HAS_IOS_CRYPTO = False

SQLITE_MAGIC = b"SQLite format 3\x00"
_SESSION_LOCK = threading.Lock()
_EPHEMERAL_SESSIONS: dict[str, dict[str, Any]] = {}
_SESSION_TTL_SECONDS = 180.0
_MAX_ACTIVE_SESSIONS = 8

IOS_TARGET_SQL_QUERY = """
SELECT fileID, domain, relativePath, file
FROM Files
WHERE relativePath IS NOT NULL AND relativePath != ''
  AND (
    LOWER(relativePath) LIKE '%sms.db'
    OR LOWER(relativePath) LIKE '%history.db'
    OR LOWER(relativePath) LIKE '%datausage.sqlite'
    OR LOWER(relativePath) LIKE '%netusage.sqlite'
    OR LOWER(relativePath) LIKE '%tcc.db'
    OR LOWER(relativePath) LIKE '%shutdown.log%'
    OR LOWER(relativePath) LIKE '%.ips'
    OR LOWER(relativePath) LIKE '%.crash'
    OR LOWER(relativePath) LIKE '%var/tmp/%'
    OR LOWER(relativePath) LIKE '%/tmp/%'
    OR LOWER(relativePath) LIKE '%roleabout%'
    OR LOWER(relativePath) LIKE '%pcsd%'
    OR LOWER(relativePath) LIKE '%ckdiscretionaryd%'
    OR LOWER(relativePath) LIKE '%bridgepd%'
    OR LOWER(relativePath) LIKE '%.pkpass'
    OR LOWER(relativePath) LIKE '%configurationprofiles%'
    OR LOWER(relativePath) LIKE '%.mobileconfig'
    OR LOWER(relativePath) LIKE '%currentpowerlog.plsql%'
    OR LOWER(relativePath) LIKE '%powerlog%.sql%'
  )
LIMIT 50;
"""

SUSPICIOUS_MANIFEST_SUBSTRS = (
    "/private/var/tmp/",
    "/var/tmp/",
    "/tmp/",
    "roleabout",
    "bridgehead",
    "staging.sqlite",
    "pcsd",
    "ckdiscretionaryd",
)


def _purge_expired_sessions_locked(now: float) -> None:
    expired = [tok for tok, sess in _EPHEMERAL_SESSIONS.items() if now >= sess.get("expires_at", 0.0)]
    for tok in expired:
        _EPHEMERAL_SESSIONS.pop(tok, None)
    while len(_EPHEMERAL_SESSIONS) >= _MAX_ACTIVE_SESSIONS:
        oldest = min(_EPHEMERAL_SESSIONS.items(), key=lambda item: item[1].get("expires_at", 0.0))[0]
        _EPHEMERAL_SESSIONS.pop(oldest, None)


def _open_sqlite_in_ram(db_bytes: bytes) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    if not hasattr(conn, "deserialize"):
        conn.close()
        raise RuntimeError("Este intérprete Python/SQLite no soporta sqlite3.deserialize en RAM.")
    conn.deserialize(db_bytes)
    return conn


def inspect_manifest_profiles_and_paths(conn: sqlite3.Connection) -> tuple[int, list[dict], list[dict[str, str]], dict[str, tuple[int, bytes, int]]]:
    """Extrae totales, anomalías de rutas/perfiles, targets forenses y file_meta desde SQLite en RAM."""
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM Files;")
    total_files = int((cur.fetchone() or [0])[0] or 0)

    anomalies: list[dict] = []
    seen_anom: set[str] = set()

    # Inspección rápida de perfiles de configuración MDM / CA / rutas volátiles
    cur.execute("SELECT fileID, domain, relativePath FROM Files WHERE relativePath IS NOT NULL LIMIT 50000;")
    for file_id, domain, rel_path in cur.fetchall():
        path_str = str(rel_path or "")
        low = path_str.lower()
        dom = str(domain or "")

        if any(marker in low for marker in SUSPICIOUS_MANIFEST_SUBSTRS):
            if path_str not in seen_anom:
                seen_anom.add(path_str)
                anomalies.append(
                    {
                        "category": "IOS_MANIFEST_VOLATILE_PATH",
                        "severity": "CRITICAL",
                        "indicator": path_str,
                        "artifact": f"Manifest.db (RAM · {dom})",
                        "detail": (
                            f"Artefacto respaldado en ruta volátil o asociada a implantes móviles "
                            f"(fileID: {file_id})."
                        ),
                    }
                )
        elif low.endswith(".mobileconfig") or ("configurationprofiles" in low and (low.endswith(".plist") or low.endswith(".stub"))):
            if path_str not in seen_anom:
                seen_anom.add(path_str)
                anomalies.append(
                    {
                        "category": "IOS_CONFIG_PROFILE_PRESENT",
                        "severity": "MEDIUM",
                        "indicator": path_str,
                        "artifact": f"Manifest.db (RAM · {dom})",
                        "detail": (
                            "Se detectó un perfil de configuración/MDM (.mobileconfig) en la copia del iPhone. "
                            "Conviene verificar que pertenezca a tu empresa/escuela y no a un tercero."
                        ),
                    }
                )

    # Selección acotada de artefactos forenses + metadatos criptográficos
    cur.execute(IOS_TARGET_SQL_QUERY)
    targets: list[dict[str, str]] = []
    file_meta: dict[str, tuple[int, bytes, int]] = {}
    for file_id, domain, rel_path, file_blob in cur.fetchall():
        fid = str(file_id or "").strip()
        if not fid:
            continue
        targets.append(
            {
                "file_id": fid,
                "domain": str(domain or ""),
                "relative_path": str(rel_path or ""),
                "subpath": f"{fid[:2]}/{fid}",
            }
        )
        if _ibd_utils is not None and isinstance(file_blob, (bytes, bytearray)) and file_blob:
            try:
                fp = _ibd_utils.FilePlist(bytes(file_blob))
                if fp.encryption_key is not None:
                    file_meta[fid.lower()] = (
                        int(fp.protection_class),
                        bytes(fp.encryption_key),
                        int(fp.filesize or 0),
                    )
            except Exception:
                pass

    return total_files, anomalies[:25], targets, file_meta


def _unlock_keybag_and_manifest(
    manifest_plist_bytes: bytes,
    manifest_db_bytes: bytes,
    password: str,
) -> tuple[Any, bytes]:
    if not HAS_IOS_CRYPTO or _ibd_utils is None:
        raise RuntimeError("Falta la librería iphone-backup-decrypt / pycryptodome en el servidor.")

    if not manifest_plist_bytes or not manifest_db_bytes:
        raise ValueError("Faltan Manifest.plist o Manifest.db para desbloquear la copia.")
    if not password:
        raise ValueError("Debes ingresar la contraseña de tu copia de seguridad de iPhone.")

    try:
        manifest_plist = plistlib.loads(manifest_plist_bytes)
    except Exception as exc:
        raise ValueError(f"Manifest.plist inválido o corrupto: {exc}") from exc

    if not manifest_plist.get("IsEncrypted"):
        if manifest_db_bytes[:16] == SQLITE_MAGIC:
            raise ValueError("BACKUP_NOT_ENCRYPTED")
        raise ValueError("Manifest.plist no indica cifrado de iTunes válido.")

    keybag_raw = manifest_plist.get("BackupKeyBag")
    manifest_key_raw = manifest_plist.get("ManifestKey")
    if not keybag_raw or not manifest_key_raw or len(manifest_key_raw) < 8:
        raise ValueError("Manifest.plist incompleto (sin BackupKeyBag o ManifestKey).")

    keybag = _ibd_utils.BackupKeyBag(keybag_raw)
    pw_bytes: bytes | None = password.encode("utf-8")
    try:
        unlocked = keybag.unlock_with_passphrase(pw_bytes)
    finally:
        pw_bytes = None
        del pw_bytes

    if not unlocked or not keybag.unlocked:
        raise ValueError("INVALID_BACKUP_PASSWORD")

    try:
        manifest_class = struct.unpack("<l", manifest_key_raw[:4])[0]
        wrapped_mk = manifest_key_raw[4:]
        inner_key = keybag.unwrap_key_for_class(manifest_class, wrapped_mk)
        if not inner_key:
            raise ValueError("INVALID_BACKUP_PASSWORD")
        decrypted_cbc = _ibd_utils.aes_decrypt_cbc(data=manifest_db_bytes, key=inner_key)
        manifest_plain = _ibd_utils.remove_cbc_padding(decrypted_cbc)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("INVALID_BACKUP_PASSWORD") from exc

    if manifest_plain[:16] != SQLITE_MAGIC:
        raise ValueError("INVALID_BACKUP_PASSWORD")

    return keybag, manifest_plain


def unlock_encrypted_ios_backup_in_ram(
    manifest_plist_bytes: bytes,
    manifest_db_bytes: bytes,
    password: str,
) -> dict[str, Any]:
    """Desbloquea una copia encriptada iOS en RAM, extrae objetivos y crea token volátil."""
    keybag, manifest_plain = _unlock_keybag_and_manifest(
        manifest_plist_bytes=manifest_plist_bytes,
        manifest_db_bytes=manifest_db_bytes,
        password=password,
    )
    conn = _open_sqlite_in_ram(manifest_plain)
    try:
        total_files, manifest_anomalies, targets, file_meta = inspect_manifest_profiles_and_paths(conn)
    finally:
        conn.close()
        del manifest_plain

    token = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _SESSION_LOCK:
        _purge_expired_sessions_locked(now)
        _EPHEMERAL_SESSIONS[token] = {
            "expires_at": now + _SESSION_TTL_SECONDS,
            "keybag": keybag,
            "file_meta": file_meta,
            "manifest_anomalies": manifest_anomalies,
        }

    return {
        "encrypted": True,
        "unlocked": True,
        "unlock_token": token,
        "targets": targets,
        "manifest_total_files": total_files,
        "manifest_anomalies": manifest_anomalies,
        "ram_only": True,
        "detail": (
            f"Copia desbloqueada en memoria temporal: {total_files} archivos indexados y "
            f"{len(targets)} artefacto(s) forense(s) seleccionado(s)."
        ),
    }


def _extract_file_id_hint(art: dict[str, Any]) -> str:
    explicit = str(art.get("file_id") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{32,64}", explicit):
        return explicit
    fname = str(art.get("filename") or "")
    m = re.search(r"([0-9a-f]{40})", fname.lower())
    return m.group(1) if m else ""


def decrypt_binary_artifacts_in_ram(
    binary_artifacts: list[dict[str, Any]],
    unlock_token: str | None = None,
    manifest_plist_b64: str | None = None,
    manifest_db_b64: str | None = None,
    password: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict], int]:
    """Descifra artefactos binarios de iOS en RAM consumiendo la sesión volátil de un solo uso."""
    session: dict[str, Any] | None = None
    if unlock_token:
        with _SESSION_LOCK:
            _purge_expired_sessions_locked(time.monotonic())
            session = _EPHEMERAL_SESSIONS.pop(unlock_token, None)

    if session is None and manifest_plist_b64 and manifest_db_b64 and password:
        plist_bytes = base64.b64decode(manifest_plist_b64)
        db_bytes = base64.b64decode(manifest_db_b64)
        keybag, manifest_plain = _unlock_keybag_and_manifest(plist_bytes, db_bytes, password)
        conn = _open_sqlite_in_ram(manifest_plain)
        try:
            _, manifest_anomalies, _, file_meta = inspect_manifest_profiles_and_paths(conn)
        finally:
            conn.close()
            del manifest_plain
        session = {
            "keybag": keybag,
            "file_meta": file_meta,
            "manifest_anomalies": manifest_anomalies,
        }

    if session is None:
        return binary_artifacts, [], 0

    keybag = session["keybag"]
    file_meta: dict[str, tuple[int, bytes, int]] = session.get("file_meta") or {}
    manifest_anomalies: list[dict] = list(session.get("manifest_anomalies") or [])
    decrypted_count = 0
    result_artifacts: list[dict[str, Any]] = []

    try:
        for art in binary_artifacts or []:
            if not isinstance(art, dict):
                continue
            fname = str(art.get("filename") or "artifact.bin")
            b64 = str(art.get("content_b64") or "")
            raw_bytes: bytes | None = art.get("raw_bytes")
            if raw_bytes is None and b64:
                try:
                    raw_bytes = base64.b64decode(b64)
                except Exception:
                    raw_bytes = b""

            if raw_bytes is None or not raw_bytes:
                result_artifacts.append(art)
                continue

            # Si ya viene en SQLite texto plano o XML/JSON legibles (ej. crashlogs o Manifest ya procesado), no re-descifrar
            if raw_bytes[:16] == SQLITE_MAGIC or raw_bytes.lstrip()[:1] in (b"{", b"[", b"<"):
                result_artifacts.append(art)
                continue

            fid = _extract_file_id_hint(art)
            meta = file_meta.get(fid)
            if meta is None or _ibd_utils is None:
                result_artifacts.append(art)
                continue

            pclass, wrapped_key, declared_size = meta
            try:
                file_key = keybag.unwrap_key_for_class(pclass, wrapped_key)
                if not file_key or len(raw_bytes) % 16 != 0:
                    result_artifacts.append(art)
                    continue
                dec_raw = _ibd_utils.aes_decrypt_cbc(data=raw_bytes, key=file_key)
                try:
                    plain_bytes = _ibd_utils.remove_cbc_padding(dec_raw)
                except ValueError:
                    plain_bytes = dec_raw[:declared_size] if declared_size > 0 else dec_raw

                decrypted_count += 1
                result_artifacts.append(
                    {
                        **art,
                        "content_b64": base64.b64encode(plain_bytes).decode("ascii"),
                        "raw_bytes": plain_bytes,
                        "decrypted_in_ram": True,
                    }
                )
            except Exception:
                result_artifacts.append(art)
    finally:
        # Limpieza explícita de material criptográfico en RAM
        session.clear()

    return result_artifacts, manifest_anomalies, decrypted_count
