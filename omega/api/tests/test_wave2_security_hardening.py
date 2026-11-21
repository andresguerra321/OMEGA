"""Regression tests for Wave 2 Security Audit Hardening (C-04, C-05, C-06, C-09)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
import socket
import struct
import sys
import threading
import time
import types
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

import local_auth
import local_transport
import main
import usb_device_connector
from schemas import MobileUsbAuditRequest


# ---------------------------------------------------------------------------
# C-04: Windows Named Pipe created once outside loop + DisconnectNamedPipe
# ---------------------------------------------------------------------------
def test_c04_windows_named_pipe_reused_without_close_between_requests(monkeypatch):
    monkeypatch.setenv("OMEGA_SENSOR_USER_SID", "S-1-5-21-100-200-300-1001")
    stop = threading.Event()
    calls: list[str] = []
    connect_count = 0

    class DummyOverlapped:
        def __init__(self):
            self.hEvent = 1

    fake_pywintypes = types.ModuleType("pywintypes")
    fake_pywintypes.OVERLAPPED = DummyOverlapped
    fake_pywintypes.error = OSError
    fake_pywintypes.SECURITY_ATTRIBUTES = lambda: types.SimpleNamespace(SECURITY_DESCRIPTOR=None)

    fake_win32security = types.ModuleType("win32security")
    fake_win32security.ConvertStringSecurityDescriptorToSecurityDescriptor = lambda sddl, rev: sddl

    fake_win32event = types.ModuleType("win32event")
    fake_win32event.CreateEvent = lambda *a: 1
    fake_win32event.WaitForSingleObject = lambda h, ms: 0

    fake_win32pipe = types.ModuleType("win32pipe")

    def fake_create_pipe(*args):
        calls.append("CreateNamedPipe")
        return 777

    def fake_connect_pipe(pipe, overlapped):
        nonlocal connect_count
        connect_count += 1
        calls.append(f"ConnectNamedPipe:{connect_count}")
        if connect_count >= 2:
            stop.set()
        return 0

    def fake_disconnect_pipe(pipe):
        calls.append("DisconnectNamedPipe")

    fake_win32pipe.CreateNamedPipe = fake_create_pipe
    fake_win32pipe.ConnectNamedPipe = fake_connect_pipe
    fake_win32pipe.DisconnectNamedPipe = fake_disconnect_pipe

    fake_win32file = types.ModuleType("win32file")
    fake_win32file.GetOverlappedResult = lambda pipe, ov, wait: 18
    fake_win32file.ReadFile = lambda pipe, size, ov: (0, b'{"bootstrap":true}\n')
    fake_win32file.WriteFile = lambda pipe, data, ov: (0, len(data))
    fake_win32file.CancelIoEx = lambda *a: None
    fake_win32file.CloseHandle = lambda pipe: calls.append("CloseHandle")

    monkeypatch.setitem(sys.modules, "pywintypes", fake_pywintypes)
    monkeypatch.setitem(sys.modules, "win32security", fake_win32security)
    monkeypatch.setitem(sys.modules, "win32event", fake_win32event)
    monkeypatch.setitem(sys.modules, "win32pipe", fake_win32pipe)
    monkeypatch.setitem(sys.modules, "win32file", fake_win32file)
    monkeypatch.setattr(local_transport, "_verify_windows_client_process", lambda pipe: 1234)

    local_transport._windows_server(
        r"\\.\pipe\omega-agent-test-c04",
        lambda raw: b'{"status":200}\n',
        stop,
    )

    assert calls.count("CreateNamedPipe") == 1
    assert calls.count("DisconnectNamedPipe") == 2
    assert calls.count("CloseHandle") == 1
    assert calls[-1] == "CloseHandle"


# ---------------------------------------------------------------------------
# C-05: Atomic single-use bootstrap + peer process verification
# ---------------------------------------------------------------------------
def test_c05_bootstrap_is_atomic_single_use_and_validates_peer(monkeypatch):
    auth = local_auth.LocalAuthenticator()
    monkeypatch.setattr(local_auth, "ACTIVE", auth)
    gate = local_transport.BootstrapGate()

    # Unverified peer is denied even before consuming the gate
    denied = asyncio.run(
        local_transport.dispatch(main.app, b'{"bootstrap": true}\n', service=True, bootstrap_gate=gate, peer_verified=False)
    )
    assert json.loads(denied)["status"] == 403

    # First verified bootstrap succeeds and returns the ephemeral secret
    first = asyncio.run(
        local_transport.dispatch(main.app, b'{"bootstrap": true}\n', service=True, bootstrap_gate=gate, peer_verified=True)
    )
    assert json.loads(first) == {"secret": auth.secret}

    # Any subsequent bootstrap attempt in the same startup is rejected with 403
    second = asyncio.run(
        local_transport.dispatch(main.app, b'{"bootstrap": true}\n', service=True, bootstrap_gate=gate, peer_verified=True)
    )
    assert json.loads(second)["status"] == 403


def test_c05_peer_credential_checks(monkeypatch):
    # Windows client PID check
    monkeypatch.setenv("OMEGA_SENSOR_CLIENT_PID", "4242")
    monkeypatch.setattr(local_transport, "_get_windows_pipe_client_pid", lambda pipe: 4242)
    assert local_transport._verify_windows_client_process(1) == 4242
    monkeypatch.setattr(local_transport, "_get_windows_pipe_client_pid", lambda pipe: 9999)
    with pytest.raises(PermissionError):
        local_transport._verify_windows_client_process(1)

    # POSIX SO_PEERCRED check
    monkeypatch.delenv("OMEGA_SENSOR_CLIENT_PID", raising=False)
    monkeypatch.setenv("OMEGA_SENSOR_UID", "1000")
    monkeypatch.setattr(socket, "SO_PEERCRED", 17, raising=False)

    class FakeConn:
        def __init__(self, pid, uid, gid):
            self._packed = struct.pack("3i", pid, uid, gid)

        def getsockopt(self, level, optname, buflen):
            return self._packed

    assert local_transport._verify_unix_peer_cred(FakeConn(123, 1000, 1000)) == (123, 1000, 1000)
    with pytest.raises(PermissionError):
        local_transport._verify_unix_peer_cred(FakeConn(123, 2000, 2000))


# ---------------------------------------------------------------------------
# C-06: USB device_id validation, connected device check, and endpoint guards
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("bad_id", ["-s", "--version", "abc;rm -rf /", "dev id", "../etc", ""])
def test_c06_rejects_unsafe_usb_device_ids(bad_id):
    with pytest.raises(ValueError):
        usb_device_connector.validate_device_id(bad_id)
    with pytest.raises(Exception):
        MobileUsbAuditRequest(platform="ANDROID", device_id=bad_id)


def test_c06_requires_device_to_be_connected_before_operating(monkeypatch):
    monkeypatch.setattr(
        usb_device_connector,
        "list_connected_devices",
        lambda **kwargs: {"status": "OK", "devices": [{"id": "R58M999999Z", "platform": "ANDROID"}], "tooling": {}},
    )
    with pytest.raises(ValueError, match="no encontrado"):
        usb_device_connector.run_usb_triage(platform="ANDROID", device_id="R58M000000X")


def test_c06_mobile_usb_endpoints_enforce_tenant_and_integrity(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "wave2-token")
    monkeypatch.setenv("OMEGA_HOST_OWNER_TENANT_ID", "tenant-owner-1")
    monkeypatch.setattr(local_auth, "ACTIVE", None)
    monkeypatch.setenv("OMEGA_REQUIRE_HMAC", "false")
    client = TestClient(main.app)

    # Wrong tenant -> 403
    monkeypatch.setattr(main.app.state, "integrity_ok", True, raising=False)
    r_wrong_tenant = client.get(
        "/api/mobile/usb/devices",
        headers={"X-Internal-Service-Token": "wave2-token", "X-Host-Tenant": "other-tenant"},
    )
    assert r_wrong_tenant.status_code == 403

    # Integrity compromised -> 503 even with valid tenant
    main.app.state.integrity_ok = False
    r_bad_integrity = client.get(
        "/api/mobile/usb/devices",
        headers={"X-Internal-Service-Token": "wave2-token", "X-Host-Tenant": "tenant-owner-1"},
    )
    assert r_bad_integrity.status_code == 503

    r_audit_bad_integrity = client.post(
        "/api/mobile/usb/audit",
        headers={"X-Internal-Service-Token": "wave2-token", "X-Host-Tenant": "tenant-owner-1"},
        json={"platform": "ANDROID", "device_id": "R58M999999Z"},
    )
    assert r_audit_bad_integrity.status_code == 503


# ---------------------------------------------------------------------------
# C-09: Bounded body before HMAC (413) + X-Host-Actor & Content-Type binding
# ---------------------------------------------------------------------------
def test_c09_rejects_oversized_body_with_413_before_hmac_verification(monkeypatch):
    auth = local_auth.LocalAuthenticator()
    monkeypatch.setattr(local_auth, "ACTIVE", auth)
    monkeypatch.setenv("OMEGA_MAX_HMAC_BODY_BYTES", "64")
    verify_mock = MagicMock(return_value=True)
    monkeypatch.setattr(auth, "verify", verify_mock)

    client = TestClient(main.app)
    response = client.post("/api/ioc/verify/text", content=b"x" * 128)
    assert response.status_code == 413
    verify_mock.assert_not_called()


def test_c09_hmac_binds_canonical_host_actor_and_content_type_and_matches_java():
    # Fixed zero-key vector shared with Java SensorHmacTest / SecurityAuditWave2HardeningTest
    secret = "00" * 32
    sig_base = local_auth.signature(
        secret,
        "request",
        "POST",
        "/api/containment/execute",
        "1700000000",
        "0123456789abcdef0123456789abcdef",
        b"{}",
        host_actor="actor-42",
        content_type="application/json; charset=utf-8",
    )
    sig_canon = local_auth.signature(
        secret,
        "request",
        "POST",
        "/api/containment/execute",
        "1700000000",
        "0123456789abcdef0123456789abcdef",
        b"{}",
        host_actor="  actor-42  ",
        content_type="APPLICATION/JSON; boundary=xyz",
    )
    assert sig_base == sig_canon

    auth = local_auth.LocalAuthenticator(secret)
    stamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    body = b'{"ok":true}'
    sig = local_auth.signature(
        secret, "request", "POST", "/api/containment/execute", stamp, nonce, body,
        host_actor="actor-1", content_type="application/json",
    )
    headers = {
        "x-omega-time": stamp,
        "x-omega-nonce": nonce,
        "x-omega-signature": sig,
        "x-host-actor": "actor-1",
        "content-type": "application/json; charset=utf-8",
    }
    # Tampering X-Host-Actor or Content-Type must fail verification
    tampered_actor = dict(headers, **{"x-host-actor": "actor-evil"})
    assert not auth.verify("POST", "/api/containment/execute", tampered_actor, body)

    tampered_ct = dict(headers, **{"content-type": "text/plain"})
    assert not auth.verify("POST", "/api/containment/execute", tampered_ct, body)

    # Exact canonical match succeeds
    assert auth.verify("POST", "/api/containment/execute", headers, body)
