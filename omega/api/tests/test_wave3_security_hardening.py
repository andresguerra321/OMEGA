"""Regression tests for Wave 3 Security Audit Hardening (C-10)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

import evasion_intelligence
import registry_clients


@pytest.mark.parametrize(
    "eco,bad_name",
    [
        ("npm", "../etc/passwd"),
        ("npm", "@scope/../../evil"),
        ("npm", "pkg\\evil"),
        ("npm", "pkg\r\nX-Injected: 1"),
        ("npm", "UPPERCASE_INVALID"),
        ("pypi", "../secret"),
        ("pypi", "pkg\\path"),
        ("pypi", "pkg\x00null"),
        ("pypi", "-leading-dash"),
        ("pypi", "pkg/slash"),
    ],
)
def test_c10_rejects_invalid_package_names_before_fetching(eco, bad_name):
    assert registry_clients.validate_package_name(eco, bad_name) is None
    fetcher = MagicMock()
    client = registry_clients.RegistryMetadataClient(fetcher=fetcher)
    assert client.get_package_metadata(eco, bad_name) is None
    fetcher.assert_not_called()


def test_c10_accepts_valid_npm_and_pypi_names():
    assert registry_clients.validate_package_name("npm", "@scope/my-pkg_1.0") == "@scope/my-pkg_1.0"
    assert registry_clients.validate_package_name("npm", "express") == "express"
    assert registry_clients.validate_package_name("pypi", "fastapi-utils_2.0") == "fastapi-utils_2.0"


def test_c10_http_get_json_uses_safe_http_get_without_redirects(monkeypatch):
    calls: list[dict] = []

    def fake_safe_http_get(url, user_agent, *, limit, redirects, headers=None):
        calls.append({"url": url, "user_agent": user_agent, "limit": limit, "redirects": redirects, "headers": headers})
        return {
            "status": 200,
            "body": json.dumps({"info": {"author": "omega-dev"}, "releases": {}}).encode("utf-8"),
            "finalHost": "pypi.org",
        }

    monkeypatch.setattr(evasion_intelligence, "safe_http_get", fake_safe_http_get)
    data = registry_clients._http_get_json("https://pypi.org/pypi/requests/json", 5.0)
    assert data == {"info": {"author": "omega-dev"}, "releases": {}}
    assert len(calls) == 1
    assert calls[0]["redirects"] == 0
    assert calls[0]["headers"] == {"Accept": "application/json"}


def test_c10_http_get_json_returns_none_when_safe_http_get_blocks_ssrf(monkeypatch):
    def fake_block(*args, **kwargs):
        raise ValueError("La inspección HTTP no admite destinos privados, locales o especiales.")

    monkeypatch.setattr(evasion_intelligence, "safe_http_get", fake_block)
    assert registry_clients._http_get_json("http://127.0.0.1/secret", 5.0) is None
