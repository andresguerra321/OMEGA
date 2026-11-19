import base64
import hashlib
import io
import json
from pathlib import Path
import secrets
import socket
import sqlite3
import stat
import tarfile
import time
from unittest.mock import patch
import zipfile

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient
import pytest

import evasion_intelligence as evasion
import link_verifier
import local_auth
from local_auth import LocalAuthenticator, signature
import main
from archive_safety import validate_archive
from behavioral_forensics import unpack_forensic_archives_in_ram
from self_integrity import verify_release, inventory, IntegrityError
from sqlite_safety import open_readonly, harden_connection


@pytest.fixture
def release(tmp_path):
    (tmp_path / 'api').mkdir()
    (tmp_path / 'corpus_mvp').mkdir()
    (tmp_path / 'sensor_runtime').mkdir()
    (tmp_path / 'scripts').mkdir()
    (tmp_path / 'api/sensor.py').write_text('SAFE = True')
    (tmp_path / 'corpus_mvp/ioc.stix2').write_text('{"type":"bundle"}')
    (tmp_path / 'sensor_runtime/omega-sensor.exe').write_bytes(b'bundled-runtime')
    (tmp_path / 'scripts/install.ps1').write_bytes(b'trusted-installer')
    key = Ed25519PrivateKey.generate()
    public = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    raw = json.dumps({'version': 1, 'files': inventory(tmp_path)}, sort_keys=True).encode()
    (tmp_path / 'integrity-manifest.json').write_bytes(raw)
    (tmp_path / 'integrity-manifest.sig').write_bytes(base64.b64encode(key.sign(raw)))
    return tmp_path, public


@pytest.mark.parametrize('filename', ['api/sensor.py', 'corpus_mvp/ioc.stix2', 'sensor_runtime/omega-sensor.exe', 'scripts/install.ps1'])
@pytest.mark.parametrize('operation', ['modify', 'delete'])
def test_integrity_detects_tampering_and_missing_files(release, filename, operation):
    root, public = release
    verify_release(root, public_key=public, search_paths=[])
    path = root / filename
    path.unlink() if operation == 'delete' else path.write_bytes(b'tampered')
    with pytest.raises(IntegrityError):
        verify_release(root, public_key=public, search_paths=[])


def test_integrity_rejects_injection_forged_manifest_and_pth(release, tmp_path):
    root, public = release
    (root / 'api/injected.py').write_text('import os')
    with pytest.raises(IntegrityError): verify_release(root, public_key=public, search_paths=[])
    (root / 'api/injected.py').unlink()
    (root / 'evil.pth').write_text('import evil')
    with pytest.raises(IntegrityError, match='pth'): verify_release(root, public_key=public, search_paths=[root])
    (root / 'evil.pth').unlink()
    manifest = root / 'integrity-manifest.json'
    manifest.write_bytes(manifest.read_bytes() + b' ')
    with pytest.raises(IntegrityError): verify_release(root, public_key=public, search_paths=[])


def test_fastapi_native_startup_fails_before_watcher_on_invalid_release(monkeypatch):
    monkeypatch.setenv('OMEGA_NATIVE_SENSOR', '1')
    monkeypatch.setattr(main, 'verify_release', lambda _: (_ for _ in ()).throw(IntegrityError('tampered')))
    with patch.object(main.watcher, 'start') as watcher:
        with pytest.raises(IntegrityError):
            with TestClient(main.app): pass
        watcher.assert_not_called()


def signed_headers(auth, method='GET', target='/api/health', body=b''):
    stamp, nonce = str(int(time.time())), secrets.token_hex(16)
    return {'x-omega-time': stamp, 'x-omega-nonce': nonce,
            'x-omega-signature': signature(auth.secret, 'request', method, target, stamp, nonce, body)}


def test_sensor_requires_ephemeral_hmac_and_signs_response_rejecting_replay(monkeypatch):
    auth = LocalAuthenticator()
    monkeypatch.setattr(local_auth, 'ACTIVE', auth)
    client = TestClient(main.app)
    assert client.get('/api/health').status_code == 401
    headers = signed_headers(auth)
    response = client.get('/api/health', headers=headers)
    assert response.status_code == 200
    assert response.headers['x-omega-signature'] == signature(auth.secret, 'response', '200', '/api/health',
                                                           headers['x-omega-time'], headers['x-omega-nonce'], response.content)
    assert client.get('/api/health', headers=headers).status_code == 401
    headers = signed_headers(LocalAuthenticator())
    assert client.get('/api/health', headers=headers).status_code == 401


def test_hmac_binds_body_method_target_and_expiration():
    auth = LocalAuthenticator()
    headers = signed_headers(auth, 'POST', '/api/example', b'{}')
    assert not auth.verify('POST', '/api/example', headers, b'{"execute":true}')
    assert not auth.verify('GET', '/api/example', headers, b'{}')
    assert not auth.verify('POST', '/api/other', headers, b'{}')
    headers['x-omega-time'] = str(int(time.time()) - 60)
    assert not auth.verify('POST', '/api/example', headers, b'{}')


def test_docker_fallback_requires_and_returns_hmac(monkeypatch):
    monkeypatch.setenv('OMEGA_REQUIRE_HMAC', 'true')
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', 'test-docker-key')
    auth = LocalAuthenticator(hashlib.sha256(b'test-docker-key').hexdigest())
    client = TestClient(main.app)
    assert client.get('/api/health', headers={'X-Internal-Service-Token': 'test-docker-key'}).status_code == 401
    assert client.get('/api/health', headers=signed_headers(auth)).status_code == 200


def test_invalid_integrity_blocks_privileged_actions_even_with_valid_credentials(monkeypatch):
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', 'test-key')
    monkeypatch.setenv('OMEGA_HOST_OWNER_TENANT_ID', 'owner')
    monkeypatch.setattr(main.app.state, 'integrity_ok', False, raising=False)
    client = TestClient(main.app)
    headers = {'X-Internal-Service-Token': 'test-key', 'X-Host-Tenant': 'owner'}
    with patch.object(main.containment_engine, 'rollback_containment') as rollback:
        assert client.post('/api/containment/rollback/test', headers=headers).status_code == 503
        rollback.assert_not_called()
    with patch.object(main.watcher, 'toggle') as toggle:
        assert client.post('/api/host/realtime/toggle', headers=headers, json={'enabled': True}).status_code == 503
        toggle.assert_not_called()


@pytest.mark.parametrize('address', ['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1', 'ff02::1', '::ffff:127.0.0.1'])
def test_link_fetch_rejects_non_global_addresses(monkeypatch, address):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args: [(2, 1, 6, '', (address, 443))])
    with patch.object(socket, 'socket') as connect:
        with pytest.raises(ValueError):
            link_verifier.safe_http_get('https://example.com', 'test')
        connect.assert_not_called()


def test_dns_rebinding_never_performs_a_second_lookup_and_preserves_sni(monkeypatch):
    calls, peers, sni = [], [], []
    def dns(*args):
        calls.append(args)
        return [(2, 1, 6, '', ('93.184.216.34' if len(calls) == 1 else '127.0.0.1', 443))]
    monkeypatch.setattr(socket, 'getaddrinfo', dns)
    class Socket:
        def settimeout(self, value): pass
        def connect(self, peer): peers.append(peer)
        def close(self): pass
    monkeypatch.setattr(socket, 'socket', lambda *args: Socket())
    address = link_verifier.resolve_public('example.com', 443)
    conn = evasion.PinnedHTTPSConnection('example.com', address, 443, 1)
    class TLS:
        def wrap_socket(self, raw, server_hostname): sni.append(server_hostname); return raw
    conn._context = TLS()
    conn.connect()
    assert len(calls) == 1
    assert peers == [('93.184.216.34', 443)]
    assert sni == ['example.com']


def zip_payload(name='history.json', data=b'{}', mode=0):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        item = zipfile.ZipInfo(name)
        item.compress_type = zipfile.ZIP_DEFLATED
        item.external_attr = mode << 16
        archive.writestr(item, data)
    return stream.getvalue()


@pytest.mark.parametrize('name', ['../history.json', '/etc/history.json', 'a/../history.json', 'C:\\history.json', 'a/' * 17 + 'history.json'])
def test_archive_rejects_zip_slip_before_any_extraction(name):
    raw = zip_payload(name)
    with pytest.raises(ValueError):
        unpack_forensic_archives_in_ram([{'filename': 'test.zip', 'bytes': raw}])


def test_archive_rejects_bombs_and_symlinks():
    with pytest.raises(ValueError, match='compresión'):
        validate_archive('bomb.zip', zip_payload(data=b'0' * 1_000_000))
    with pytest.raises(ValueError, match='enlace'):
        validate_archive('link.zip', zip_payload(mode=stat.S_IFLNK | 0o777, data=b'/etc/passwd'))
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        item = tarfile.TarInfo('history.json')
        item.type = tarfile.SYMTYPE
        item.linkname = '/etc/passwd'
        archive.addfile(item)
    with pytest.raises(ValueError, match='enlace'):
        validate_archive('link.tar.gz', stream.getvalue())
    assert unpack_forensic_archives_in_ram([{'filename': 'safe.zip', 'bytes': zip_payload()}])[0]['bytes'] == b'{}'


def test_archive_api_returns_bad_request_instead_of_internal_error(monkeypatch):
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', 'test-key')
    response = TestClient(main.app).post('/api/triage/parallel', headers={'X-Internal-Service-Token': 'test-key'},
        files={'files': ('evil.zip', zip_payload('../history.json'), 'application/zip')})
    assert response.status_code == 400


def test_sqlite_external_is_readonly_extensions_disabled_and_queries_bounded(tmp_path):
    path = tmp_path / 'evidence.db'
    conn = sqlite3.connect(path)
    conn.execute('create table evidence (value)')
    conn.commit()
    conn.close()
    with open_readonly(path) as evidence:
        with pytest.raises(sqlite3.OperationalError): evidence.execute('insert into evidence values (1)')
        with pytest.raises(sqlite3.OperationalError, match='not authorized'): evidence.load_extension('evil')
        harden_connection(evidence, instruction_limit=1000)
        with pytest.raises(sqlite3.OperationalError, match='interrupt'):
            evidence.execute('WITH RECURSIVE t(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM t) SELECT sum(x) FROM t').fetchone()


def test_windows_pipe_acl_requires_an_explicit_user_sid():
    from local_transport import windows_pipe_security
    with pytest.raises(ValueError): windows_pipe_security('Everyone')


def test_native_pipe_roundtrip_uses_real_acl_and_node_client(monkeypatch):
    import asyncio
    import os
    import subprocess
    import sys
    import threading
    if sys.platform != 'win32':
        pytest.skip('Windows named-pipe integration; Unix socket has a separate test')
    pytest.importorskip('win32pipe')
    import win32security
    import win32api
    from local_transport import _windows_server, dispatch
    token = win32security.OpenProcessToken(win32api.GetCurrentProcess(), 8)
    sid = win32security.ConvertSidToStringSid(win32security.GetTokenInformation(token, win32security.TokenUser)[0])
    monkeypatch.setenv('OMEGA_SENSOR_USER_SID', sid)
    monkeypatch.setattr(local_auth, 'ACTIVE', LocalAuthenticator())
    endpoint = r'\\.\pipe\omega-agent-' + secrets.token_hex(16)
    stop = threading.Event()
    errors = []
    def server():
        try: _windows_server(endpoint, lambda raw: asyncio.run(dispatch(main.app, raw, True)), stop)
        except Exception as exc: errors.append(exc)
    worker = threading.Thread(target=server, daemon=True)
    worker.start()
    script = '''const net = await import('node:net');
const rpc = (msg) => new Promise((resolve, reject) => {
  const s = net.connect(process.argv[1]);
  let buf = '';
  s.once('error', reject);
  s.once('connect', () => s.write(JSON.stringify(msg) + '\\n'));
  s.on('data', (c) => {
    buf += c.toString('utf8');
    const nl = buf.indexOf('\\n');
    if (nl !== -1) { s.end(); resolve(JSON.parse(buf.slice(0, nl))); }
  });
});
let healthResp;
for (let i = 0; i < 30; i++) {
  try {
    healthResp = await rpc({ method: 'GET', target: '/api/health', headers: {}, body: '' });
    break;
  } catch (e) {
    if (i === 29) throw e;
    await new Promise((r) => setTimeout(r, 50));
  }
}
const health = JSON.parse(Buffer.from(healthResp.body, 'base64').toString('utf8'));
if (healthResp.status !== 200 || health.service !== 'omega-forensic-worker') process.exit(1);'''
    try:
        result = subprocess.run(['node', '--input-type=module', '-e', script, endpoint], capture_output=True, text=True, timeout=20)
        assert result.returncode == 0, result.stderr
        assert not errors
    finally:
        stop.set()
        worker.join(timeout=3)
