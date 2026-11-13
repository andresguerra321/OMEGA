import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlparse
import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

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


def _refang_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    cleaned = re.sub(r"^hxxps://", "https://", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^hxxp://", "http://", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[\.\]|\(\.\)|\{\.\}", ".", cleaned)
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
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            return len(data) if isinstance(data, list) else 0
    except Exception:
        return None


def inspect_suspicious_link(raw_url: str) -> dict:
    """Evalúa un enlace sospechoso antes de abrirlo sin realizar peticiones al destino (RNF4, RNF7)."""
    normalized_url = _refang_url(raw_url)
    parsed = urlparse(normalized_url)
    host = (parsed.hostname or "").lower().rstrip(".")

    if not host:
        raise ValueError("No se pudo extraer un dominio o dirección válida del enlace proporcionado.")

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

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    i.ioc_type,
                    i.ioc_value,
                    i.context,
                    COALESCE(c.name, 'Sin campaña vinculada') AS campaign_name,
                    COALESCE(c.spyware_family, 'Desconocida') AS spyware_family,
                    r.title AS report_title,
                    r.organization,
                    r.source_url
                FROM iocs i
                JOIN reports r ON i.report_id = r.id
                LEFT JOIN campaigns c ON i.campaign_id = c.id
                WHERE i.ioc_value = ANY(%s);
                """,
                (candidates,),
            )
            rows = cur.fetchall()

    cti_matches = [
        {
            "ioc_type": r[0],
            "ioc_value": r[1],
            "context": r[2],
            "campaign": r[3],
            "spyware_family": r[4],
            "source_report": r[5],
            "organization": r[6],
            "source_url": r[7],
        }
        for r in rows
    ]

    cert_records = _passive_cert_count(host) if not IPV4_HOST_RE.match(host) else None

    if cti_matches:
        risk_level = "HIGH"
        verdict = "Peligroso — Coincidencia con infraestructura de spyware documentada"
        recommendation = "No abras este enlace. Si llegó por SMS, WhatsApp o correo, conserva una captura y revisa tu dispositivo en 'Revisar mi equipo'."
    elif len(heuristics) >= 2:
        risk_level = "MEDIUM"
        verdict = "Precaución — Presenta múltiples señales de enlace ofuscado o desechable"
        recommendation = "Evita abrir el enlace directamente; verifica por otro canal con el remitente antes de interactuar."
    else:
        risk_level = "LOW"
        verdict = "Sin coincidencias conocidas en la base de inteligencia"
        recommendation = "No aparece en los reportes indexados actualmente, pero mantén precaución si proviene de un remitente desconocido."

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
        "passive_ct_certificates": cert_records,
        "cti_matches": cti_matches,
        "privacy_notice": "Verificación 100% pasiva: Omega no realizó ninguna conexión al enlace ni almacenó la URL consultada (RNF4, RNF7).",
    }
