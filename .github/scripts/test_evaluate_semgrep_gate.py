from __future__ import annotations

import json
from pathlib import Path

from evaluate_semgrep_gate import evaluate_report


def _finding(check_id: str, path: str, severity: str, line: int = 10) -> dict:
    return {
        "check_id": check_id,
        "path": path,
        "start": {"line": line},
        "extra": {"severity": severity, "message": "test"},
    }


def test_blocks_new_error_and_ignores_documented_accepted_risk():
    accepted_doc = json.loads(
        Path(".github/security/semgrep-accepted-risks.json").read_text(encoding="utf-8")
    )
    report = {
        "results": [
            _finding(
                "java.lang.security.audit.crypto.unencrypted-socket.unencrypted-socket",
                "omega/backend-java/src/main/java/com/omega/platform/cti/WebIntelExtractorService.java",
                "WARNING",
                352,
            ),
            _finding(
                "dockerfile.security.missing-user.missing-user",
                "omega/new-service/Dockerfile",
                "ERROR",
                12,
            ),
        ],
        "errors": [],
    }
    code, metrics, _ = evaluate_report(
        report,
        accepted_risks=accepted_doc["accepted_risks"],
        mode="enforce-new-error",
    )
    assert code == 1
    assert metrics["accepted_count"] == 1
    assert metrics["new_error_count"] == 1


def test_allows_documented_accepted_risk_when_no_new_errors():
    accepted_doc = json.loads(
        Path(".github/security/semgrep-accepted-risks.json").read_text(encoding="utf-8")
    )
    report = {
        "results": [
            _finding(
                "java.lang.security.audit.crypto.unencrypted-socket.unencrypted-socket",
                "omega/backend-java/src/main/java/com/omega/platform/cti/WebIntelExtractorService.java",
                "WARNING",
                352,
            )
        ],
        "errors": [],
    }
    code, metrics, _ = evaluate_report(
        report,
        accepted_risks=accepted_doc["accepted_risks"],
        mode="enforce-new-error",
    )
    assert code == 0
    assert metrics["accepted_count"] == 1
    assert metrics["new_error_count"] == 0


def test_blocks_fatal_scanner_errors_and_nonzero_exit_code():
    code_rc, _, _ = evaluate_report({"results": [], "errors": []}, semgrep_rc=2)
    assert code_rc == 2

    code_fatal, metrics, _ = evaluate_report(
        {
            "results": [],
            "errors": [{"type": "FatalError", "message": "rule engine crashed"}],
        },
        semgrep_rc=0,
    )
    assert code_fatal == 2
    assert metrics["scanner_fatal"] is True


def test_preexisting_baseline_does_not_block_enforce_new_error_but_new_duplicate_does():
    baseline = [
        {"check_id": "some.preexisting.error", "path": "omega/legacy.py", "count": 1}
    ]
    report_same = {
        "results": [_finding("some.preexisting.error", "omega/legacy.py", "ERROR", 5)],
        "errors": [],
    }
    code_same, metrics_same, _ = evaluate_report(
        report_same, baseline_findings=baseline, mode="enforce-new-error"
    )
    assert code_same == 0
    assert metrics_same["preexisting_count"] == 1
    assert metrics_same["new_error_count"] == 0

    report_new = {
        "results": [
            _finding("some.preexisting.error", "omega/legacy.py", "ERROR", 5),
            _finding("some.preexisting.error", "omega/legacy.py", "ERROR", 42),
        ],
        "errors": [],
    }
    code_new, metrics_new, _ = evaluate_report(
        report_new, baseline_findings=baseline, mode="enforce-new-error"
    )
    assert code_new == 1
    assert metrics_new["new_error_count"] == 1
