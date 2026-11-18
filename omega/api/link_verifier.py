import base64
import io
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from urllib.parse import urlparse

from cti_db import lookup_iocs_detailed
from owasp_rules import SHARED_HOSTING_ROOTS, evaluate_url_owasp
from evasion_intelligence import inspect_evasion, safe_http_get, resolve_public


def pinned_urlopen(request, timeout=None):
    """Provider fetches use the same public-IP pinning as active probes; no redirects."""
    result = safe_http_get(request.full_url, 'Omega-CTI-Passive-Check/1.0',
                           limit=2 * 1024 * 1024, redirects=0, headers=dict(request.header_items()))
    if not 200 <= result['status'] < 300 or result['truncated']:
        raise ValueError('Respuesta de reputación inválida o demasiado grande')
    return io.BytesIO(result['body'])

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
    root = ".".join(parts[-2:])
    if root in SHARED_HOSTING_ROOTS:
        return host.lower().strip(".")
    return root


def _vt_url_id(url: str) -> str:
    """Identificador compatible con vt-py (vt.url_id): Base64URL sin relleno '='."""
    return base64.urlsafe_b64encode(url.encode("utf-8")).decode("ascii").rstrip("=")


def _passive_vt_url_check(normalized_url: str, host: str) -> list[dict]:
    vt_key = (os.getenv("VIRUSTOTAL_API_KEY") or "").strip()
    if not vt_key:
        return []
    matches: list[dict] = []
    for path, ioc_type, val in [
        (f"/urls/{_vt_url_id(normalized_url)}", "url", normalized_url),
        (f"/domains/{urllib.parse.quote(host)}", "domain", host),
    ]:
        try:
            req = urllib.request.Request(
                f"https://www.virustotal.com/api/v3{path}",
                headers={"x-apikey": vt_key, "Accept": "application/json"},
            )
            with pinned_urlopen(req, timeout=4) as resp:
                payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
                stats = payload.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
                mal = int(stats.get("malicious") or 0)
                susp = int(stats.get("suspicious") or 0)
                if mal > 0 or susp >= 2:
                    matches.append({
                        "ioc_type": ioc_type,
                        "ioc_value": val,
                        "context": f"VirusTotal v3 (vt-py): {mal} motores maliciosos, {susp} sospechosos",
                        "campaign": "VirusTotal Multi-Engine Reputation",
                        "spyware_family": "Phishing / Malware",
                        "source_report": "VirusTotal API v3",
                        "organization": "VirusTotal",
                        "source_url": "https://www.virustotal.com/",
                    })
                    break
        except Exception:
            continue
    return matches


def _passive_cert_count(domain: str) -> int | None:
    """Consulta pasiva a Certificate Transparency con fallback multi-fuente (CertSpotter -> crt.sh -> HackerTarget)."""
    q = urllib.parse.quote(domain)
    # 1. CertSpotter CT API (rápida y estable incluso en dominios masivos como appspot.com)
    try:
        req = urllib.request.Request(
            f"https://api.certspotter.com/v1/issuances?domain={q}",
            headers={"User-Agent": "Omega-CTI-Passive-Check/1.0", "Accept": "application/json"},
        )
        with pinned_urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            if isinstance(data, list):
                return len(data)
    except Exception:
        pass

    # 2. crt.sh (excluyendo expirados para acelerar respuesta)
    try:
        req = urllib.request.Request(
            f"https://crt.sh/?q={q}&output=json&exclude=expired",
            headers={"User-Agent": "Omega-CTI-Passive-Check/1.0"},
        )
        with pinned_urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            if isinstance(data, list):
                return len(data)
    except Exception as exc:
        logger.debug("Consulta pasiva crt.sh fallida para '%s': %s", domain, exc)

    # 3. Fallback pasivo HackerTarget hostsearch
    try:
        req = urllib.request.Request(
            f"https://api.hackertarget.com/hostsearch/?q={q}",
            headers={"User-Agent": "Omega-CTI-Passive-Check/1.0"},
        )
        with pinned_urlopen(req, timeout=3) as resp:
            text = resp.read().decode("utf-8", errors="ignore").strip()
            if text and "error" not in text.lower() and "api count exceeded" not in text.lower():
                lines = [ln for ln in text.splitlines() if "," in ln]
                return len(lines)
    except Exception:
        pass

    return None


def inspect_suspicious_link(raw_url: str, *, active_probe: bool = False) -> dict:
    """Evalúa pasivamente; solo contacta al destino si se solicita active_probe."""
    normalized_url = _refang_url(raw_url)
    parsed = urlparse(normalized_url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.username or parsed.password:
        raise ValueError('No se aceptan enlaces que incluyan credenciales.')
    host = host.encode('idna').decode('ascii')

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

    # Búsqueda exacta y normalizada sobre la URL completa (http/https, con/sin slash), subdominio+ruta y host
    lower_url = normalized_url.lower()
    stripped_url = lower_url.rstrip("/")
    alt_scheme_url = (
        "https://" + stripped_url[len("http://"):]
        if stripped_url.startswith("http://")
        else ("http://" + stripped_url[len("https://"):] if stripped_url.startswith("https://") else stripped_url)
    )
    host_and_path = f"{host}{(parsed.path or '').lower().rstrip('/')}"
    candidates = list({
        lower_url,
        stripped_url,
        f"{stripped_url}/",
        alt_scheme_url,
        f"{alt_scheme_url}/",
        host_and_path,
        host,
        *([root_domain] if root_domain else []),
    })

    cti_matches = lookup_iocs_detailed(candidates)
    vt_matches = _passive_vt_url_check(normalized_url, host)
    if vt_matches:
        cti_matches = cti_matches + vt_matches

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

    infrastructure = inspect_evasion(normalized_url, host, active_probe=active_probe)
    levels = {'LOW': 0, 'MEDIUM': 1, 'HIGH': 2, 'CRITICAL': 3}
    if levels[infrastructure['riskLevel']] > levels[risk_level]:
        risk_level = infrastructure['riskLevel']
        verdict = 'Riesgo elevado por señales de infraestructura y posible evasión; requiere verificación'
        recommendation = 'Evita abrir el enlace desde tu teléfono y conserva la evidencia. Estas señales no atribuyen spyware ni confirman infección.'
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
        'domainAgeDays': infrastructure.get('domainAgeDays'),
        'freshTlsCertificate': infrastructure.get('freshTlsCertificate'),
        'cloakingDetected': infrastructure.get('cloakingDetected'),
        'evasionRiskScore': infrastructure['evasionRiskScore'],
        'evasionReasons': infrastructure['evasionReasons'],
        'infrastructure_intelligence': infrastructure,
        "privacy_notice": ('Se autorizó una comparación HTTP acotada: puede contactar al destino y revelar la IP del servicio, pero no ejecuta JavaScript ni envía cookies.' if active_probe else
                           'Consulta pasiva a CTI, RDAP y CT: no se contactó el destino. Los proveedores de reputación pueden recibir el dominio o la URL consultada.'),
    }

