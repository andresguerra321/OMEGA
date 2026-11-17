import re
from urllib.parse import unquote

OWASP_INJECTION_PATTERNS = [
    (re.compile(r"(?:<script|%3cscript|javascript:|onerror\s*=|onload\s*=|alert\s*\()", re.IGNORECASE), "Posible payload XSS (Cross-Site Scripting) en la URL"),
    (re.compile(r"(?:\bunion\b.+\bselect\b|'\s*or\s*1\s*=\s*1|\bdrop\s+table\b|--\s*$)", re.IGNORECASE), "Posible patrón de inyección SQL (SQLi) en parámetros"),
    (re.compile(r"(?:\.\./|\.\.%2f|\$\{jndi:|;\s*(?:wget|curl|bash|sh|cmd)\b)", re.IGNORECASE), "Posible Path Traversal, JNDI (Log4Shell) o Command Injection"),
]

OWASP_REDIRECT_PARAM_RE = re.compile(
    r"(?:^|[?&])(?:redirect|redirect_uri|next|url|target|dest|returnurl|continue)=https?://",
    re.IGNORECASE,
)

OWASP_INTERNAL_TARGET_RE = re.compile(
    r"^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|localhost$)",
    re.IGNORECASE,
)

WAREZ_PIRACY_RE = re.compile(
    r"(?:elenemigos|elamigos|pivigames|igg-games|oceanofgames|fitgirl|skidrow|codex|warez|keygen|crack(?:ed)?|repack|kmspico|activator|mod-?apk|torrent|cheat-?engine)",
    re.IGNORECASE,
)

DANGEROUS_EXT_RE = re.compile(
    r"\.(?:exe|msi|bat|cmd|ps1|vbs|js|jar|scr|apk|ipa|iso|dmg|rar|7z)(?:$|[?#])",
    re.IGNORECASE,
)

PHISHING_BRAND_RE = re.compile(
    r"(?:bancolombia|nequi|daviplata|davivienda|dian|paypal|microsoft|apple|icloud|whatsapp|google|binance|metamask|bbva|banco|colpatria|avvillas)",
    re.IGNORECASE,
)

PHISHING_ACTION_RE = re.compile(
    r"(?:login|signin|verify|verificacion|secure|seguridad|update|actualiza|actualizacion|soporte|support|wallet|cuenta|factura|bloqueo|phishing|malware|testsafebrowsing|credential|auth)",
    re.IGNORECASE,
)

OFFICIAL_BRAND_ROOTS = {
    "bancolombia.com",
    "nequi.com.co",
    "daviplata.com",
    "davivienda.com",
    "dian.gov.co",
    "paypal.com",
    "microsoft.com",
    "apple.com",
    "icloud.com",
    "whatsapp.com",
    "google.com",
    "binance.com",
    "metamask.io",
}

SHARED_HOSTING_ROOTS = {
    "appspot.com",
    "github.io",
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "web.app",
    "firebaseapp.com",
    "workers.dev",
    "herokuapp.com",
    "blogspot.com",
    "onrender.com",
    "glitch.me",
}

ARTIFACT_OWASP_RULES = [
    (
        "OWASP-A02-CRYPTO-SECRET",
        "A02:2021 Cryptographic Failures",
        "HIGH",
        "Exposición de clave privada o secreto hardcodeado",
        re.compile(r"(?:-----BEGIN (?:RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{30,})"),
    ),
    (
        "OWASP-A03-INJECTION",
        "A03:2021 Injection",
        "HIGH",
        "Patrón de ejecución de código o inyección (XSS/Command/SQLi)",
        re.compile(r"(?:<script\b|eval\s*\(|os\.system\s*\(|Runtime\.getRuntime\(\)\.exec|\bunion\s+select\b)", re.IGNORECASE),
    ),
    (
        "OWASP-A05-MISCONFIG",
        "A05:2021 Security Misconfiguration",
        "MEDIUM",
        "Deshabilitación de verificación TLS o configuración insegura",
        re.compile(r"(?:verify\s*=\s*False|SSL_VERIFY\s*=\s*false|rejectUnauthorized\s*:\s*false|Access-Control-Allow-Origin:\s*\*)", re.IGNORECASE),
    ),
    (
        "OWASP-A08-DROPPER",
        "A08:2021 Software and Data Integrity Failures",
        "HIGH",
        "Descarga y ejecución remota sin verificación de integridad",
        re.compile(r"(?:(?:curl|wget)[^\n|]{1,120}\|\s*(?:sh|bash|zsh)|powershell(?:\.exe)?\s+.*-(?:enc|encodedcommand)\b|Invoke-Expression\b)", re.IGNORECASE),
    ),
]


def evaluate_url_owasp(normalized_url: str, host: str, parsed, cert_records: int | None) -> list[dict]:
    """Evalúa reglas pasivas alineadas a OWASP Top 10 sobre la URL, esquema y certificados CT."""
    findings: list[dict] = []
    decoded_url = unquote(normalized_url)
    path_and_query = f"{parsed.path or ''}?{parsed.query or ''}"

    # OWASP A02: Cryptographic Failures (sin TLS / sin certificados CT)
    if parsed.scheme == "http":
        findings.append({
            "rule_id": "OWASP-A02-NO-TLS",
            "category": "A02:2021 Cryptographic Failures",
            "severity": "MEDIUM",
            "title": "Enlace sin cifrado TLS/HTTPS",
            "detail": "La URL utiliza HTTP en texto plano; el tráfico y credenciales pueden ser interceptados o alterados.",
        })

    if cert_records == 0:
        findings.append({
            "rule_id": "OWASP-A02-NO-CT-CERT",
            "category": "A02:2021 Cryptographic Failures",
            "severity": "MEDIUM",
            "title": "Dominio sin certificados TLS en Certificate Transparency",
            "detail": "No se encontraron certificados TLS emitidos para este dominio en crt.sh (posible sitio sin certificado válido o infraestructura recién desplegada).",
        })

    # OWASP A01: Broken Access Control / Open Redirect / Userinfo masking / SSRF
    if parsed.username or parsed.password or "@" in (parsed.netloc or ""):
        findings.append({
            "rule_id": "OWASP-A01-USERINFO-MASK",
            "category": "A01:2021 Broken Access Control",
            "severity": "HIGH",
            "title": "Ofuscación de destino con '@' en la autoridad URL",
            "detail": "El uso de usuario@host oculta el dominio real al que se conectará el navegador.",
        })

    if OWASP_REDIRECT_PARAM_RE.search(decoded_url):
        findings.append({
            "rule_id": "OWASP-A01-OPEN-REDIRECT",
            "category": "A01:2021 Broken Access Control",
            "severity": "HIGH",
            "title": "Parámetro de redirección externa (Open Redirect)",
            "detail": "Contiene un parámetro de redirección hacia otra URL externa, técnica frecuente en phishing.",
        })

    if OWASP_INTERNAL_TARGET_RE.match(host):
        findings.append({
            "rule_id": "OWASP-A10-SSRF-TARGET",
            "category": "A10:2021 Server-Side Request Forgery",
            "severity": "HIGH",
            "title": "Apunta a dirección interna, loopback o metadata cloud",
            "detail": "El host corresponde a una red privada o de metadatos (riesgo de SSRF).",
        })

    # OWASP A03: Injection
    for pattern, detail in OWASP_INJECTION_PATTERNS:
        if pattern.search(decoded_url):
            findings.append({
                "rule_id": "OWASP-A03-INJECTION",
                "category": "A03:2021 Injection",
                "severity": "HIGH",
                "title": "Patrón de inyección detectado en la URL",
                "detail": detail,
            })
            break

    # OWASP A08: Software & Data Integrity Failures (warez, piratería, typosquatting, ejecutables)
    warez_match = WAREZ_PIRACY_RE.search(host) or WAREZ_PIRACY_RE.search(path_and_query)
    ext_match = DANGEROUS_EXT_RE.search(parsed.path or "")
    if warez_match or ext_match:
        severity = "HIGH" if (warez_match and (ext_match or parsed.scheme == "http" or cert_records == 0)) else "MEDIUM"
        reasons = []
        if warez_match:
            reasons.append(f"patrón de descarga no oficial/warez o typosquatting ('{warez_match.group(0)}')")
        if ext_match:
            reasons.append(f"enlace directo a binario/archivo potencialmente riesgoso ('{ext_match.group(0)}')")
        findings.append({
            "rule_id": "OWASP-A08-INTEGRITY-RISK",
            "category": "A08:2021 Software and Data Integrity Failures",
            "severity": severity,
            "title": "Vector de riesgo de integridad / distribución de software no verificado",
            "detail": "Detectado " + " y ".join(reasons) + ". Los sitios de repacks/piratería o descargas directas sin verificación suelen distribuir infostealers o troyanos.",
        })

    # OWASP A07: Identification and Authentication Failures (Phishing / Suplantación en URL completa)
    parts = host.lower().strip(".").split(".")
    root_domain = ".".join(parts[-2:]) if len(parts) >= 2 else host.lower()
    is_official_brand = root_domain in OFFICIAL_BRAND_ROOTS
    is_shared_paas = root_domain in SHARED_HOSTING_ROOTS and host.lower() != root_domain

    brand_in_url = PHISHING_BRAND_RE.search(host) or PHISHING_BRAND_RE.search(path_and_query)
    action_in_url = PHISHING_ACTION_RE.search(host) or PHISHING_ACTION_RE.search(path_and_query)

    if is_shared_paas and (brand_in_url or action_in_url):
        findings.append({
            "rule_id": "OWASP-A07-PAAS-PHISHING",
            "category": "A07:2021 Identification and Authentication Failures",
            "severity": "HIGH",
            "title": "Subdominio o ruta sospechosa en servicio de alojamiento compartido",
            "detail": f"La URL completa se aloja en infraestructura compartida ({root_domain}) pero incluye indicadores de suplantación o amenaza en el subdominio o ruta ({host}{parsed.path or ''}).",
        })
    elif not is_official_brand and (
        (brand_in_url and action_in_url)
        or (brand_in_url and host.lower() != root_domain)
        or (action_in_url and (host.count("-") >= 1 or "/phishing" in path_and_query.lower() or "/malware" in path_and_query.lower()))
    ):
        severity = "HIGH" if (brand_in_url and action_in_url) or "phishing" in decoded_url.lower() or "testsafebrowsing" in host.lower() else "MEDIUM"
        findings.append({
            "rule_id": "OWASP-A07-PHISHING-LURE",
            "category": "A07:2021 Identification and Authentication Failures",
            "severity": severity,
            "title": "Señuelo de suplantación o captura de credenciales en URL completa",
            "detail": "El dominio, subdominio o ruta contiene términos sensibles (marca/entidad o acción de verificación/login) fuera del dominio oficial, independientemente de si usa HTTPS.",
        })

    return findings


def scan_artifacts_with_owasp(artifacts: list[dict]) -> list[dict]:
    """Evalúa artefactos y payloads con reglas estáticas OWASP Top 10 (complemento a YARA)."""
    hits: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for art in artifacts or []:
        source = str(art.get("filename") or art.get("path") or art.get("source") or art.get("name") or "artifact")
        raw = art.get("bytes") or art.get("content") or art.get("data") or art.get("text") or ""
        if isinstance(raw, bytes):
            text = raw.decode("utf-8", errors="ignore")
        else:
            text = str(raw)
        if not text:
            continue
        for rule_id, category, severity, title, regex in ARTIFACT_OWASP_RULES:
            if regex.search(text):
                key = (rule_id, source)
                if key in seen:
                    continue
                seen.add(key)
                hits.append({
                    "rule_id": rule_id,
                    "category": category,
                    "severity": severity,
                    "title": title,
                    "source": source,
                })
    return hits
