"""Containment tests only use temporary evidence and mocked OS mutators."""
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import uuid

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import containment_engine as containment
import evasion_intelligence as evasion
import link_verifier
import main


def result(stdout='', code=0, stderr=''):
    return SimpleNamespace(stdout=stdout, returncode=code, stderr=stderr)


@pytest.fixture
def engine(tmp_path, monkeypatch):
    monkeypatch.setenv('OMEGA_CONTAINMENT_ENABLED', 'true')
    monkeypatch.setattr(containment, 'host_scope', lambda: 'native-host')
    service = containment.ContainmentEngine(tmp_path / 'vault', key_provider=lambda _: b'k' * 32)
    monkeypatch.setattr(service, '_prepare_root', lambda: service.root.mkdir(parents=True, exist_ok=True))
    return service


@pytest.mark.parametrize('indicator', ['127.1.2.3', '::1', '10.1.2.3', '172.16.0.1', '192.168.1.2', '169.254.169.254', '224.0.0.1', '0.0.0.0', '::ffff:192.168.1.2', '100.64.0.1'])
def test_protected_networks_never_reach_firewall(engine, monkeypatch, indicator):
    monkeypatch.setattr(containment, 'protected_addresses', lambda: set())
    with pytest.raises(ValueError):
        engine.execute_containment('BLOCK_NETWORK_INDICATOR', {'indicator': indicator}, owner='tenant')
    assert not engine.root.exists()


def test_dns_and_omega_server_addresses_are_protected(engine, monkeypatch):
    monkeypatch.setattr(containment, 'protected_addresses', lambda: {'8.8.8.8', '93.184.216.34'})
    for value in ('8.8.8.8', '93.184.216.34'):
        with pytest.raises(ValueError, match='DNS'):
            engine.execute_containment('BLOCK_NETWORK_INDICATOR', {'indicator': value}, owner='tenant')


def test_container_rejects_quarantine_and_rollback_before_touching_the_vault(tmp_path, monkeypatch):
    monkeypatch.setattr(containment, 'host_scope', lambda: 'container')
    monkeypatch.setenv('OMEGA_CONTAINMENT_ENABLED', 'true')
    service = containment.ContainmentEngine(tmp_path / 'vault',
        key_provider=lambda _: pytest.fail('Container must not access quarantine keys'))
    monkeypatch.setattr(service, '_prepare_root', lambda: pytest.fail('Container must not create a vault'))
    monkeypatch.setattr(service, '_read_record', lambda *args: pytest.fail('Container must not read recovery journals'))
    with pytest.raises(ValueError, match='sensor nativo'):
        service.execute_containment('QUARANTINE_PERSISTENCE_ITEM', {}, owner='tenant')
    with pytest.raises(ValueError, match='equipo nativo'):
        service.rollback_containment(str(uuid.uuid4()), owner='tenant')
    assert not service.root.exists()


@pytest.mark.parametrize('name', ['System', 'csrss.exe', 'lsass.exe', 'wininit.exe', 'svchost.exe', 'launchd', 'WindowServer', 'kernel_task', 'systemd', 'init', 'sshd'])
def test_critical_process_is_never_suspended(engine, monkeypatch, name):
    class Process:
        pid = 12345
        def parents(self): return []
        def children(self, recursive=False): return []
        def name(self): return name
    monkeypatch.setattr(containment.psutil, 'Process', lambda *args: Process())
    with pytest.raises(ValueError, match='críticos'):
        engine.execute_containment('SUSPEND_OR_TERMINATE_PROCESS', {'pid': 555, 'createTime': 1, 'sha256': '0' * 64}, owner='tenant')


def test_termination_is_rejected_as_irreversible(engine):
    with pytest.raises(ValueError, match='reversible'):
        engine.execute_containment('SUSPEND_OR_TERMINATE_PROCESS', {'pid': 100, 'mode': 'terminate'}, owner='tenant')


def test_capture_rejects_a_different_file_identity(tmp_path):
    source = tmp_path / 'evidence.bin'
    source.write_bytes(b'keep this evidence')
    with pytest.raises(ValueError, match='identidad'):
        with containment._locked_evidence(source, {'fileMetadata': {'fileId': source.stat().st_ino + 1}}):
            pytest.fail('A replaced object must never be accepted')
    assert source.read_bytes() == b'keep this evidence'


def test_capture_never_removes_a_replaced_path(tmp_path):
    source = tmp_path / 'evidence.bin'
    source.write_bytes(b'original')
    saved = tmp_path / 'saved.bin'
    with containment._locked_evidence(source, {'fileMetadata': {'fileId': source.stat().st_ino}}) as (stream, remove):
        assert stream.read() == b'original'
        if sys.platform == 'win32':
            # The open handle denies writes, renames and deletions by other handles.
            with pytest.raises(OSError):
                source.rename(saved)
            with pytest.raises(OSError):
                source.write_bytes(b'replacement')
        else:
            source.rename(saved)
            source.write_bytes(b'replacement')
            with pytest.raises(ValueError, match='sustituido'):
                remove()
    assert source.read_bytes() == (b'original' if sys.platform == 'win32' else b'replacement')
    if sys.platform != 'win32':
        assert saved.read_bytes() == b'original'
        unsafe = tmp_path / 'shared'
        unsafe.mkdir(mode=0o777)
        unsafe.chmod(0o777)
        (unsafe / 'item').write_bytes(b'keep')
        with pytest.raises(ValueError, match='otra cuenta'):
            with containment._locked_evidence(unsafe / 'item', {}):
                pytest.fail('A writable shared directory must not be accepted')


def test_process_identity_is_rechecked_and_pid_reuse_prevents_resume(engine, tmp_path, monkeypatch):
    binary = tmp_path / 'fixture.exe'
    binary.write_bytes(b'fixture executable')
    state = {'started': 12.5, 'suspends': 0, 'resumes': 0}
    class Process:
        pid = 55555
        def parents(self): return []
        def children(self, recursive=False): return []
        def name(self): return 'fixture.exe'
        def exe(self): return str(binary)
        def create_time(self): return state['started']
        def status(self): return 'sleeping'
        def suspend(self): state['suspends'] += 1
        def resume(self): state['resumes'] += 1
    monkeypatch.setattr(containment.psutil, 'Process', lambda *args: Process())
    target = {'pid': 55555, 'createTime': 12.5, 'sha256': hashlib.sha256(binary.read_bytes()).hexdigest()}
    plan = engine.execute_containment('SUSPEND_OR_TERMINATE_PROCESS', target, owner='tenant')
    applied = engine.execute_containment('SUSPEND_OR_TERMINATE_PROCESS', target, owner='tenant', dry_run=False, preview_token=plan['previewToken'])
    assert applied['status'] == 'ACTIVE'
    assert state['suspends'] == 1
    state['started'] = 99.9
    response = engine.rollback_containment(applied['actionId'], owner='tenant')
    assert response['status'] == 'RECOVERY_REQUIRED'
    assert state['resumes'] == 0
    with pytest.raises(ValueError):
        engine._process_target({**target, 'createTime': float('nan')})


def test_rollback_never_overwrites_new_file(engine, tmp_path, monkeypatch):
    source = tmp_path / 'evidence.bin'
    source.write_bytes(b'original')
    target = {'originalPath': str(source), 'sha256': hashlib.sha256(b'original').hexdigest(), 'mode': 0o600,
              'mtimeNs': source.stat().st_mtime_ns, 'entry': {'persistenceType': 'Run'}, 'persistence': {}}
    monkeypatch.setattr(engine, '_persistence_target', lambda _: target)
    monkeypatch.setattr(engine, '_set_persistence', lambda *a, **kw: None)
    preview = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', {}, owner='tenant')
    applied = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', {}, owner='tenant', dry_run=False, preview_token=preview['previewToken'])
    source.write_bytes(b'new file created by another actor')
    assert engine.rollback_containment(applied['actionId'], owner='tenant')['status'] == 'RECOVERY_REQUIRED'
    assert source.read_bytes() == b'new file created by another actor'


def test_dry_run_and_preview_binding_do_not_mutate_firewall(engine, monkeypatch):
    monkeypatch.setattr(containment, 'protected_addresses', lambda: set())
    calls = []
    engine.firewall = containment.NativeFirewall('win32', runner=lambda args, **kw: calls.append(args) or result())
    target = {'indicator': '93.184.216.34'}
    preview = engine.execute_containment('BLOCK_NETWORK_INDICATOR', target, owner='tenant')
    assert preview['status'] == 'PREVIEW'
    assert calls == []
    assert not engine.root.exists()
    with pytest.raises(ValueError, match='Previsualiza'):
        engine.execute_containment('BLOCK_NETWORK_INDICATOR', {'indicator': '1.1.1.1'}, owner='tenant', dry_run=False, preview_token=preview['previewToken'])
    applied = engine.execute_containment('BLOCK_NETWORK_INDICATOR', target, owner='tenant', dry_run=False, preview_token=preview['previewToken'])
    assert applied['status'] == 'ACTIVE'
    assert len(calls) == 2
    assert all('OMEGA_SHIELD_' in ' '.join(args) for args in calls)


def test_quarantine_aes_gcm_and_rollback_restore_identical_hash(engine, tmp_path, monkeypatch):
    source = tmp_path / 'evidence.bin'
    original = b'forensic evidence\x00\xff' * 100
    source.write_bytes(original)
    digest = hashlib.sha256(original).hexdigest()
    native = {'originalPath': str(source), 'sha256': digest, 'mode': 0o600, 'mtimeNs': source.stat().st_mtime_ns,
              'entry': {'persistenceType': 'Run', 'location': 'HKCU/Run/Test'}, 'persistence': {}}
    monkeypatch.setattr(engine, '_persistence_target', lambda _: native)
    startup = []
    monkeypatch.setattr(engine, '_set_persistence', lambda target, restore: startup.append(restore))
    request = {'location': 'HKCU/Run/Test', 'sha256': digest}
    preview = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', request, owner='tenant')
    applied = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', request, owner='tenant', dry_run=False, preview_token=preview['previewToken'])
    assert applied['status'] == 'ACTIVE'
    assert not source.exists()
    sealed = (engine.root / (applied['actionId'] + '.quar')).read_bytes()
    assert original not in sealed
    assert startup == [False]
    # A new engine/process can authenticate the journal using the OS-held key.
    reopened = containment.ContainmentEngine(engine.root, key_provider=lambda _: b'k' * 32)
    monkeypatch.setattr(reopened, '_prepare_root', lambda: None)
    monkeypatch.setattr(reopened, '_set_persistence', lambda target, restore: startup.append(restore))
    restored = reopened.rollback_containment(applied['actionId'], owner='tenant')
    assert restored['status'] == 'ROLLED_BACK'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    assert startup == [False, True]
    assert (engine.root / (applied['actionId'] + '.quar')).exists()


def test_partial_failure_compensates_and_preserves_original(engine, tmp_path, monkeypatch):
    source = tmp_path / 'evidence.bin'
    source.write_bytes(b'evidence')
    target = {'originalPath': str(source), 'sha256': hashlib.sha256(b'evidence').hexdigest(), 'mode': 0o600,
              'mtimeNs': source.stat().st_mtime_ns, 'entry': {'persistenceType': 'Run'}, 'persistence': {}}
    monkeypatch.setattr(engine, '_persistence_target', lambda _: target)
    def set_persistence(_, restore):
        if not restore: raise PermissionError('fixture')
    monkeypatch.setattr(engine, '_set_persistence', set_persistence)
    preview = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', {}, owner='tenant')
    response = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', {}, owner='tenant', dry_run=False, preview_token=preview['previewToken'])
    assert response['status'] == 'ROLLED_BACK'
    assert response['result'] == 'FAILED_COMPENSATED'
    assert source.read_bytes() == b'evidence'


def test_tampered_ciphertext_never_restores_or_enables_startup(engine, tmp_path, monkeypatch):
    source = tmp_path / 'evidence.bin'
    source.write_bytes(b'fixture')
    target = {'originalPath': str(source), 'sha256': hashlib.sha256(b'fixture').hexdigest(), 'mode': 0o600,
              'mtimeNs': source.stat().st_mtime_ns, 'entry': {'persistenceType': 'Run'}, 'persistence': {}}
    monkeypatch.setattr(engine, '_persistence_target', lambda _: target)
    changes = []
    monkeypatch.setattr(engine, '_set_persistence', lambda _, restore: changes.append(restore))
    preview = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', {}, owner='tenant')
    response = engine.execute_containment('QUARANTINE_PERSISTENCE_ITEM', {}, owner='tenant', dry_run=False, preview_token=preview['previewToken'])
    path = engine.root / (response['actionId'] + '.quar')
    sealed = bytearray(path.read_bytes()); sealed[-1] ^= 1; path.write_bytes(sealed)
    assert engine.rollback_containment(response['actionId'], owner='tenant')['status'] == 'RECOVERY_REQUIRED'
    assert not source.exists()
    assert changes == [False]


@pytest.mark.parametrize('platform,backend', [('win32', 'netsh'), ('linux', 'nft'), ('darwin', 'pfctl')])
def test_native_firewall_dispatch_is_simulated(tmp_path, monkeypatch, platform, backend):
    calls = []
    def runner(args, **kwargs):
        calls.append((args, kwargs))
        return result('Status: Enabled')
    firewall = containment.NativeFirewall(platform, runner, anchor_file=tmp_path / 'com.omega.shield')
    plan = {'backend': backend, 'prefix': 'OMEGA_SHIELD_test', 'addresses': ['93.184.216.34'], 'anchor': 'com.omega.shield/test', 'chain': 'omega_test'}
    firewall.apply(plan)
    assert calls
    assert all(call[0][0] == backend for call in calls)
    if backend == 'nft':
        assert 'drop' in calls[-1][1]['input_text']
        assert 'flush ruleset' not in calls[-1][1]['input_text']


def test_no_plaintext_key_backend_is_allowed(monkeypatch):
    import keyring
    monkeypatch.setattr(keyring, 'get_keyring', lambda: SimpleNamespace())
    with pytest.raises(RuntimeError, match='almacén seguro'):
        containment.secure_os_key('fixture')


def test_fresh_domain_and_cloaking_are_explainable(monkeypatch):
    monkeypatch.setattr(evasion, 'passive_infrastructure', lambda _: {'domainAgeDays': 4, 'freshTlsCertificate': True, 'limitations': []})
    calls = []
    def response(url, ua):
        calls.append(ua)
        mobile = 'iPhone' in ua
        return {'status': 200 if mobile else 403, 'chain': [{'host': 'example.com', 'status': 200 if mobile else 403}],
                'size': 12000 if mobile else 100, 'truncated': False, 'finalHost': 'example.com'}
    monkeypatch.setattr(evasion, 'safe_http_get', response)
    info = evasion.inspect_evasion('https://example.com', 'example.com', active_probe=True)
    assert info['domainAgeDays'] == 4
    assert info['cloakingDetected'] is True
    assert info['evasionRiskScore'] == 85
    assert info['riskLevel'] == 'HIGH'
    assert len(calls) == 2
    assert any('4 día' in reason for reason in info['evasionReasons'])


def test_passive_mode_never_contacts_suspect_and_unknown_is_not_safe(monkeypatch):
    monkeypatch.setattr(evasion, 'passive_infrastructure', lambda _: {'domainAgeDays': None, 'freshTlsCertificate': None, 'limitations': ['RDAP offline']})
    monkeypatch.setattr(evasion, 'safe_http_get', lambda *a, **kw: pytest.fail('Unexpected active request'))
    info = evasion.inspect_evasion('https://example.com', 'example.com')
    assert info['cloakingDetected'] is None
    assert not info['activeProbePerformed']
    assert info['limitations'] == ['RDAP offline']


def test_rdap_registration_and_certificate_timestamp_are_parsed(monkeypatch):
    from datetime import datetime, timedelta, timezone
    evasion._CACHE.clear()
    date = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    monkeypatch.setattr(evasion, '_json_lookup', lambda url: {'events': [{'eventAction': 'registration', 'eventDate': date}]} if 'rdap.org' in url else [{'not_before': date}])
    info = evasion.passive_infrastructure('login.example.co.uk')
    assert info['rdapDomain'] == 'example.co.uk'
    assert info['domainAgeDays'] == 4
    assert info['freshTlsCertificate'] is True


def test_active_probe_rejects_private_and_dns_rebinding(monkeypatch):
    monkeypatch.setattr(evasion.socket, 'getaddrinfo', lambda *args: [(2, 1, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(ValueError, match='privados'):
        evasion.safe_http_get('https://example.com', 'fixture')


def test_deadline_response_reader_parses_bounded_http_and_stops_after_budget():
    import io
    import time
    import http.client
    class Socket:
        def __init__(self): self.stream = io.BytesIO(b'HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello')
        def makefile(self, *a, **kw): return self.stream
        def settimeout(self, timeout): assert timeout > 0
    response = http.client.HTTPResponse(evasion._DeadlineSocket(Socket(), time.monotonic() + 2))
    response.begin()
    assert response.read() == b'hello'
    reader = evasion._DeadlineReader(io.BytesIO(b'x'), Socket(), time.monotonic() - 1)
    with pytest.raises(TimeoutError):
        reader.readinto(bytearray(1))


def test_redirect_to_private_host_is_revalidated_before_second_connection(monkeypatch):
    calls = []
    def resolve(host, port, *args):
        return [(2, 1, 6, '', ('127.0.0.1' if host == '127.0.0.1' else '93.184.216.34', port))]
    monkeypatch.setattr(evasion.socket, 'getaddrinfo', resolve)
    class Connection:
        def __init__(self, *a, **kw): calls.append(a)
        def connect(self): self.sock = SimpleNamespace(close=lambda: None)
        def request(self, *a, **kw): pass
        def getresponse(self): return SimpleNamespace(status=302, getheader=lambda _: 'http://127.0.0.1/admin')
        def close(self): pass
    monkeypatch.setattr(evasion, 'PinnedHTTPConnection', Connection)
    with pytest.raises(ValueError, match='privados'):
        evasion.safe_http_get('http://example.com', 'fixture')
    assert len(calls) == 1


def test_windows_security_scripts_parse_without_mutating_the_host():
    if sys.platform != 'win32':
        pytest.skip('Windows PowerShell parser')
    import base64
    from host_runtime import powershell
    scripts = []
    for method in (containment.ContainmentEngine._prepare_root, containment.ContainmentEngine._file_metadata, containment.ContainmentEngine._restore_file_metadata):
        scripts.extend(value for value in method.__code__.co_consts if isinstance(value, str) and value.startswith('$ErrorActionPreference'))
    assert len(scripts) == 3
    for script in scripts:
        encoded = base64.b64encode(script.encode()).decode()
        parsed = powershell("$ErrorActionPreference='Stop'; [ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))) | Out-Null")
        assert parsed.returncode == 0, parsed.stderr


def test_new_infrastructure_can_raise_link_risk_without_stix(monkeypatch):
    monkeypatch.setattr(link_verifier, 'lookup_iocs_detailed', lambda _: [])
    monkeypatch.setattr(link_verifier, '_passive_cert_count', lambda _: 5)
    monkeypatch.setattr(link_verifier, '_passive_vt_url_check', lambda *_: [])
    monkeypatch.setattr(link_verifier, 'inspect_evasion', lambda *a, **kw: {'domainAgeDays': 4, 'freshTlsCertificate': True,
        'cloakingDetected': True, 'evasionRiskScore': 85, 'evasionReasons': ['fixture'], 'riskLevel': 'HIGH'})
    response = link_verifier.inspect_suspicious_link('https://example.com', active_probe=True)
    assert response['risk_level'] == 'HIGH'
    assert response['evasionRiskScore'] == 85


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'https://invalid host.com', 'https://[broken'])
def test_infrastructure_api_rejects_malformed_urls_without_server_error(monkeypatch, url):
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', 'fixture-token')
    client = TestClient(main.app)
    response = client.post('/api/link/infrastructure', json={'url': url}, headers={'X-Internal-Service-Token': 'fixture-token'})
    assert response.status_code == 400


def test_containment_api_requires_internal_token_and_owner_tenant(monkeypatch):
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', 'fixture-token')
    monkeypatch.setenv('OMEGA_HOST_OWNER_TENANT_ID', 'owner')
    client = TestClient(main.app)
    assert client.get('/api/containment/history').status_code == 401
    assert client.get('/api/containment/history', headers={'X-Internal-Service-Token': 'fixture-token', 'X-Host-Tenant': 'other'}).status_code == 403
    monkeypatch.setattr(main.containment_engine, 'history', lambda owner: [])
    assert client.get('/api/containment/history', headers={'X-Internal-Service-Token': 'fixture-token', 'X-Host-Tenant': 'owner'}).json() == {'actions': []}
