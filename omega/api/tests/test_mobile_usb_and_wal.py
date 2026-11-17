from __future__ import annotations

import shutil
import sqlite3
import tempfile
from pathlib import Path

import pytest

from mobile_backup_streamer import (
    iter_sqlite_chunks,
    snapshot_sqlite_with_wal,
    stream_backup_directory,
    stream_manifest_targets,
)
from usb_device_connector import list_connected_devices, run_usb_triage


def test_sqlite_wal_snapshot_and_manifest_streaming(tmp_path: Path):
    """Verifica copia consistente con journal -wal activo y lectura en streaming de Manifest.db."""
    backup_dir = tmp_path / "ios_backup"
    backup_dir.mkdir(parents=True, exist_ok=True)

    # 1. Crear base SQLite con journal_mode=WAL y transacciones activas en -wal
    sms_fid = "3d0d7e5fb2ce288813306e4d4636395e047a3d28"
    sms_subdir = backup_dir / sms_fid[:2]
    sms_subdir.mkdir(parents=True, exist_ok=True)
    sms_path = sms_subdir / sms_fid

    sms_conn = sqlite3.connect(str(sms_path))
    sms_conn.execute("PRAGMA journal_mode=WAL;")
    sms_conn.execute("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT);")
    sms_conn.execute(
        "INSERT INTO message (text) VALUES ('Visita https://free247downloads.com/login urgente');"
    )
    sms_conn.commit()
    # Mantener conexión abierta para que el archivo -wal exista en disco durante la instantánea
    snap_path = snapshot_sqlite_with_wal(sms_path, tmp_path / "snaps")
    sms_conn.close()

    assert snap_path.exists()
    chunks = list(iter_sqlite_chunks(snap_path, artifact_label="sms.db", batch_size=50))
    assert any("free247downloads.com" in text for batch in chunks for text, _ in batch)

    # 2. Crear Manifest.db simulado con ruta volátil sospechosa y puntero a sms.db
    manifest_path = backup_dir / "Manifest.db"
    m_conn = sqlite3.connect(str(manifest_path))
    m_conn.execute(
        "CREATE TABLE Files (fileID TEXT PRIMARY KEY, domain TEXT, relativePath TEXT, flags INTEGER, file BLOB);"
    )
    m_conn.executemany(
        "INSERT INTO Files (fileID, domain, relativePath, flags, file) VALUES (?, ?, ?, ?, ?);",
        [
            (sms_fid, "HomeDomain", "Library/SMS/sms.db", 1, b""),
            ("aa11bb22cc33dd44ee55ff6677889900aabbccdd", "RootDomain", "/private/var/tmp/roleaboutd", 1, b""),
            ("bb22cc33dd44ee55ff6677889900aabbccdd1122", "SystemPreferencesDomain", "ConfigurationProfiles/corp.mobileconfig", 1, b""),
        ],
    )
    m_conn.commit()
    m_conn.close()

    manifest_res = stream_manifest_targets(manifest_path, backup_root=backup_dir, batch_size=2)
    assert manifest_res["total_files_scanned"] == 3
    assert any(t["file_id"] == sms_fid and t["exists"] for t in manifest_res["targets"])
    categories = {a["category"] for a in manifest_res["manifest_anomalies"]}
    assert "IOS_MANIFEST_VOLATILE_PATH" in categories
    assert "IOS_CONFIG_PROFILE_PRESENT" in categories

    # 3. Streaming completo del directorio de backup con lookup mockeado
    stream_res = stream_backup_directory(
        backup_dir,
        batch_size=2,
        lookup_fn=lambda cands: [
            {"ioc_type": "domain", "ioc_value": "free247downloads.com", "spyware_family": "Pegasus"}
        ]
        if "free247downloads.com" in cands
        else [],
    )
    assert stream_res["rows_streamed"] >= 1
    assert len(stream_res["cti_matches"]) == 1


def test_usb_device_detection_states():
    """Verifica detección USB mockeada para NEEDS_TRUST, PAIRED (iOS) y UNAUTHORIZED, DEVICE (Android)."""

    def fake_which(binary: str) -> str | None:
        return f"/usr/bin/{binary}"

    def fake_runner(cmd: list[str], timeout: int) -> tuple[int, str, str]:
        exe = Path(cmd[0]).name
        if exe == "idevice_id":
            return 0, "00008110-0011223344556677\n00008110-9988776655443322\n", ""
        if exe == "ideviceinfo":
            udid = cmd[-1]
            if udid.endswith("6677"):
                return (
                    0,
                    "DeviceName: iPhone de Andrés\nProductType: iPhone15,2\nProductVersion: 17.5.1\n",
                    "",
                )
            return 1, "", "ERROR: Could not connect to lockdownd: PairingDialogResponsePending"
        if exe == "adb" and cmd[1:3] == ["devices", "-l"]:
            return (
                0,
                "List of devices attached\n"
                "R58M123456A            unauthorized usb:1-1 transport_id:1\n"
                "R58M999999Z            device product:dm3q model:SM_S918B device:dm3q\n",
                "",
            )
        if exe == "adb" and "getprop" in cmd:
            return 0, "14\n", ""
        return 0, "", ""

    res = list_connected_devices(run_cmd=fake_runner, which_fn=fake_which)
    assert res["status"] == "OK"
    by_id = {d["id"]: d for d in res["devices"]}

    assert by_id["00008110-0011223344556677"]["state"] == "PAIRED"
    assert by_id["00008110-0011223344556677"]["authorized"] is True
    assert by_id["00008110-9988776655443322"]["state"] == "NEEDS_TRUST"
    assert by_id["00008110-9988776655443322"]["authorized"] is False
    assert by_id["R58M123456A"]["state"] == "UNAUTHORIZED"
    assert by_id["R58M999999Z"]["state"] == "DEVICE"
    assert by_id["R58M999999Z"]["osVersion"] == "Android 14"


def test_zero_retention_cleanup_on_success_and_midflight_failure(tmp_path: Path, monkeypatch):
    """Comprueba que el directorio temporal omega_usb_* se destruye siempre, incluso si el triaje lanza excepción."""
    sim_dir = tmp_path / "sim_backup"
    sim_dir.mkdir()
    (sim_dir / "sample.txt").write_text(" conexión hacia https://free247downloads.com/stage ", encoding="utf-8")

    created_temp_dirs: list[Path] = []
    real_mkdtemp = tempfile.mkdtemp

    def tracked_mkdtemp(*args, **kwargs):
        p = real_mkdtemp(*args, **kwargs)
        if kwargs.get("prefix") == "omega_usb_":
            created_temp_dirs.append(Path(p))
        return p

    monkeypatch.setattr(tempfile, "mkdtemp", tracked_mkdtemp)

    # 1. Caso exitoso
    res = run_usb_triage(
        platform="IOS",
        device_id="00008110-0011223344556677",
        simulated_backup_dir=sim_dir,
        lookup_fn=lambda _: [],
    )
    assert res["zeroRetentionWiped"] is True
    assert len(created_temp_dirs) == 1
    assert not created_temp_dirs[0].exists()

    # 2. Caso fallo a mitad del triaje (lookup_fn lanza RuntimeError)
    with pytest.raises(RuntimeError, match="Simulated mid-flight failure"):
        run_usb_triage(
            platform="ANDROID",
            device_id="R58M999999Z",
            simulated_backup_dir=sim_dir,
            lookup_fn=lambda _: (_ for _ in ()).throw(RuntimeError("Simulated mid-flight failure")),
        )

    assert len(created_temp_dirs) == 2
    assert not created_temp_dirs[1].exists()
