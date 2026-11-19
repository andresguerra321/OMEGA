"""Pruebas unitarias RNF9 (alcance honesto SO/kernel) y ventana de frescura CTI en el worker forense."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import cti_db  # noqa: E402
import forensic_engine  # noqa: E402
import host_forensics  # noqa: E402
import triage_orchestrator  # noqa: E402


def test_catalog_freshness_falls_back_gracefully_to_manifest_when_db_offline(monkeypatch):
    def _boom():
        raise RuntimeError("DB offline")

    monkeypatch.setattr(cti_db, "get_connection", _boom)
    freshness = cti_db.get_catalog_freshness()
    assert freshness["catalog_cutoff_date"] == "2024-12-16"
    assert freshness["verified_bundles_count"] >= 7
    assert freshness["update_policy"] == "pr_reviewed_only"
    assert freshness["db_online"] is False


def test_parallel_triage_clean_verdict_states_cutoff_and_os_scope_limitation(monkeypatch):
    def _offline():
        raise RuntimeError("DB offline in unit test")

    monkeypatch.setattr(cti_db, "get_connection", _offline)
    monkeypatch.setattr(triage_orchestrator, "lookup_iocs_detailed", lambda _candidates: [], raising=False)
    monkeypatch.setattr(
        triage_orchestrator,
        "get_catalog_freshness",
        lambda: {"catalog_cutoff_date": "2024-12-16", "verified_bundles_count": 7, "update_policy": "pr_reviewed_only"},
    )
    monkeypatch.setattr(forensic_engine, "lookup_iocs_detailed", lambda _candidates: [])

    artifacts = [
        {
            "filename": "safari_history.json",
            "bytes": b'[{"url": "https://reuters.com/world", "timestamp": "2024-06-14T10:00:00Z"}]',
        }
    ]
    report = asyncio.run(triage_orchestrator.run_parallel_forensic_triage(artifacts))
    diag = report["diagnosis"]

    assert diag["verdict_code"] == "CLEAN"
    assert "0 coincidencias contra catálogo con corte 2024-12-16" in diag["verdict_label"]
    assert "espacio de usuario" in diag["rationale"].lower()
    assert "kernel" in report["os_scope_notice"].lower()
    assert report["catalog_freshness"]["catalog_cutoff_date"] == "2024-12-16"
    assert any(m["id"] in ("os_patches", "apple_lockdown_mode", "host_fde_and_lockdown") for m in report["platform_mitigations"])


def test_pc_host_clean_verdict_avoids_absolute_immunity_claims(monkeypatch):
    monkeypatch.setattr(host_forensics, "lookup_iocs_detailed", lambda _candidates: [])
    monkeypatch.setattr(
        host_forensics,
        "get_catalog_freshness",
        lambda: {"catalog_cutoff_date": "2024-12-16", "verified_bundles_count": 7, "update_policy": "pr_reviewed_only"},
    )
    monkeypatch.setattr(host_forensics, "scan_artifacts_with_yara", lambda _items: [])

    snapshot = {
        "platform": "win32",
        "host": {
            "hostname": "TEST-WS",
            "os_version": "Windows 11",
            "defender_realtime": True,
            "firewall_enabled": True,
            "uac_enabled": True,
            "smartscreen_enabled": True,
        },
        "tcp_connections": [],
        "processes": [{"name": "explorer.exe", "path": "C:\\Windows\\explorer.exe", "pid": 100}],
        "wmi_subscriptions": [],
        "scheduled_tasks": [],
        "startup_items": [],
        "file_hashes": [],
        "collection_status": {section: "available" for section in (
            "processes", "tcp_connections", "wmi_subscriptions", "scheduled_tasks", "startup_items", "defender", "firewall", "uac"
        )},
    }

    res = host_forensics.run_host_live_audit(snapshot)
    diag = res["triage"]["diagnosis"]

    assert diag["verdict_code"] == "CLEAN"
    assert "0 coincidencias contra catálogo con corte 2024-12-16" in diag["verdict_label"]
    assert "inmunidad" in diag["rationale"].lower()
    assert "bitlocker" in " ".join(diag["recommended_actions"]).lower()
    assert res["catalog_freshness"]["catalog_cutoff_date"] == "2024-12-16"


def test_manual_ioc_verification_includes_catalog_freshness_and_os_scope(monkeypatch):
    monkeypatch.setattr(forensic_engine, "lookup_iocs_detailed", lambda _candidates: [])
    monkeypatch.setattr(
        forensic_engine,
        "get_catalog_freshness",
        lambda: {"catalog_cutoff_date": "2024-12-16", "verified_bundles_count": 7, "update_policy": "pr_reviewed_only"},
    )

    out = forensic_engine.analyze_forensic_payload("reuters.com", filename="manual.txt")
    assert out["total_matches"] == 0
    assert out["catalog_freshness"]["catalog_cutoff_date"] == "2024-12-16"
    assert "espacio de usuario" in out["os_scope_notice"].lower()
