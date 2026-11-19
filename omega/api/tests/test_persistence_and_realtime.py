"""Real parsers and contracts exercised with synthetic OS artifacts, never live threats."""
import json
import os
from pathlib import Path
import plistlib
import sys
from types import SimpleNamespace
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_forensics as host
import persistence_auditor as persistence
import realtime_watcher as realtime
import main


def result(stdout='', code=0, stderr=''):
    return SimpleNamespace(stdout=stdout, returncode=code, stderr=stderr)


@pytest.fixture(autouse=True)
def no_live_commands(monkeypatch):
    monkeypatch.setattr(persistence, 'prime_windows_signature_cache', lambda _: None)
    host._SIGNATURE_CACHE.clear()


def test_authenticode_cache_and_file_change(tmp_path, monkeypatch):
    binary = tmp_path / 'unsigned.exe'
    binary.write_bytes(b'first')
    monkeypatch.setattr(host.sys, 'platform', 'win32')
    calls = []
    def verify(script, **kwargs):
        calls.append(kwargs['env']['OMEGA_VERIFY_PATH'])
        assert '-LiteralPath' in script
        return result(json.dumps({'status': 'NotSigned', 'publisher': ''}))
    monkeypatch.setattr(host, 'powershell', verify)
    assert host.verify_binary_signature(str(binary))['status'] == 'Unsigned'
    assert host.verify_binary_signature(str(binary))['status'] == 'Unsigned'
    assert len(calls) == 1
    binary.write_bytes(b'changed length')
    host.verify_binary_signature(str(binary))
    assert len(calls) == 2


@pytest.mark.parametrize('native,state', [('HashMismatch', 'Tampered'), ('UnknownError', 'Unknown'), ('Valid', 'Valid')])
def test_authenticode_states(tmp_path, monkeypatch, native, state):
    binary = tmp_path / 'app.exe'
    binary.write_bytes(b'file')
    monkeypatch.setattr(host.sys, 'platform', 'win32')
    monkeypatch.setattr(host, 'powershell', lambda *a, **k: result(json.dumps({'status': native, 'publisher': 'CN=Vendor'})))
    assert host.verify_binary_signature(str(binary))['status'] == state


def test_codesign_authority_and_team(tmp_path, monkeypatch):
    binary = tmp_path / 'app'
    binary.write_bytes(b'file')
    monkeypatch.setattr(host.sys, 'platform', 'darwin')
    monkeypatch.setattr(host, 'run_command', lambda args: result(stderr='Authority=Software Signing\nAuthority=Apple Root CA\nTeamIdentifier=APPLE\n'))
    signature = host.verify_binary_signature(str(binary))
    assert signature['status'] == 'Valid'
    assert signature['teamIdentifier'] == 'APPLE'
    assert 'Apple Root CA' in signature['publisher']


def test_dpkg_checks_exact_file_not_unrelated_package_file(tmp_path, monkeypatch):
    binary = tmp_path / 'sshd'
    binary.write_bytes(b'file')
    monkeypatch.setattr(host.sys, 'platform', 'linux')
    import shutil
    monkeypatch.setattr(shutil, 'which', lambda _: '/usr/bin/dpkg-query')
    def command(args):
        if args[1] == '-S':
            return result(f'openssh-server: {binary}\n')
        if args[1] == '-V':
            return result('??5?????? /etc/ssh/sshd_config\n', 1)
        return result(f'abcdef {str(binary).lstrip("/")}\n')
    monkeypatch.setattr(host, 'run_command', command)
    assert host.verify_binary_signature(str(binary))['status'] == 'Valid'
    assert host.verify_binary_signature('/usr/sbin/sshd (deleted)')['status'] == 'Deleted'


def test_masquerading_and_unknown_signature_are_distinct():
    fake = {'pid': 10, 'name': 'svchost.exe', 'exe_path': 'C:/Temp/svchost.exe', 'signature': {'status': 'Unsigned', 'publisher': ''}}
    findings = host.inspect_process_identity(fake, 'win32')
    assert findings[0]['severity'] == 'CRITICAL'
    actual = {**fake, 'exe_path': os.environ.get('SystemRoot', 'C:/Windows') + '/System32/svchost.exe', 'signature': {'status': 'Unknown', 'publisher': ''}}
    assert not host.inspect_process_identity(actual, 'win32')
    linux = {'pid': 1, 'name': 'systemd', 'exe_path': '/tmp/systemd', 'signature': {'status': 'Unmanaged', 'publisher': ''},
             'privileged': True, 'environment': {'LD_PRELOAD': '/tmp/load.so'}, 'modules': ['/dev/shm/inject.so']}
    categories = {f['category'] for f in host.inspect_process_identity(linux, 'linux')}
    assert categories == {'HOST_SYSTEM_BINARY_MASQUERADE', 'HOST_VOLATILE_EXECUTABLE', 'HOST_LIBRARY_INJECTION'}
    mac = {'pid': 1, 'name': 'launchd', 'exe_path': '/sbin/launchd',
           'signature': {'status': 'Valid', 'publisher': 'Developer ID; Apple Root CA', 'osVendorVerified': False}}
    assert host.inspect_process_identity(mac, 'darwin')[0]['severity'] == 'CRITICAL'
    linux = {'pid': 1, 'name': 'systemd', 'exe_path': '/usr/lib/systemd/systemd',
             'signature': {'status': 'Valid', 'publisher': 'unexpected-package', 'verificationType': 'dpkg-integrity'}}
    assert host.inspect_process_identity(linux, 'linux')[0]['severity'] == 'CRITICAL'


def test_windows_registry_and_tasks_are_data_only(monkeypatch):
    rows = [{'persistenceType': 'RunOnce', 'location': 'HKCU/RunOnce/Test', 'command': '"C:\\Program Files\\test.exe" --flag'},
            {'persistenceType': 'ScheduledTask', 'location': 'Task', 'targetPath': 'C:/test.exe'}]
    monkeypatch.setattr(persistence, 'powershell', lambda script: result(json.dumps({'entries': rows, 'limitations': []})))
    assert persistence.collect_windows()[0] == rows
    assert persistence.command_target(rows[0]['command'], 'win32') == 'C:\\Program Files\\test.exe'


def test_launchagent_plist_parsed_without_execution(tmp_path, monkeypatch):
    folder = tmp_path / 'Library/LaunchAgents'
    folder.mkdir(parents=True)
    (folder / 'test.plist').write_bytes(plistlib.dumps({'Label': 'local.test', 'ProgramArguments': ['/tmp/test', '--flag'], 'RunAtLoad': True}))
    monkeypatch.setattr(persistence, 'run_command', lambda _: result(code=1))
    rows, limits = persistence.collect_macos(tmp_path)
    row = next(row for row in rows if row.get('targetPath') == '/tmp/test')
    assert row['persistenceType'] == 'LaunchAgents'
    assert row['evidence']['runAtLoad'] is True
    assert limits


def test_systemd_active_unit_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(persistence.os, 'getuid', lambda: 1000, raising=False)
    def command(args):
        if 'list-units' in args:
            return result('test.service loaded active running Example\n')
        return result('Id=test.service\nFragmentPath=/etc/systemd/system/test.service\nExecStart={ path=/tmp/start ; argv[]=/tmp/start ; }\n')
    monkeypatch.setattr(persistence, 'run_command', command)
    rows, _ = persistence.collect_linux(tmp_path)
    assert any(row.get('targetPath') == '/tmp/start' for row in rows)
    assert persistence.parse_cron('0 * * * * root /usr/local/bin/check\n', '/etc/crontab', True)[0]['command'] == '/usr/local/bin/check'


def test_chromium_sideloaded_extension_with_high_permissions(tmp_path, monkeypatch):
    root = tmp_path / 'Chrome'
    profile = root / 'Default'
    extension = profile / 'Extensions/testid/1.0'
    extension.mkdir(parents=True)
    (extension / 'manifest.json').write_text(json.dumps({'name': 'test', 'permissions': ['cookies'], 'host_permissions': ['<all_urls>']}))
    (profile / 'Preferences').write_text(json.dumps({'extensions': {'settings': {'testid': {'from_webstore': False, 'location': 4}}}}))
    monkeypatch.setattr(persistence, 'browser_roots', lambda *_: [root])
    monkeypatch.setattr(persistence, 'verify_binary_signature', lambda *_: {'status': 'Unknown', 'publisher': ''})
    entries, _ = persistence.collect_browser_extensions(tmp_path, sys.platform)
    findings, _ = persistence.evaluate_entries(entries, sys.platform, lambda _: [])
    assert findings[0]['category'] == 'BROWSER'
    assert findings[0]['severity'] == 'HIGH'
    assert 'no demuestran abuso' in findings[0]['userFriendlyExplanation']
    assert findings[0]['sha256']


def test_hash_match_escalates_unsigned_startup_with_evidence(tmp_path, monkeypatch):
    binary = tmp_path / 'startup.exe'
    binary.write_bytes(b'fixture')
    sha = host.sha256_file(str(binary))
    monkeypatch.setattr(persistence, 'verify_binary_signature', lambda *_: {'status': 'Unsigned', 'publisher': ''})
    entries = [{'persistenceType': 'Run', 'location': 'HKCU/Test', 'targetPath': str(binary)}]
    findings, limits = persistence.evaluate_entries(entries, sys.platform, lambda values: [{'ioc_value': sha, 'source_report': 'fixture'}])
    assert not limits
    assert findings[0]['sha256'] == sha
    assert findings[0]['severity'] == 'CRITICAL'
    assert findings[0]['ctiMatches'][0]['source_report'] == 'fixture'


@pytest.fixture
def sensor(monkeypatch):
    watcher = realtime.RealtimeWatcher(capacity=2, dedup_seconds=300)
    watcher._enabled = True
    monkeypatch.setattr(realtime, 'collect_connections', lambda: [])
    monkeypatch.setattr(realtime, 'collect_dns', lambda: (set(), 'cache-no-pid'))
    monkeypatch.setattr(realtime, 'scan_infostealer_activity', lambda: [])
    monkeypatch.setattr(realtime, 'process_metadata', lambda pid: {'pid': pid, 'name': 'fixture', 'exe_path': '', 'signature': {'status': 'Unknown', 'publisher': ''}})
    watcher.replace_iocs([{'ioc_type': 'domain', 'ioc_value': 'c2.example'}, {'ioc_type': 'ip', 'ioc_value': '203.0.113.9'}])
    return watcher


def test_dns_match_deduplicated_without_false_pid_or_block_claim(sensor, monkeypatch):
    monkeypatch.setattr(realtime, 'collect_dns', lambda: ({'c2.example'}, 'cache-no-pid'))
    sensor.tick()
    sensor.tick()
    alerts = sensor.status()['alerts']
    assert len(alerts) == 1
    assert alerts[0]['category'] == 'DNS_IOC'
    assert alerts[0]['evidence']['pid'] is None
    assert alerts[0]['blocked'] is False


def test_connection_match_is_differential_and_uses_cti_index(sensor, monkeypatch):
    connection = {'pid': 0, 'remoteIp': '203.0.113.9', 'remotePort': 443, 'localPort': 1234}
    monkeypatch.setattr(realtime, 'collect_connections', lambda: [connection])
    sensor.tick()
    sensor.tick()
    assert len(sensor.status()['alerts']) == 1
    assert sensor.status()['alerts'][0]['severity'] == 'CRITICAL'


def test_feed_reload_rechecks_existing_dns_entry_and_removes_old_ioc(sensor, monkeypatch):
    monkeypatch.setattr(realtime, 'collect_dns', lambda: ({'new.example'}, 'cache-no-pid'))
    sensor.tick()
    assert not sensor.status()['alerts']
    sensor.replace_iocs([{'ioc_type': 'domain', 'ioc_value': 'new.example'}])
    sensor.tick()
    assert sensor.status()['indicatorCount'] == 1
    assert sensor.status()['alerts'][0]['evidence']['indicator'] == 'new.example'


def test_feed_replacement_during_measurement_does_not_hide_new_match(sensor, monkeypatch):
    connection = {'pid': 0, 'remoteIp': '203.0.113.10', 'remotePort': 443, 'localPort': 1234}
    monkeypatch.setattr(realtime, 'collect_connections', lambda: [connection])
    def metadata(pid):
        sensor.replace_iocs([{'ioc_type': 'ip', 'ioc_value': '203.0.113.10'}])
        return {'pid': pid, 'name': 'fixture', 'exe_path': '', 'signature': {'status': 'Unknown', 'publisher': ''}}
    monkeypatch.setattr(realtime, 'process_metadata', metadata)
    sensor.tick()
    assert not sensor.status()['alerts']
    sensor.tick()
    assert sensor.status()['alerts'][0]['evidence']['indicator'] == '203.0.113.10'


def test_paused_sensor_does_not_emit_and_ring_is_bounded(sensor, monkeypatch):
    monkeypatch.setattr(realtime, 'host_scope', lambda: 'native-host')
    sensor.toggle(False)
    monkeypatch.setattr(realtime, 'collect_dns', lambda: ({'c2.example'}, 'cache-no-pid'))
    sensor.tick()
    assert not sensor.status()['alerts']
    sensor.toggle(True)
    for index in range(3):
        sensor._alert('TEST', 'LOW', 'test', 'test', {'indicator': str(index)})
    assert len(sensor.status()['alerts']) == 2
    monkeypatch.setattr(realtime, 'host_scope', lambda: 'container')
    with pytest.raises(ValueError, match='contenedor'):
        sensor.toggle(True)


def test_polling_dns_and_catalog_coverage_are_explicit(sensor, monkeypatch):
    monkeypatch.setattr(realtime, 'collect_dns', lambda: (set(), 'unavailable'))
    sensor.tick()
    status = sensor.status()
    assert status['dnsCoverage'] == 'unavailable'
    assert status['capabilities'] == {'blocking': False, 'eventBasedCapture': False}
    assert status['active'] is False  # no background thread running
    assert 'muestreo' in status['notice']


def test_start_stop_controls_background_thread(sensor, monkeypatch):
    monkeypatch.setenv('OMEGA_HOST_IOC_SOURCE', 'gateway')
    monkeypatch.setattr(realtime, 'host_scope', lambda: 'native-host')
    sensor.start(enabled=True)
    assert sensor.status()['running'] is True
    sensor.stop()
    assert sensor.status()['running'] is False
    assert sensor.status()['enabled'] is False


def test_host_endpoints_fail_closed_and_enforce_owner_tenant(monkeypatch, sensor):
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', 'test-token')
    monkeypatch.setenv('OMEGA_HOST_OWNER_TENANT_ID', 'tenant-a')
    monkeypatch.setattr(main, 'watcher', sensor)
    client = TestClient(main.app)
    path = '/api/host/realtime/status'
    assert client.get(path).status_code == 401
    headers = {'X-Internal-Service-Token': 'test-token', 'X-Host-Tenant': 'tenant-b'}
    assert client.get(path, headers=headers).status_code == 403
    headers['X-Host-Tenant'] = 'tenant-a'
    assert client.get(path, headers=headers).json()['indicatorCount'] == 2
    assert client.post('/api/host/realtime/toggle', headers=headers, json={}).status_code == 422
    response = client.post('/api/host/iocs/sync', headers=headers, json={'indicators': [{'ioc_type': 'domain', 'ioc_value': 'new.example'}]})
    assert response.status_code == 200
    assert response.json()['indicatorCount'] == 1
    monkeypatch.delenv('OMEGA_HOST_OWNER_TENANT_ID')
    assert client.get(path, headers=headers).status_code == 503


def test_persistence_api_structured_contract(monkeypatch):
    monkeypatch.setattr(main, 'host_scope', lambda: 'native-host')
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', 'test-token')
    monkeypatch.setenv('OMEGA_HOST_OWNER_TENANT_ID', 'tenant-a')
    monkeypatch.setattr(main, 'audit_persistence', lambda **_: {'scope': 'native-host', 'platform': 'win32', 'hostname': 'test',
                        'collectedAt': '2026-11-17T00:00:00Z', 'findings': [], 'limitations': ['Registry inaccessible'],
                        'complete': False, 'notice': 'Read only'})
    response = TestClient(main.app).post('/api/host/persistence/audit', headers={'X-Internal-Service-Token': 'test-token', 'X-Host-Tenant': 'tenant-a'})
    assert response.status_code == 200
    assert response.json()['complete'] is False
    assert response.json()['processes'] == []


def test_firefox_external_extension_and_unknown_signature(tmp_path, monkeypatch):
    root = tmp_path / 'firefox'
    profile = root / 'abc.default'
    profile.mkdir(parents=True)
    (profile / 'extensions.json').write_text(json.dumps({'addons': [
        {'id': 'addon@test', 'type': 'extension', 'active': True, 'foreignInstall': True,
         'signedState': None, 'path': '', 'userPermissions': {'permissions': ['nativeMessaging']}}
    ]}))
    monkeypatch.setattr(persistence, 'browser_roots', lambda *_: [root])
    entries, limits = persistence.collect_browser_extensions(tmp_path, sys.platform)
    assert not limits
    findings, _ = persistence.evaluate_entries(entries, sys.platform, lambda _: [])
    assert findings[0]['severity'] == 'HIGH'
    assert findings[0]['signatureStatus'] == 'Unknown'


def test_failed_cti_reload_preserves_previous_snapshot(sensor, monkeypatch):
    def unavailable():
        raise OSError('offline')
    monkeypatch.setattr(realtime, 'load_host_iocs', unavailable)
    sensor.reload_iocs()
    assert sensor.status()['indicatorCount'] == 2
    assert 'actualizado' in sensor.status()['catalogError']
    assert not sensor.status()['active']


def test_missing_dns_access_does_not_fabricate_a_clean_dns_result(sensor, monkeypatch):
    def unavailable():
        raise OSError('access denied')
    monkeypatch.setattr(realtime, 'collect_dns', unavailable)
    sensor.tick()
    assert sensor.status()['dnsCoverage'] == 'unavailable'


def test_windows_collector_script_has_valid_powershell_syntax():
    if sys.platform != 'win32':
        pytest.skip('PowerShell parser is a Windows-native check')
    import base64
    from host_runtime import powershell
    script = next(item for item in persistence.collect_windows.__code__.co_consts if isinstance(item, str) and '$ErrorActionPreference' in item)
    encoded = base64.b64encode(script.encode('utf-8')).decode('ascii')
    check = powershell("$ErrorActionPreference='Stop'; [ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))) | Out-Null")
    assert check.returncode == 0, check.stderr
