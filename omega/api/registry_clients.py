"""Clientes de metadatos de registries públicos (npm y PyPI) con caché TTL y degradación elegante.

Regla no negociable: nunca descarga tarballs/wheels ni ejecuta código de terceros.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import time
from typing import Any, Callable
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "OMEGA-Security-Scanner/2.0.9 (static-metadata-only)"
DEFAULT_TIMEOUT_SECONDS = 5.0
DEFAULT_CACHE_TTL_SECONDS = 300.0


@dataclass(frozen=True)
class PackageMetadata:
    ecosystem: str
    name: str
    first_published: str | None = None
    latest_published: str | None = None
    maintainers: tuple[str, ...] = ()
    maintainer_changed_recently: bool = False
    repository_url: str | None = None
    has_install_scripts: bool = False


class RegistryMetadataClient:
    """Cliente inyectable de metadatos npm/PyPI con caché en RAM y timeout."""

    def __init__(
        self,
        fetcher: Callable[[str, float], dict[str, Any] | None] | None = None,
        cache_ttl_seconds: float = DEFAULT_CACHE_TTL_SECONDS,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._fetcher = fetcher or _http_get_json
        self._cache_ttl = max(1.0, float(cache_ttl_seconds))
        self._timeout = max(0.5, float(timeout_seconds))
        self._cache: dict[tuple[str, str], tuple[float, PackageMetadata | None]] = {}

    def get_package_metadata(self, ecosystem: str, name: str) -> PackageMetadata | None:
        eco = ecosystem.strip().lower()
        pkg = name.strip()
        if not pkg or eco not in ("npm", "pypi"):
            return None

        key = (eco, pkg.lower())
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached and (now - cached[0]) < self._cache_ttl:
            return cached[1]

        meta: PackageMetadata | None = None
        try:
            if eco == "npm":
                meta = self._fetch_npm(pkg)
            else:
                meta = self._fetch_pypi(pkg)
        except Exception:
            meta = None

        self._cache[key] = (now, meta)
        return meta

    def _fetch_npm(self, name: str) -> PackageMetadata | None:
        encoded = urllib.parse.quote(name, safe="@/")
        payload = self._fetcher(f"https://registry.npmjs.org/{encoded}", self._timeout)
        if not isinstance(payload, dict):
            return None

        times = payload.get("time") if isinstance(payload.get("time"), dict) else {}
        first_pub = _str_or_none(times.get("created"))
        dist_tags = payload.get("dist-tags") if isinstance(payload.get("dist-tags"), dict) else {}
        latest_ver = _str_or_none(dist_tags.get("latest"))
        latest_pub = _str_or_none(times.get(latest_ver)) if latest_ver else _str_or_none(times.get("modified"))

        maintainers_raw = payload.get("maintainers") if isinstance(payload.get("maintainers"), list) else []
        maintainers = tuple(
            str(m.get("name") or m.get("email") or "").strip()
            for m in maintainers_raw
            if isinstance(m, dict) and (m.get("name") or m.get("email"))
        )

        versions = payload.get("versions") if isinstance(payload.get("versions"), dict) else {}
        latest_obj = versions.get(latest_ver) if latest_ver and isinstance(versions.get(latest_ver), dict) else {}
        scripts = latest_obj.get("scripts") if isinstance(latest_obj.get("scripts"), dict) else {}
        has_install = any(k in scripts for k in ("preinstall", "install", "postinstall"))

        repo_field = latest_obj.get("repository") or payload.get("repository")
        repo_url = _extract_repo_url(repo_field)
        changed = _detect_npm_maintainer_change(versions, latest_ver, maintainers)

        return PackageMetadata(
            ecosystem="npm",
            name=name,
            first_published=first_pub,
            latest_published=latest_pub,
            maintainers=maintainers,
            maintainer_changed_recently=changed,
            repository_url=repo_url,
            has_install_scripts=has_install,
        )

    def _fetch_pypi(self, name: str) -> PackageMetadata | None:
        encoded = urllib.parse.quote(name, safe="")
        payload = self._fetcher(f"https://pypi.org/pypi/{encoded}/json", self._timeout)
        if not isinstance(payload, dict):
            return None

        info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
        releases = payload.get("releases") if isinstance(payload.get("releases"), dict) else {}

        all_dates: list[str] = []
        for files in releases.values():
            if not isinstance(files, list):
                continue
            for item in files:
                if isinstance(item, dict) and item.get("upload_time_iso_8601"):
                    all_dates.append(str(item["upload_time_iso_8601"]))

        all_dates.sort()
        first_pub = all_dates[0] if all_dates else None
        latest_pub = all_dates[-1] if all_dates else None

        author = _str_or_none(info.get("maintainer") or info.get("author"))
        maintainers = (author,) if author else ()
        proj_urls = info.get("project_urls") if isinstance(info.get("project_urls"), dict) else {}
        repo_url = _str_or_none(
            proj_urls.get("Source")
            or proj_urls.get("Repository")
            or proj_urls.get("Homepage")
            or info.get("home_page")
        )

        return PackageMetadata(
            ecosystem="pypi",
            name=name,
            first_published=first_pub,
            latest_published=latest_pub,
            maintainers=maintainers,
            maintainer_changed_recently=False,
            repository_url=repo_url,
            has_install_scripts=False,
        )


def _http_get_json(url: str, timeout: float) -> dict[str, Any] | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read(2 * 1024 * 1024).decode("utf-8", errors="replace"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None


def _str_or_none(val: Any) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s or None


def _extract_repo_url(repo_field: Any) -> str | None:
    if isinstance(repo_field, str):
        return _str_or_none(repo_field)
    if isinstance(repo_field, dict):
        return _str_or_none(repo_field.get("url"))
    return None


def _detect_npm_maintainer_change(
    versions: dict[str, Any],
    latest_ver: str | None,
    current_maintainers: tuple[str, ...],
) -> bool:
    if not latest_ver or len(versions) < 2:
        return False
    latest_obj = versions.get(latest_ver)
    if not isinstance(latest_obj, dict):
        return False
    latest_pub = (latest_obj.get("_npmUser") or {}).get("name") if isinstance(latest_obj.get("_npmUser"), dict) else None
    if not latest_pub:
        return False
    other_pubs = {
        str(v["_npmUser"].get("name"))
        for k, v in versions.items()
        if k != latest_ver and isinstance(v, dict) and isinstance(v.get("_npmUser"), dict) and v["_npmUser"].get("name")
    }
    return bool(other_pubs) and str(latest_pub) not in other_pubs


def days_since_iso(iso_ts: str | None, now: datetime | None = None) -> float | None:
    if not iso_ts:
        return None
    try:
        parsed = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        ref = now or datetime.now(timezone.utc)
        return (ref - parsed).total_seconds() / 86400.0
    except ValueError:
        return None
