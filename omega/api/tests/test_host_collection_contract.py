import pytest

import host_forensics
from schemas import PcLiveSnapshot


@pytest.fixture(autouse=True)
def isolated_engines(monkeypatch):
    monkeypatch.setattr(host_forensics, 'lookup_iocs_detailed', lambda _: [])
    monkeypatch.setattr(host_forensics, 'scan_artifacts_with_yara', lambda _: [])
    monkeypatch.setattr(host_forensics, 'get_catalog_freshness', lambda: {'db_online': True, 'catalog_cutoff_date': '2024-12-16'})


def snapshot():
    return {
        'platform': 'win32',
        'host': {'hostname': 'fixture-host', 'defender_realtime': True, 'firewall_enabled': True, 'uac_enabled': True},
        'processes': [{'pid': 42, 'name': 'explorer.exe', 'exe_path': r'C:\Windows\explorer.exe', 'signature_status': 'Unknown'}],
        'collection_status': {section: 'available' for section in (
            'processes', 'tcp_connections', 'wmi_subscriptions', 'scheduled_tasks', 'startup_items', 'defender', 'firewall', 'uac'
        )},
    }


def test_old_rust_summary_cannot_turn_empty_input_into_clean():
    old = {'sensor': 'omega-sensor-rust', 'process_count': 500, 'suspicious_processes': [], 'hostname': 'fixture-host'}
    result = host_forensics.run_host_live_audit(PcLiveSnapshot.model_validate(old).model_dump())
    assert result['triage']['diagnosis']['verdict_code'] == 'INCOMPLETE'
    assert result['triage']['total_files'] == 0
    assert 'processes' in result['coverage_gaps']
    assert 'Se auditaron' not in result['triage']['diagnosis']['rationale']


def test_native_processes_survive_request_schema_and_are_analyzed():
    payload = PcLiveSnapshot.model_validate(snapshot()).model_dump()
    result = host_forensics.run_host_live_audit(payload)
    assert result['device_summary']['hostname'] == 'fixture-host'
    assert result['triage']['total_indicators_analyzed'] == 1
    assert result['triage']['total_files'] == 1
    assert result['triage']['diagnosis']['verdict_code'] == 'CLEAN'
    assert result['coverage_gaps'] == []


@pytest.mark.parametrize('section', ['processes', 'tcp_connections', 'defender', 'firewall', 'wmi_subscriptions'])
def test_failed_section_prevents_clean_verdict(section):
    payload = snapshot()
    payload['collection_status'][section] = 'unavailable'
    result = host_forensics.run_host_live_audit(payload)
    assert result['triage']['diagnosis']['verdict_code'] == 'INCOMPLETE'
    assert section in result['coverage_gaps']


def test_offline_catalog_is_incomplete_instead_of_zero_matches(monkeypatch):
    monkeypatch.setattr(host_forensics, 'get_catalog_freshness', lambda: {'db_online': False})
    result = host_forensics.run_host_live_audit(snapshot())
    assert result['triage']['diagnosis']['verdict_code'] == 'INCOMPLETE'
    assert 'catalog_lookup' in result['coverage_gaps']


def test_partial_capture_keeps_detected_threat_visible(monkeypatch):
    monkeypatch.setattr(host_forensics, 'scan_artifacts_with_yara', lambda _: [{'spyware_family': 'fixture-family'}])
    payload = snapshot()
    payload['collection_status']['firewall'] = 'unavailable'
    result = host_forensics.run_host_live_audit(payload)
    assert result['triage']['diagnosis']['verdict_code'] == 'DETECTED'
    assert 'firewall' in result['coverage_gaps']
