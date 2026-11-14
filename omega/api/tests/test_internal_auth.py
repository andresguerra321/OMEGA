"""Pruebas unitarias de aislamiento y fail-closed para `X-Internal-Service-Token` en omega/api."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import main  # noqa: E402


class InternalServiceTokenMiddlewareTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def test_fails_closed_503_when_internal_token_env_is_missing_or_blank(self) -> None:
        protected_calls = [
            ("GET", "/api/health", {}),
            ("POST", "/api/ioc/verify/text", {"json": {"indicators_text": "evil.example.org"}}),
            ("POST", "/api/link/verify", {"json": {"url": "https://evil.example.org/login"}}),
            (
                "POST",
                "/api/triage/parallel",
                {"files": [("files", ("safari_history.json", b'{"history":[]}', "application/json"))]},
            ),
            (
                "POST",
                "/api/yara",
                {"files": [("files", ("sample.txt", b"benign text", "text/plain"))]},
            ),
        ]

        for token_value in ("", "   "):
            with patch.dict(os.environ, {"INTERNAL_SERVICE_TOKEN": token_value}):
                for method, path, kwargs in protected_calls:
                    resp = self.client.request(method, path, **kwargs)
                    self.assertEqual(resp.status_code, 503, f"Se esperaba 503 para {method} {path}")
                    self.assertIn("INTERNAL_SERVICE_TOKEN", resp.json()["detail"])

    def test_rejects_missing_or_invalid_header_with_401_across_forensic_endpoints(self) -> None:
        configured = "omega-test-secret-token-value"
        bad_headers = [
            {},
            {"X-Internal-Service-Token": ""},
            {"X-Internal-Service-Token": "wrong-token"},
            {"X-Internal-Service-Token": configured[:-1]},
            {"X-Internal-Service-Token": f"{configured} "},
        ]
        endpoints = [
            ("GET", "/api/health", {}),
            ("POST", "/api/ioc/verify/text", {"json": {"indicators_text": "192.0.2.10"}}),
            ("POST", "/api/link/verify", {"json": {"url": "https://example.org"}}),
            (
                "POST",
                "/api/triage/parallel",
                {"files": [("files", ("sample.json", b"{}", "application/json"))]},
            ),
            (
                "POST",
                "/api/yara",
                {"files": [("files", ("sample.bin", b"MZtest", "application/octet-stream"))]},
            ),
            ("POST", "/api/triage/pc-live", {"json": {"platform": "win32"}}),
            ("GET", "/api/campaigns/00000000-0000-0000-0000-000000000001/yara", {}),
        ]

        with patch.dict(os.environ, {"INTERNAL_SERVICE_TOKEN": configured}):
            for hdrs in bad_headers:
                for method, path, kwargs in endpoints:
                    resp = self.client.request(method, path, headers=hdrs, **kwargs)
                    self.assertEqual(
                        resp.status_code,
                        401,
                        f"Se esperaba 401 para {method} {path} con headers={hdrs}",
                    )
                    self.assertIn("X-Internal-Service-Token", resp.json()["detail"])

    def test_allows_health_and_in_ram_yara_with_valid_token(self) -> None:
        configured = "omega-test-secret-token-value"
        headers = {"X-Internal-Service-Token": configured}

        with (
            patch.dict(os.environ, {"INTERNAL_SERVICE_TOKEN": configured}),
            patch("yara_engine.fetch_yara_iocs", return_value=[]),
        ):
            health = self.client.get("/api/health", headers=headers)
            self.assertEqual(health.status_code, 200)
            body = health.json()
            self.assertEqual(body["service"], "omega-forensic-worker")
            self.assertEqual(body["mode"], "stateless-ram-only")

            yara_resp = self.client.post(
                "/api/yara",
                headers=headers,
                files=[("files", ("probe.txt", b"clean payload", "text/plain"))],
            )
            self.assertEqual(yara_resp.status_code, 200)
            self.assertEqual(yara_resp.json()["files_scanned"], 1)


if __name__ == "__main__":
    unittest.main()
