"""Extractor CTI volátil en RAM con WebBaseLoader de LangChain (RNF4).

Descarga y analiza artículos técnicos de Citizen Lab, Amnesty Tech o Google TAG
directamente en memoria sin escribir archivos HTML temporales en disco, extrayendo
IPv4 públicas (net4), dominios y CVEs con validación anti-SSRF.
"""

from __future__ import annotations

import gc
import hashlib
import ipaddress
import os
import re
import socket
from urllib.parse import urljoin, urlsplit

import psycopg

os.environ.setdefault("USER_AGENT", "OMEGA-CTI-Defensive-Loader/1.0")

from langchain_community.document_loaders import WebBaseLoader

from cti_ingestor_core import (
    DB_DSN,
    bulk_upsert_iocs,
    upsert_campaign,
    upsert_campaign_cves,
    upsert_report,
    upsert_web_document_chunks,
)

IPV4_REGEX = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
DOMAIN_REGEX = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,15}\b", re.IGNORECASE)
CVE_REGEX = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE)

_IGNORED_ASSET_EXTENSIONS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".css",
    ".js",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".map",
    ".pdf",
    ".json",
    ".xml",
    ".zip",
    ".gz",
    ".apk",
    ".so",
    ".db",
    ".txt",
    ".log",
    ".ips",
    ".sqlite",
    ".sqlite3",
    ".dylib",
    ".plist",
    ".ipa",
    ".dmg",
    ".exe",
    ".dll",
    ".bin",
)

_DEFANG_DOT_RE = re.compile(r"\[\.\]|\(\.\)")
_DEFANG_HTTP_RE = re.compile(r"\bhxxps?://", re.IGNORECASE)


def _normalize_url_input(url: str) -> str:
    cleaned = (url or "").strip()
    if cleaned.lower().startswith("hxxps://"):
        cleaned = "https://" + cleaned[8:]
    elif cleaned.lower().startswith("hxxp://"):
        cleaned = "http://" + cleaned[7:]
    cleaned = _DEFANG_DOT_RE.sub(".", cleaned)
    return cleaned


def _validate_public_http_url(raw_url: str) -> str:
    """Valida esquema HTTP/HTTPS y bloquea destinos internos/loopback (anti-SSRF)."""
    url = _normalize_url_input(raw_url)
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("URL inválida: solo se permiten esquemas HTTP/HTTPS con host válido.")

    host = parsed.hostname.strip().lower()
    if parsed.username or parsed.password:
        raise ValueError("No se permiten credenciales incrustadas en la URL.")
    if host in ("localhost", "ip6-localhost") or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("Acceso denegado a hosts locales o internos.")

    try:
        ip_literal = ipaddress.ip_address(host)
    except ValueError:
        ip_literal = None

    if ip_literal is not None:
        if not ip_literal.is_global:
            raise ValueError("Acceso denegado a direcciones IP privadas, loopback o reservadas.")
        return url

    try:
        addr_infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"No se pudo resolver el host público '{host}'.") from exc

    if not addr_infos:
        raise ValueError(f"El host '{host}' no devolvió direcciones IP resolubles.")

    for info in addr_infos:
        resolved_str = info[4][0].split("%", 1)[0]
        try:
            resolved_ip = ipaddress.ip_address(resolved_str)
        except ValueError as exc:
            raise ValueError(f"Dirección resuelta inválida para '{host}'.") from exc
        if not resolved_ip.is_global:
            raise ValueError("Acceso denegado: el dominio resuelve a una IP no pública.")

    return url


def _assert_safe_redirect(response, *_args, **_kwargs) -> None:
    """Valida cualquier destino de redirección HTTP 3xx antes de seguirlo (anti-SSRF)."""
    if getattr(response, "is_redirect", False) and "location" in response.headers:
        next_url = urljoin(response.url, response.headers["location"])
        _validate_public_http_url(next_url)


def _refang_text(text: str) -> str:
    normalized = _DEFANG_DOT_RE.sub(".", text or "")
    normalized = _DEFANG_HTTP_RE.sub("https://", normalized)
    return normalized


def _extract_valid_public_ipv4(text: str) -> list[str]:
    valid_ips: set[str] = set()
    for candidate in IPV4_REGEX.findall(text):
        try:
            ip_obj = ipaddress.IPv4Address(candidate)
            if ip_obj.is_global:
                valid_ips.add(str(ip_obj))
        except ValueError:
            continue
    return sorted(valid_ips)


def _extract_domains(text: str, source_host: str) -> list[str]:
    domains: set[str] = set()
    for candidate in DOMAIN_REGEX.findall(text):
        dom = candidate.lower().rstrip(".")
        if dom.endswith(_IGNORED_ASSET_EXTENSIONS):
            continue
        if dom == source_host:
            continue
        if any(part.isdigit() for part in dom.split(".")):
            sld = dom.split(".")[-2]
            if sld.isdigit():
                continue
        domains.add(dom)
    return sorted(domains)


def _infer_web_intel_attribution(source_host: str, title: str, scan_text: str) -> tuple[str, str, str | None]:
    """Infiere organización editora, familia de spyware y actor sospechado."""
    host_low = (source_host or "").lower()
    if "citizenlab" in host_low:
        org = "Citizen Lab"
    elif "amnesty" in host_low:
        org = "Amnesty Tech"
    elif "blog.google" in host_low or "google" in host_low:
        org = "Google TAG"
    elif "microsoft" in host_low:
        org = "Microsoft MSTIC"
    elif "accessnow" in host_low:
        org = "Access Now"
    else:
        org = source_host or "Fuente Web CTI"

    corpus_low = f"{title} {scan_text[:4000]}".lower()
    if "pegasus" in corpus_low or "forcedentry" in corpus_low or "blastpass" in corpus_low:
        return org, "Pegasus", "NSO Group"
    if "predator" in corpus_low or "cytrox" in corpus_low or "intellexa" in corpus_low:
        return org, "Predator", "Cytrox / Intellexa"
    if "candiru" in corpus_low or "devils-tongue" in corpus_low:
        return org, "Candiru", "Candiru / Saito Tech"
    if "novispy" in corpus_low:
        return org, "NoviSpy", "NoviSpy (BIA Serbia)"
    return org, "Spyware Comercial", "Por determinar"


def _split_clean_chunks(text: str, max_chunk_chars: int = 900, max_chunks: int = 8) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(cleaned) and len(chunks) < max_chunks:
        chunk = cleaned[start : start + max_chunk_chars].strip()
        if len(chunk) >= 40:
            chunks.append(chunk)
        start += max_chunk_chars
    return chunks


def _persist_web_intel_to_pg(
    *,
    safe_url: str,
    source_host: str,
    title: str,
    organization: str,
    spyware_family: str,
    suspected_actor: str | None,
    ipv4_list: list[str],
    domains: list[str],
    cves: list[str],
    preview: str,
    text_chunks: list[str],
) -> dict:
    """Persiste indicadores extraídos y fragmentos limpios hacia PostgreSQL (Capa 1 unificada)."""
    url_hash = hashlib.sha256(safe_url.encode("utf-8")).hexdigest()
    context_label = f"WebBaseLoader RAM ({source_host})"
    indicators: list[tuple[str, str, str]] = [
        *[("ip", ip, context_label) for ip in ipv4_list],
        *[("domain", dom, context_label) for dom in domains[:80]],
    ]

    try:
        with psycopg.connect(DB_DSN) as conn:
            with conn.cursor() as cur:
                campaign_id = upsert_campaign(
                    cur,
                    name=title[:240],
                    spyware_family=spyware_family,
                    suspected_actor=suspected_actor,
                    target_sector="Periodistas, sociedad civil, activistas y gobierno",
                    first_seen_date=None,
                    summary=preview[:500] if preview else f"Análisis CTI ingerido en RAM desde {safe_url}.",
                )
                report_id = upsert_report(
                    cur,
                    campaign_id=campaign_id,
                    title=title,
                    organization=organization,
                    publication_date=None,
                    source_url=safe_url,
                    local_filename=f"webloader_{url_hash[:16]}.ram",
                    file_hash=url_hash,
                )
                ioc_count = bulk_upsert_iocs(
                    cur,
                    campaign_id=campaign_id,
                    report_id=report_id,
                    indicators=indicators,
                )
                cve_count = upsert_campaign_cves(
                    cur,
                    campaign_id=campaign_id,
                    report_id=report_id,
                    cve_codes=cves,
                )
                chunk_count = upsert_web_document_chunks(
                    conn,
                    cur,
                    report_id=report_id,
                    title=title,
                    text_chunks=text_chunks,
                )
                conn.commit()
                return {
                    "persisted_to_db": True,
                    "persisted_report_id": str(report_id),
                    "persisted_campaign_id": str(campaign_id),
                    "persisted_iocs_count": ioc_count,
                    "persisted_cves_count": cve_count,
                    "persisted_chunks_count": chunk_count,
                }
    except psycopg.Error:
        return {
            "persisted_to_db": False,
            "persisted_report_id": None,
            "persisted_campaign_id": None,
            "persisted_iocs_count": 0,
            "persisted_cves_count": 0,
            "persisted_chunks_count": 0,
        }


def load_cti_url_in_ram(url: str, *, persist_to_db: bool = True) -> dict:
    """Carga una URL CTI en RAM (RNF4), destruye el HTML y opcionalmente unifica a PostgreSQL."""
    safe_url = _validate_public_http_url(url)
    source_host = (urlsplit(safe_url).hostname or "").lower()

    loader = WebBaseLoader(
        web_paths=[safe_url],
        requests_kwargs={
            "timeout": 12,
            "headers": {"User-Agent": "OMEGA-CTI-Defensive-Loader/1.0"},
            "hooks": {"response": _assert_safe_redirect},
        },
    )

    docs = []
    raw_text = ""
    scan_text = ""
    extracted_payload: dict | None = None
    persistence_args: dict | None = None

    try:
        docs = loader.load()
        if not docs:
            return {
                "url": safe_url,
                "source_host": source_host,
                "title": safe_url,
                "ipv4_iocs": [],
                "domains": [],
                "cves": [],
                "chunks_preview": "",
                "persisted_to_db": False,
                "persisted_iocs_count": 0,
                "persisted_cves_count": 0,
                "persisted_chunks_count": 0,
            }

        raw_text = "\n".join(d.page_content for d in docs)
        title = str(docs[0].metadata.get("title") or safe_url).strip()
        scan_text = _refang_text(raw_text)

        ipv4_list = _extract_valid_public_ipv4(scan_text)
        cves = sorted({c.upper() for c in CVE_REGEX.findall(scan_text)})
        domains = _extract_domains(scan_text, source_host)
        preview = re.sub(r"\s+", " ", raw_text).strip()[:400]
        text_chunks = _split_clean_chunks(raw_text)
        organization, spyware_family, suspected_actor = _infer_web_intel_attribution(
            source_host, title, scan_text
        )

        extracted_payload = {
            "url": safe_url,
            "source_host": source_host,
            "title": title,
            "organization": organization,
            "spyware_family": spyware_family,
            "ipv4_iocs": ipv4_list,
            "domains": domains[:80],
            "cves": cves,
            "chunks_preview": preview,
        }
        persistence_args = {
            "safe_url": safe_url,
            "source_host": source_host,
            "title": title,
            "organization": organization,
            "spyware_family": spyware_family,
            "suspected_actor": suspected_actor,
            "ipv4_list": ipv4_list,
            "domains": domains,
            "cves": cves,
            "preview": preview,
            "text_chunks": text_chunks,
        }
    finally:
        # Destruir buffers HTML/DOM de RAM antes de persistir o responder (RNF4)
        docs.clear()
        del docs
        raw_text = ""
        scan_text = ""
        gc.collect()

    if persist_to_db and persistence_args is not None:
        db_meta = _persist_web_intel_to_pg(**persistence_args)
    else:
        db_meta = {
            "persisted_to_db": False,
            "persisted_report_id": None,
            "persisted_campaign_id": None,
            "persisted_iocs_count": 0,
            "persisted_cves_count": 0,
            "persisted_chunks_count": 0,
        }

    return {
        **(extracted_payload or {}),
        **db_meta,
    }
