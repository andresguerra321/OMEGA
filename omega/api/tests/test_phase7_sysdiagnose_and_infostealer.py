from __future__ import annotations

import io
import os
import plistlib
import sqlite3
import tarfile
from pathlib import Path

from infostealer_shield import classify_sensitive_target, evaluate_process_for_infostealer
from mobile_backup_streamer import (
    analyze_ips_crash_log,
    analyze_mobileconfig_profile,
    analyze_shutdown_log,
    stream_sysdiagnose_archive,
)
from usb_device_connector import analyze_android_accessibility_and_mdm, resolve_portable_tool


def _add_tar_bytes(tf: tarfile.TarFile, arcname: str, data: bytes) -> None:
    info = tarfile.TarInfo(name=arcname)
    info.size = len(data)
    tf.addfile(info, io.BytesIO(data))


def test_stream_sysdiagnose_archive_detects_pegasus_mdm_crash_and_blocks_zip_slip(tmp_path: Path):
    archive_path = tmp_path / "sysdiagnose_2026_test.tar.gz"

    # Minimal DataUsage.sqlite with a domain string
    db_path = tmp_path / "DataUsage.sqlite"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE ZPROCESS (ZPROCNAME TEXT, ZBUNDLEID TEXT)")
    conn.execute("INSERT INTO ZPROCESS VALUES ('roleaccountd', 'com.apple.roleaccountd')")
    conn.commit()
    conn.close()
    db_bytes = db_path.read_bytes()

    mobileconfig_bytes = plistlib.dumps(
        {
            "PayloadType": "Configuration",
            "PayloadContent": [
                {
                    "PayloadType": "com.apple.security.root",
                    "PayloadIdentifier": "com.suspicious.rootca",
                },
                {
                    "PayloadType": "com.apple.mdm",
                    "PayloadIdentifier": "com.unknown.mdm",
                },
            ],
        }
    )

    shutdown_log = (
        "2026-03-01 02:11:10 SIGTERM client /private/var/tmp/roleaccountd\n"
        "2026-03-01 02:11:12 SIGTERM client /private/var/db/bh\n"
    ).encode("utf-8")

    ips_log = (
        '{"procName":"IMTranscoderAgent","exception":{"type":"EXC_BAD_ACCESS","signal":"SIGSEGV"}}\n'
        "Referenced path: /private/var/tmp/stage2\n"
    ).encode("utf-8")

    with tarfile.open(archive_path, "w:gz") as tf:
        _add_tar_bytes(tf, "sysdiagnose_1/logs/shutdown.log", shutdown_log)
        _add_tar_bytes(tf, "sysdiagnose_1/profiles/corp.mobileconfig", mobileconfig_bytes)
        _add_tar_bytes(tf, "sysdiagnose_1/crashes/IMTranscoderAgent-2026.ips", ips_log)
        _add_tar_bytes(tf, "sysdiagnose_1/databases/DataUsage.sqlite", db_bytes)
        _add_tar_bytes(tf, "../escaped_zip_slip.txt", b"should never be written")

    result = stream_sysdiagnose_archive(archive_path, lookup_fn=lambda batch: [])

    assert result["sysdiagnose_artifacts_extracted"] == 4
    assert not (tmp_path / "escaped_zip_slip.txt").exists()

    anomalies = result["behavioral_anomalies"]
    categories = {a["category"] for a in anomalies}
    assert "SYSDIAGNOSE_SHUTDOWN_VOLATILE_PATH" in categories
    assert "SYSDIAGNOSE_SUSPICIOUS_PROCESS" in categories
    assert "IOS_MDM_OR_ROOT_PROFILE" in categories
    assert "IOS_ZEROCLICK_CRASH_INDICATOR" in categories

    # Verify both root CA (CRITICAL) and MDM (HIGH) were flagged
    mdm_anomalies = [a for a in anomalies if a["category"] == "IOS_MDM_OR_ROOT_PROFILE"]
    assert any(a["severity"] == "CRITICAL" and "com.suspicious.rootca" == a["indicator"] for a in mdm_anomalies)
    assert any(a["severity"] == "HIGH" and "com.unknown.mdm" == a["indicator"] for a in mdm_anomalies)


def test_direct_ios_artifact_analyzers_ignore_benign_inputs():
    assert analyze_shutdown_log("normal shutdown /System/Library/CoreServices/SpringBoard") == []
    assert analyze_mobileconfig_profile(b"not a plist") == []
    assert analyze_ips_crash_log("normal crash in Calculator without memory corruption") == []


def test_resolve_portable_tool_prefers_env_bundle_over_system_path(tmp_path: Path, monkeypatch):
    suffix = ".exe" if os.name == "nt" else ""
    adb_dir = tmp_path / "platform-tools"
    adb_dir.mkdir(parents=True)
    fake_adb = adb_dir / f"adb{suffix}"
    fake_adb.write_bytes(b"fake-adb")

    ios_dir = tmp_path / "libimobiledevice"
    ios_dir.mkdir(parents=True)
    fake_idevice = ios_dir / f"idevice_id{suffix}"
    fake_idevice.write_bytes(b"fake-idevice")

    monkeypatch.setenv("OMEGA_PORTABLE_TOOLS_DIR", str(tmp_path))

    resolved_adb = resolve_portable_tool("adb", which_fn=lambda _: "/usr/bin/adb")
    resolved_ios = resolve_portable_tool("idevice_id", which_fn=lambda _: "/usr/bin/idevice_id")

    assert resolved_adb == str(fake_adb)
    assert resolved_ios == str(fake_idevice)


def test_analyze_android_accessibility_and_mdm_flags_third_party_only():
    acc_raw = (
        "com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService:"
        "com.stealth.spy/com.stealth.spy.KeyloggerAccessibilityService"
    )
    policy_raw = (
        "  Device Owner: admin=ComponentInfo{com.google.android.gms/com.google.android.gms.admin.DeviceAdmin}\n"
        "  Profile Owner (user 10): admin=ComponentInfo{com.rogue.mdm/com.rogue.mdm.AdminReceiver}\n"
    )

    anomalies = analyze_android_accessibility_and_mdm(acc_raw, policy_raw)
    categories = [a["category"] for a in anomalies]
    assert categories == ["ANDROID_ABUSIVE_ACCESSIBILITY_SERVICE", "ANDROID_DEVICE_ADMIN_OR_MDM"]
    assert "com.stealth.spy" in anomalies[0]["indicator"]
    assert "com.rogue.mdm" in anomalies[1]["indicator"]


def test_infostealer_shield_flags_unsigned_access_and_allows_signed_browser():
    assert classify_sensitive_target("/home/user/project/.env.example") is None
    assert classify_sensitive_target(r"C:\Users\alice\AppData\Roaming\Docker Desktop\Network\Cookies") is None
    assert classify_sensitive_target("/home/user/project/.env")[0] == "SECRET_ENV_OR_CLOUD_CREDENTIAL"
    assert classify_sensitive_target(r"C:\Users\alice\.ssh\id_ed25519")[0] == "SSH_PRIVATE_KEY"

    unsigned_proc = {
        "pid": 4242,
        "name": "updater_tmp.exe",
        "exe_path": r"C:\Users\alice\AppData\Local\Temp\updater_tmp.exe",
        "open_files": [
            r"C:\Users\alice\AppData\Local\Google\Chrome\User Data\Default\Login Data",
            r"C:\Users\alice\.ssh\id_ed25519",
            r"C:\Users\alice\work\.env",
        ],
        "cmdline": ["updater_tmp.exe"],
        "signature": {"status": "NotSigned", "publisher": ""},
    }
    findings = evaluate_process_for_infostealer(unsigned_proc)
    target_kinds = {f["targetKind"] for f in findings}
    assert target_kinds == {
        "BROWSER_CREDENTIAL_STORE",
        "SSH_PRIVATE_KEY",
        "SECRET_ENV_OR_CLOUD_CREDENTIAL",
    }

    signed_chrome = {
        "pid": 1111,
        "name": "chrome.exe",
        "exe_path": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "open_files": [
            r"C:\Users\alice\AppData\Local\Google\Chrome\User Data\Default\Login Data",
        ],
        "cmdline": ["chrome.exe"],
        "signature": {"status": "Valid", "publisher": "Google LLC"},
    }
    assert evaluate_process_for_infostealer(signed_chrome) == []
