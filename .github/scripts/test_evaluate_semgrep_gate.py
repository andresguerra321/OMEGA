from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

from evaluate_semgrep_gate import compute_context_fingerprint, evaluate_report


def _finding(check_id: str, path: str, severity: str, line: int = 10, lines_text: str = "") -> dict:
    return {
        "check_id": check_id,
        "path": path,
        "start": {"line": line, "col": 1},
        "end": {"line": line, "col": 20},
        "extra": {
            "severity": severity,
            "message": "test",
            "fingerprint": "requires login",
            "lines": lines_text or "requires login",
        },
    }


def test_real_accepted_finding_passes_without_blocking_and_matches_context():
    accepted_doc = json.loads(
        Path(".github/security/semgrep-accepted-risks.json").read_text(encoding="utf-8")
    )
    report = {
        "results": [
            _finding(
                "java.lang.security.audit.crypto.unencrypted-socket.unencrypted-socket",
                "omega/backend-java/src/main/java/com/omega/platform/cti/WebIntelExtractorService.java",
                "WARNING",
                354,
            )
        ],
        "errors": [],
    }
    code, metrics, _ = evaluate_report(
        report,
        accepted_risks=accepted_doc["accepted_risks"],
        mode="enforce-new-error",
        repo_root=Path("."),
        reference_date=dt.date(2026, 11, 18),
    )
    assert code == 0
    assert metrics["accepted_count"] == 1
    assert metrics["new_count"] == 0


def test_same_rule_and_file_different_context_or_duplicate_does_not_inherit_exception(tmp_path: Path):
    target_file = tmp_path / "omega" / "Svc.java"
    target_file.parent.mkdir(parents=True)
    target_file.write_text(
        "\n".join(
            [
                "class Svc {",
                "  void safePinned() {",
                "    Socket s = new Socket(Proxy.NO_PROXY);",
                "  }",
                "  void unsafeSecondCopy() {",
                "    Socket s = new Socket(Proxy.NO_PROXY);",
                "  }",
                "}",
            ]
        ),
        encoding="utf-8",
    )

    rule = "java.lang.security.audit.crypto.unencrypted-socket.unencrypted-socket"
    fp1, _ = compute_context_fingerprint(rule, "omega/Svc.java", 3, 3, repo_root=tmp_path)
    fp2, _ = compute_context_fingerprint(rule, "omega/Svc.java", 6, 6, repo_root=tmp_path)
    assert fp1 != fp2

    accepted = [
        {
            "check_id": rule,
            "path": "omega/Svc.java",
            "context_sha256": fp1,
            "max_occurrences": 1,
            "classification": "ACCEPTED",
            "justification": "Validado solo en metodo safePinned() bajo revision.",
            "owner": "secops",
            "reviewed_at": "2026-11-18",
            "expires_at": "2027-05-18",
        }
    ]
    report = {
        "results": [
            _finding(rule, "omega/Svc.java", "ERROR", line=3),
            _finding(rule, "omega/Svc.java", "ERROR", line=6),
        ],
        "errors": [],
    }
    code, metrics, _ = evaluate_report(
        report,
        accepted_risks=accepted,
        mode="enforce-new-error",
        repo_root=tmp_path,
        reference_date=dt.date(2026, 11, 18),
    )
    assert code == 1
    assert metrics["accepted_count"] == 1
    assert metrics["new_count"] == 1
    assert metrics["new_error_count"] == 1

    # Incluso un duplicado identico mas alla de max_occurrences=1 no hereda la excepcion
    report_dup = {
        "results": [
            _finding(rule, "omega/Svc.java", "ERROR", line=3),
            _finding(rule, "omega/Svc.java", "ERROR", line=3),
        ],
        "errors": [],
    }
    code_dup, metrics_dup, _ = evaluate_report(
        report_dup,
        accepted_risks=accepted,
        mode="enforce-new-error",
        repo_root=tmp_path,
        reference_date=dt.date(2026, 11, 18),
    )
    assert code_dup == 1
    assert metrics_dup["accepted_count"] == 1
    assert metrics_dup["new_error_count"] == 1


def test_fingerprint_survives_line_shifts_above_but_invalidates_when_target_code_changes(tmp_path: Path):
    f = tmp_path / "app.py"
    f.write_text("import os\ndef safe():\n  tarfile.open('a').extractall('/tmp')\n  return 1\n", encoding="utf-8")
    rule = "omega-python-unsafe-tar-extractall"
    fp_orig, _ = compute_context_fingerprint(rule, "app.py", 3, 3, repo_root=tmp_path)

    # Desplazamiento de 5 líneas arriba sin tocar la función: mantiene mismo context_sha256
    f.write_text("# comment\n" * 5 + "import os\ndef safe():\n  tarfile.open('a').extractall('/tmp')\n  return 1\n", encoding="utf-8")
    fp_shifted, _ = compute_context_fingerprint(rule, "app.py", 8, 8, repo_root=tmp_path)
    assert fp_orig == fp_shifted

    # Modificación del código en el punto exacto: cambia el fingerprint y exige nueva revisión
    f.write_text("# comment\n" * 5 + "import os\ndef safe():\n  tarfile.open(user_input).extractall('/tmp')\n  return 1\n", encoding="utf-8")
    fp_modified, _ = compute_context_fingerprint(rule, "app.py", 8, 8, repo_root=tmp_path)
    assert fp_orig != fp_modified


def test_invalid_or_expired_exceptions_fail_closed():
    base_exc = {
        "check_id": "rule.a",
        "path": "omega/a.py",
        "context_sha256": "a" * 64,
        "classification": "FALSE_POSITIVE",
        "justification": "Justificacion tecnica suficiente para la prueba.",
        "owner": "secops",
        "reviewed_at": "2026-01-01",
        "expires_at": "2026-06-01",
    }
    # Caducada en 2026-11-18
    code_exp, m_exp, _ = evaluate_report(
        {"results": [], "errors": []},
        accepted_risks=[base_exc],
        reference_date=dt.date(2026, 11, 18),
    )
    assert code_exp == 2 and m_exp["config_invalid"] is True

    # Comodín prohibido
    wild = dict(base_exc, check_id="rule.*", expires_at="2027-06-01")
    code_wild, m_wild, _ = evaluate_report(
        {"results": [], "errors": []},
        accepted_risks=[wild],
        reference_date=dt.date(2026, 11, 18),
    )
    assert code_wild == 2 and m_wild["config_invalid"] is True

    # Sin fingerprint ni context_sha256
    no_fp = dict(base_exc, expires_at="2027-06-01")
    no_fp.pop("context_sha256")
    code_nofp, m_nofp, _ = evaluate_report(
        {"results": [], "errors": []},
        accepted_risks=[no_fp],
        reference_date=dt.date(2026, 11, 18),
    )
    assert code_nofp == 2 and m_nofp["config_invalid"] is True


def test_incomplete_or_corrupt_report_and_fatal_scanner_errors_fail_closed(tmp_path: Path):
    code_missing_results, m_inc, _ = evaluate_report({"errors": []})
    assert code_missing_results == 2 and m_inc["scanner_fatal"] is True

    code_rc, _, _ = evaluate_report({"results": [], "errors": []}, semgrep_rc=2)
    assert code_rc == 2

    code_fatal, m_fatal, _ = evaluate_report(
        {"results": [], "errors": [{"type": "FatalError", "message": "engine crash"}]}
    )
    assert code_fatal == 2 and m_fatal["scanner_fatal"] is True

    corrupt = tmp_path / "bad.json"
    corrupt.write_text("{not valid json", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, ".github/scripts/evaluate_semgrep_gate.py", "--report", str(corrupt)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_modes_observe_enforce_new_error_and_enforce_all_error(tmp_path: Path):
    rule = "some.rule"
    fp_pre, _ = compute_context_fingerprint(
        rule, "omega/legacy.py", 1, 1, repo_root=tmp_path, extra_lines="bad()"
    )
    baseline = [{"check_id": rule, "path": "omega/legacy.py", "context_sha256": fp_pre, "count": 1}]
    rep = {
        "results": [_finding(rule, "omega/legacy.py", "ERROR", line=1, lines_text="bad()")],
        "errors": [],
    }

    code_obs, _, _ = evaluate_report(rep, baseline_findings=baseline, mode="observe", repo_root=tmp_path)
    code_new, _, _ = evaluate_report(rep, baseline_findings=baseline, mode="enforce-new-error", repo_root=tmp_path)
    code_all, _, _ = evaluate_report(rep, baseline_findings=baseline, mode="enforce-all-error", repo_root=tmp_path)

    assert code_obs == 0
    assert code_new == 0
    assert code_all == 1

    # observe tampoco oculta errores fatales del escáner
    code_obs_fatal, _, _ = evaluate_report(
        {"results": [], "errors": [{"type": "FatalError", "message": "boom"}]},
        mode="observe",
    )
    assert code_obs_fatal == 2
