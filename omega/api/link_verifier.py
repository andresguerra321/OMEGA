import json
import logging
import re
import urllib.parse
import urllib.request
from urllib.parse import urlparse

from cti_db import lookup_iocs_detailed
from owasp_rules import evaluate_url_owasp

logger = logging.getLogger(__name__)

URL_SHORTENERS = {
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "ow.ly",
    "is.gd",
    "buff.ly",
    "cutt.ly",
    "rb.gy",
    "shorturl.at",
    "tiny.cc",
}

SUSPICIOUS_TLDS = {".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".click", ".link", ".icu"}
IPV4_HOST_RE = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
DOMAIN_HOST_RE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")
UNSAFE_SCHEME_RE = re.compile(r"^(?:javascript|data|vbscript|file|ftp|mailto|about):", flags=re.IGNORECASE)
HOST_SAME_LETTER_RE = re.compile(r"([a-z])\1{3}")
HOST_CONSONANT_RUN_RE = re.compile(r"[bcdfghjklmnpqrstvwxz]{6}")
HOST_INTERLEAVED_SMASH_RE = re.compile(r"(?<![a-z0-9])(?=[a-z0-9]{9,})[a-z0-9]*[a-z]+\d+[a-z]+\d+")


def _is_valid_ipv4(host: str) -> bool:
    if not IPV4_HOST_RE.match(host):
        return False
    return all(0 <= int(part) <= 255 for part in host.split("."))


def _is_valid_domain_host(host: str) -> bool:
    if not DOMAIN_HOST_RE.match(host):
        return False
    labels = host.split(".")
    if len(labels) < 2 or len(labels) > 5:
        return False
    if sum(1 for lbl in labels if len(lbl) == 1) >= 2:
        return False
    if any("--" in lbl and not lbl.startswith("xn--") for lbl in labels):
        return False
    if (
        HOST_SAME_LETTER_RE.search(host)
        or HOST_CONSONANT_RUN_RE.search(host)
        or HOST_INTERLEAVED_SMASH_RE.search(host)
    ):
        return False
    return True


def _refang_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    if not cleaned:
        raise ValueError("Ingresa un enlace, dominio o dirección IPv4 para verificar.")
    if any(ch.isspace() for ch in cleaned):
        raise ValueError("El enlace no puede contener espacios ni saltos de línea.")
    if UNSAFE_SCHEME_RE.match(cleaned):
        raise ValueError("Solo se permiten enlaces HTTP/HTTPS o dominios válidos.")
    cleaned = re.sub(r"^hxxps://", "https://", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^hxxp://", "http://", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[\.\]|\(\.\)|\{\.\}", ".", cleaned)
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", cleaned) and not re.match(r"^https?://", cleaned, flags=re.IGNORECASE):
        raise ValueError("Solo se permiten enlaces con esquema http:// o https://.")
    if not re.match(r"^https?://", cleaned, flags=re.IGNORECASE):
        cleaned = f"http://{cleaned}"
    return cleaned


def _get_root_domain(host: str) -> str | None:
    parts = host.lower().strip(".").split(".")
    if len(parts) < 3:
        return None
    return ".".join(parts[-2:])


def _passive_cert_count(domain: str) -> int | None:
    """Consulta pasiva a crt.sh sin contactar el servidor del enlace sospechoso."""
    try:
        q = urllib.parse.quote(domain)
        req = urllib.request.Request(
            f"https://crt.sh/?q={q}&output=json",
            headers={"User-Agent": "Omega-CTI-Passive-Check/1.0"},
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            return len(data) if isinstance(data, list) else 0
    except Exception as exc:
        logger.debug("Consulta pasiva crt.sh fallida para '%s': %s", domain, exc)
        return None


def inspect_suspicious_link(raw_url: str) -> dict:
    """Evalúa un enlace sospechoso antes de abrirlo sin realizar peticiones al destino (RNF4, RNF7)."""
    normalized_url = _refang_url(raw_url)
    parsed = urlparse(normalized_url)
    host = (parsed.hostname or "").lower().rstrip(".")

    if not host or (not _is_valid_domain_host(host) and not _is_valid_ipv4(host)):
        raise ValueError("Ingresa una URL, dominio con extensión (ej. ejemplo.org) o IPv4 válida.")

    root_domain = _get_root_domain(host)
    heuristics = []

    if parsed.scheme == "http":
        heuristics.append("Usa HTTP sin cifrado TLS (tráfico en texto plano).")
    if host.startswith("xn--") or ".xn--" in host:
        heuristics.append("Contiene codificación Punycode/IDN (posible suplantación visual homógrafa).")
    if IPV4_HOST_RE.match(host):
        heuristics.append("Apunta directamente a una dirección IPv4 en lugar de un dominio registrado.")
    if host in URL_SHORTENERS:
        heuristics.append("Es un acortador de URLs; oculta el destino real de redirección.")
    if any(host.endswith(tld) for tld in SUSPICIOUS_TLDS):
        heuristics.append("Utiliza un TLD de bajo costo frecuentemente empleado en infraestructura desechable.")
    if len(parsed.query) > 90 or len(parsed.path) > 80:
        heuristics.append("Ruta o parámetros de consulta extensos (patrón habitual en enlaces de rastreo individualizado).")

    # Búsqueda exacta en base local de IOCs indexados (URL completa, host y dominio raíz)
    candidates = list({normalized_url.lower(), host, *([root_domain] if root_domain else [])})

    cti_matches = lookup_iocs_detailed(candidates)

    cert_records = _passive_cert_count(host) if not IPV4_HOST_RE.match(host) else None
    owasp_findings = evaluate_url_owasp(normalized_url, host, parsed, cert_records)

    for finding in owasp_findings:
        msg = f"[{finding['rule_id']}] {finding['title']}: {finding['detail']}"
        if msg not in heuristics and finding["rule_id"] != "OWASP-A02-NO-TLS":
            heuristics.append(msg)

    has_high_owasp = any(f.get("severity") == "HIGH" for f in owasp_findings)
    has_medium_owasp = any(f.get("severity") == "MEDIUM" for f in owasp_findings)
    total_signals = len(heuristics) + len(owasp_findings)

    if cti_matches:
        risk_level = "HIGH"
        verdict = "Peligroso — Coincidencia con infraestructura maliciosa documentada (CTI)"
        recommendation = "No abras este enlace. Si llegó por SMS, WhatsApp o correo, conserva una captura y revisa tu dispositivo en 'Revisar mi equipo'."
    elif has_high_owasp or total_signals >= 3:
        risk_level = "HIGH"
        verdict = "Alto riesgo — Reglas OWASP y señales heurísticas activadas"
        recommendation = "No abras este enlace ni descargues archivos desde él. Presenta señales de alto riesgo (OWASP / distribución no verificada / ofuscación)."
    elif has_medium_owasp or len(heuristics) >= 2:
        risk_level = "MEDIUM"
        verdict = "Precaución — Sin cifrado/certificado válido o con alertas OWASP"
        recommendation = "Evita ingresar datos o descargar archivos. El enlace carece de cifrado TLS/certificados verificados o presenta señales sospechosas."
    else:
        risk_level = "LOW"
        verdict = "Sin alertas OWASP ni coincidencias conocidas en la base CTI"
        recommendation = "Usa HTTPS y no aparece en reportes ni reglas OWASP actuales, pero mantén precaución si proviene de un remitente desconocido."

    return {
        "normalized_url": normalized_url,
        "host": host,
        "root_domain": root_domain,
        "scheme": parsed.scheme,
        "path": parsed.path or "/",
        "risk_level": risk_level,
        "verdict": verdict,
        "recommendation": recommendation,
        "heuristics": heuristics,
        "owasp_findings": owasp_findings,
        "passive_ct_certificates": cert_records,
        "cti_matches": cti_matches,
        "privacy_notice": "Verificación 100% pasiva (CTI + OWASP + CT): Omega no realizó ninguna conexión al enlace ni almacenó la URL consultada (RNF4, RNF7).",
    }

