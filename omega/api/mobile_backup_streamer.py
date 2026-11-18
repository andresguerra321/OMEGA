"""Motor de streaming para backups móviles pesados (30 GB - 200 GB) y SQLite WAL consistente.

Implementa:
- Copia y consolidación consistente de bases SQLite con journals activos (`-wal` y `-shm`)
  mediante SQLite Online Backup API (`sqlite3.Connection.backup`).
- Resolución en streaming (`fetchmany`) de `Manifest.db` (iOS) sin cargar el catálogo entero en RAM.
- Extracción por lotes (`fetchmany(1000)`) de registros de red, historial Safari, SMS, permisos TCC
  y anomalías temporales alimentando a `triage_orchestrator`, `temporal_correlator` y `cti_db`.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Callable, Iterator

from cti_db import lookup_iocs_detailed
from ios_backup_crypto import SUSPICIOUS_MANIFEST_SUBSTRS
from sqlite_safety import safe_identifier, open_readonly
from temporal_correlator import correlate_temporal_chains
from triage_orchestrator import _collect_tokens, run_parallel_forensic_triage

logger = logging.getLogger(__name__)

CRITICAL_ARTIFACT_PATTERNS = (
    "datausage.sqlite",
    "netusage.sqlite",
    "sms.db",
    "safari/history.db",
    "history.db",
    "tcc.db",
    ".mobileconfig",
    "shutdown.log",
    ".ips",
    ".crash",
    "currentpowerlog.plsql",
)


def snapshot_sqlite_with_wal(
    source_db_path: Path | str,
    snapshot_dir: Path | str | None = None,
) -> Path:
    """Crea una instantánea consistente de un archivo SQLite consolidando sus hermanos `-wal` y `-shm`.

    Usa primero una copia física de la terna (`.db`, `-wal`, `-shm`) en un subdirectorio volátil y
    ejecuta `sqlite3.Connection.backup()` hacia un archivo limpio sin bloqueos (`database is locked`).
    """
    src = Path(source_db_path)
    if not src.exists():
        raise FileNotFoundError(f"Base SQLite no encontrada: {src}")

    target_root = Path(snapshot_dir) if snapshot_dir else Path(tempfile.mkdtemp(prefix="omega_wal_snap_"))
    target_root.mkdir(parents=True, exist_ok=True)

    staging_dir = target_root / f"staging_{src.name}"
    staging_dir.mkdir(parents=True, exist_ok=True)
    staged_db = staging_dir / src.name

    shutil.copy2(src, staged_db)
    for suffix in ("-wal", "-shm", "-journal"):
        sibling = Path(f"{src}{suffix}")
        if sibling.exists():
            shutil.copy2(sibling, Path(f"{staged_db}{suffix}"))

    consolidated_db = target_root / f"consolidated_{src.name}"
    if consolidated_db.exists():
        consolidated_db.unlink()

    src_conn = open_readonly(staged_db)
    dst_conn = sqlite3.connect(str(consolidated_db), timeout=10.0)
    try:
        src_conn.backup(dst_conn, pages=500)
        dst_conn.commit()
    finally:
        dst_conn.close()
        src_conn.close()
        shutil.rmtree(staging_dir, ignore_errors=True)

    return consolidated_db


def _matches_critical_artifact(rel_path_lower: str) -> bool:
    return any(pat in rel_path_lower for pat in CRITICAL_ARTIFACT_PATTERNS)


def stream_manifest_targets(
    manifest_db_path: Path | str,
    *,
    backup_root: Path | str | None = None,
    batch_size: int = 1000,
    snapshot_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Recorre `Files` de `Manifest.db` en streaming con `fetchmany(batch_size)`."""
    safe_batch = max(50, min(batch_size, 5000))
    own_temp = snapshot_dir is None
    work_dir = Path(snapshot_dir) if snapshot_dir else Path(tempfile.mkdtemp(prefix="omega_manifest_"))
    root_dir = Path(backup_root) if backup_root else Path(manifest_db_path).parent

    total_files = 0
    targets: list[dict[str, Any]] = []
    anomalies: list[dict[str, Any]] = []
    seen_anom: set[str] = set()

    try:
        snap_db = snapshot_sqlite_with_wal(manifest_db_path, work_dir)
        conn = open_readonly(snap_db)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT fileID, domain, relativePath, flags FROM Files WHERE relativePath IS NOT NULL"
            )
            while True:
                rows = cur.fetchmany(safe_batch)
                if not rows:
                    break
                for file_id, domain, rel_path, flags in rows:
                    total_files += 1
                    fid = str(file_id or "").strip()
                    dom = str(domain or "")
                    path_str = str(rel_path or "")
                    low = path_str.lower()

                    if any(marker in low for marker in SUSPICIOUS_MANIFEST_SUBSTRS):
                        if path_str not in seen_anom:
                            seen_anom.add(path_str)
                            anomalies.append(
                                {
                                    "category": "IOS_MANIFEST_VOLATILE_PATH",
                                    "severity": "CRITICAL",
                                    "indicator": path_str,
                                    "artifact": f"Manifest.db ({dom})",
                                    "detail": f"Artefacto en ruta volátil asociada a implantes móviles (fileID: {fid}).",
                                }
                            )
                    elif low.endswith(".mobileconfig") or (
                        "configurationprofiles" in low and (low.endswith(".plist") or low.endswith(".stub"))
                    ):
                        if path_str not in seen_anom:
                            seen_anom.add(path_str)
                            anomalies.append(
                                {
                                    "category": "IOS_CONFIG_PROFILE_PRESENT",
                                    "severity": "MEDIUM",
                                    "indicator": path_str,
                                    "artifact": f"Manifest.db ({dom})",
                                    "detail": "Perfil MDM (.mobileconfig) detectado en el respaldo iOS.",
                                }
                            )

                    if fid and _matches_critical_artifact(low):
                        subpath = f"{fid[:2]}/{fid}"
                        candidates = [
                            root_dir / fid[:2] / fid,
                            root_dir / fid,
                        ]
                        physical_path = next((p for p in candidates if p.exists()), candidates[0])
                        targets.append(
                            {
                                "file_id": fid,
                                "domain": dom,
                                "relative_path": path_str,
                                "subpath": subpath,
                                "physical_path": str(physical_path),
                                "exists": physical_path.exists(),
                                "flags": int(flags or 0),
                            }
                        )
        finally:
            conn.close()
    finally:
        if own_temp:
            shutil.rmtree(work_dir, ignore_errors=True)

    return {
        "total_files_scanned": total_files,
        "targets": targets,
        "manifest_anomalies": anomalies,
    }


def iter_sqlite_chunks(
    db_path: Path | str,
    *,
    artifact_label: str,
    batch_size: int = 1000,
    snapshot_dir: Path | str | None = None,
) -> Iterator[list[tuple[str, str]]]:
    """Itera registros de cualquier base SQLite por lotes (`fetchmany(batch_size)`) tras consolidar su WAL."""
    safe_batch = max(50, min(batch_size, 5000))
    own_temp = snapshot_dir is None
    work_dir = Path(snapshot_dir) if snapshot_dir else Path(tempfile.mkdtemp(prefix="omega_sqlite_iter_"))

    try:
        snap_db = snapshot_sqlite_with_wal(db_path, work_dir)
        conn = open_readonly(snap_db)
        try:
            cur = conn.cursor()
            tables = [
                str(r[0])
                for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                if not str(r[0]).startswith("sqlite_")
            ]
            for tbl in tables:
                try:
                    safe_tbl = safe_identifier(tbl)
                except ValueError:
                    continue
                t_cur = conn.cursor()
                try:
                    t_cur.execute(f'SELECT * FROM "{safe_tbl}"')
                    while True:
                        rows = t_cur.fetchmany(safe_batch)
                        if not rows:
                            break
                        batch_items: list[tuple[str, str]] = []
                        origin = f"SQLite [{artifact_label}:{safe_tbl}]"
                        for row in rows:
                            text = " ".join(
                                str(col) for col in row if col is not None and len(str(col)) > 3
                            )
                            if text:
                                batch_items.append((text, origin))
                        if batch_items:
                            yield batch_items
                except sqlite3.Error as exc:
                    logger.debug("Tabla %s omitida en %s: %s", safe_tbl, artifact_label, exc)
        finally:
            conn.close()
    finally:
        if own_temp:
            shutil.rmtree(work_dir, ignore_errors=True)


def stream_backup_directory(
    backup_dir: Path | str,
    *,
    batch_size: int = 1000,
    lookup_fn: Callable[[list[str]], list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Procesa un directorio de backup móvil en streaming con consumo acotado de memoria."""
    root = Path(backup_dir)
    manifest_path = root / "Manifest.db"
    work_dir = Path(tempfile.mkdtemp(prefix="omega_stream_backup_"))
    ioc_lookup = lookup_fn or lookup_iocs_detailed

    hasher = hashlib.sha256()
    tokens: dict[str, dict[str, Any]] = {}
    small_artifacts_for_timeline: list[dict[str, Any]] = []
    manifest_result: dict[str, Any] = {
        "total_files_scanned": 0,
        "targets": [],
        "manifest_anomalies": [],
    }
    rows_streamed = 0

    try:
        if manifest_path.exists():
            hasher.update(manifest_path.read_bytes()[:65536])
            manifest_result = stream_manifest_targets(
                manifest_path,
                backup_root=root,
                batch_size=batch_size,
                snapshot_dir=work_dir,
            )

        candidate_files: list[tuple[Path, str]] = []
        for target in manifest_result["targets"]:
            p = Path(target["physical_path"])
            if p.exists() and p.is_file():
                candidate_files.append((p, target["relative_path"] or p.name))

        if not candidate_files:
            for p in sorted(root.rglob("*")):
                if p.is_file() and not p.name.endswith(("-wal", "-shm", "-journal")):
                    candidate_files.append((p, p.name))

        for file_path, rel_label in candidate_files:
            try:
                with file_path.open("rb") as fh:
                    head = fh.read(16)
                    hasher.update(head)
            except OSError:
                continue

            is_sqlite = head.startswith(b"SQLite format 3\x00") or rel_label.lower().endswith(
                (".db", ".sqlite", ".sqlite3", ".plsql")
            )
            if is_sqlite:
                for batch in iter_sqlite_chunks(
                    file_path,
                    artifact_label=rel_label,
                    batch_size=batch_size,
                    snapshot_dir=work_dir,
                ):
                    for row_text, origin in batch:
                        rows_streamed += 1
                        _collect_tokens(row_text, origin, tokens)
                # Si la base consolidada es <= 8 MB, también alimenta el correlador temporal
                try:
                    snap = snapshot_sqlite_with_wal(file_path, work_dir)
                    if snap.stat().st_size <= 8 * 1024 * 1024:
                        small_artifacts_for_timeline.append(
                            {"filename": Path(rel_label).name, "bytes": snap.read_bytes()}
                        )
                except Exception:
                    pass
            else:
                try:
                    with file_path.open("rb") as fh:
                        while True:
                            chunk = fh.read(256 * 1024)
                            if not chunk:
                                break
                            text = chunk.decode("utf-8", errors="ignore")
                            _collect_tokens(text, rel_label, tokens)
                    if file_path.stat().st_size <= 2 * 1024 * 1024:
                        small_artifacts_for_timeline.append(
                            {"filename": Path(rel_label).name, "bytes": file_path.read_bytes()}
                        )
                except OSError:
                    continue

        all_candidates = list(tokens.keys())
        cti_matches: list[dict[str, Any]] = []
        for idx in range(0, len(all_candidates), 500):
            slice_cands = all_candidates[idx : idx + 500]
            cti_matches.extend(ioc_lookup(slice_cands))

        temporal = correlate_temporal_chains(small_artifacts_for_timeline)
        anomalies = list(manifest_result["manifest_anomalies"]) + list(
            temporal.get("anomalies", [])
        )

        return {
            "artifact_sha256": hasher.hexdigest(),
            "total_manifest_files": manifest_result["total_files_scanned"],
            "targets_resolved": len(manifest_result["targets"]),
            "rows_streamed": rows_streamed,
            "indicators_extracted": len(tokens),
            "cti_matches": cti_matches,
            "behavioral_anomalies": anomalies,
            "timeline": temporal.get("timeline", []),
            "timeline_summary": temporal.get("timeline_summary", {}),
        }
    finally:
        for item in small_artifacts_for_timeline:
            item["bytes"] = b""
        small_artifacts_for_timeline.clear()
        shutil.rmtree(work_dir, ignore_errors=True)
