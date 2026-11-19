import secrets

import pytest
from fastapi.testclient import TestClient

import main


@pytest.mark.parametrize('scope', ['container', 'native-host'])
def test_health_reports_real_scope_without_relaxing_host_ownership(monkeypatch, scope):
    token = secrets.token_hex(32)
    monkeypatch.setenv('INTERNAL_SERVICE_TOKEN', token)
    monkeypatch.setenv('OMEGA_REQUIRE_HMAC', 'false')
    monkeypatch.delenv('OMEGA_NATIVE_SENSOR', raising=False)
    monkeypatch.delenv('OMEGA_HOST_OWNER_TENANT_ID', raising=False)
    monkeypatch.setattr(main.local_auth, 'ACTIVE', None)
    monkeypatch.setattr(main, 'host_scope', lambda: scope)
    monkeypatch.setattr(main, 'get_yara_engine_status', lambda: {})
    client = TestClient(main.app)
    headers = {'X-Internal-Service-Token': token}
    assert client.get('/api/health').status_code == 401
    response = client.get('/api/health', headers=headers)
    assert response.status_code == 200
    assert response.json()['scope'] == scope
    assert client.get('/api/host/realtime/status', headers=headers).status_code == 503
