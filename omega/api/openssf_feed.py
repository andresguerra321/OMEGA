"""Adaptador del feed OpenSSF malicious-packages (formato OSV JSON, sin ejecución de código)."""

from __future__ import annotations

import json
from typing import Any
import urllib.request


def parse_osv_malicious_package(advisory: dict[str, Any]) -> list[dict[str, Any]]:
    """Extrae entradas normalizadas de un advisory OSV (ej. MAL-2024-xxxx) para el catálogo CTI."""
    adv_id = str(advisory.get("id") or "").strip()
    if not adv_id:
        return []
    summary = str(advisory.get("summary") or advisory.get("details") or "")[:300]
    published = str(advisory.get("published") or "")
    records: list[dict[str, Any]] = []

    for affected in advisory.get("affected") or []:
        if not isinstance(affected, dict):
            continue
        pkg = affected.get("package") or {}
        ecosystem = str(pkg.get("ecosystem") or "").lower()
        name = str(pkg.get("name") or "").strip()
        if not name:
            continue
        records.append(
            {
                "advisory_id": adv_id,
                "ecosystem": ecosystem,
                "package_name": name,
                "summary": summary,
                "published": published,
                "source": "openssf-malicious-packages",
            }
        )
    return records


def build_advisory_index(advisories: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    """Construye un índice en memoria (ecosystem, package_name) -> advisory para el scanner."""
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for adv in advisories:
        for rec in parse_osv_malicious_package(adv):
            key = (rec["ecosystem"], rec["package_name"].lower())
            index[key] = {"id": rec["advisory_id"], "summary": rec["summary"], "source": rec["source"]}
    return index


def fetch_osv_package_advisories(
    ecosystem: str,
    package_name: str,
    *,
    timeout_seconds: float = 5.0,
) -> list[dict[str, Any]]:
    """Consulta metadatos OSV en solo lectura con timeout estricto y degradación elegante."""
    payload = json.dumps({"package": {"ecosystem": ecosystem, "name": package_name}}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.osv.dev/v1/query",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "OMEGA-Security-Platform/2.0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            vulns = data.get("vulns") or []
            return [v for v in vulns if isinstance(v, dict) and str(v.get("id", "")).startswith("MAL-")]
    except Exception:
        return []
