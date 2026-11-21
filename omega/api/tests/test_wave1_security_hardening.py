"""Pruebas de regresión Ola 1 para worker Python (C-01 y C-02)."""
import io
import zipfile
from pathlib import Path
import pytest

import archive_safety
import repo_scanner
import quarantine_vault


def test_c01_archive_safety_rejects_duplicate_zip_member_names():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("src/app.py", "print('v1')\n")
        zf.writestr("src/app.py", "print('v2-duplicate')\n")
    with pytest.raises(ValueError, match="duplicados"):
        archive_safety.validate_archive("dup.zip", buf.getvalue())


def test_c01_repo_scanner_reads_each_zipinfo_individually_without_amplification():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("a.txt", "small-1")
        zf.writestr("a.txt", "LARGE-SECOND-ENTRY")
    files = repo_scanner._extract_text_files_in_memory("dup.zip", buf.getvalue(), max_files=10)
    assert [content for _, content in files] == ["small-1", "LARGE-SECOND-ENTRY"]


def test_c02_restore_file_metadata_rejects_symlink_target(tmp_path):
    real_file = tmp_path / "real.txt"
    real_file.write_text("ok", encoding="utf-8")
    link_file = tmp_path / "link.txt"
    try:
        link_file.symlink_to(real_file)
    except OSError:
        pytest.skip("El entorno Windows actual no permite crear symlinks sin privilegios.")
    with pytest.raises(ValueError, match="simbólicos"):
        quarantine_vault.restore_file_metadata(link_file, {"uid": 0, "gid": 0, "sddl": "D:"})


def test_c02_restore_file_metadata_accepts_fd_parameter_on_posix_path(monkeypatch, tmp_path):
    target = tmp_path / "restored.txt"
    target.write_text("data", encoding="utf-8")
    calls = []

    class DummyStat:
        st_uid = 1000
        st_gid = 1000

    real_fstat = quarantine_vault.os.fstat
    monkeypatch.setattr(quarantine_vault.sys, "platform", "linux")
    monkeypatch.setattr(quarantine_vault.os, "fstat", lambda fd: DummyStat() if fd == 42 else real_fstat(fd), raising=False)
    monkeypatch.setattr(quarantine_vault.os, "fchown", lambda fd, uid, gid: calls.append(("fchown", fd, uid, gid)), raising=False)
    monkeypatch.setattr(quarantine_vault.os, "setxattr", lambda fd, name, val: calls.append(("setxattr", fd, name, val)), raising=False)

    quarantine_vault.restore_file_metadata(
        target,
        {"uid": 1001, "gid": 1001, "xattrs": {"user.test": "aGVsbG8="}},
        fd=42,
    )
    assert ("fchown", 42, 1001, 1001) in calls
    assert ("setxattr", 42, "user.test", b"hello") in calls
