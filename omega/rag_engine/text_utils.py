import re

# Patrones comunes de ofuscación (defanging) en reportes CTI
DEFANG_RULES = [
    (re.compile(r"hxxps://", re.IGNORECASE), "https://"),
    (re.compile(r"hxxp://", re.IGNORECASE), "http://"),
    (re.compile(r"\[\.\]|\(\.\)|\{\.\}|\\\."), "."),
    (re.compile(r"\[:\]|\(:\)"), ":"),
    (re.compile(r"\[@\]|\(@\)|\[at\]", re.IGNORECASE), "@"),
]

CVE_RE = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE)
SHA256_RE = re.compile(r"\b[a-f0-9]{64}\b", re.IGNORECASE)
DOMAIN_RE = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|info|biz|co|me|xyz|top|site|online|app|cloud|tech|tk|ml|ga|cf|gq|ru|cn|ir|ae|sa|il|uk|de|fr|es|mx|br|ar|cl|pe)\b",
    re.IGNORECASE,
)

# Dominios editoriales/referencia que no son IOCs maliciosos
BENIGN_DOMAINS = {
    "citizenlab.ca",
    "amnesty.org",
    "google.com",
    "blog.google",
    "apple.com",
    "support.apple.com",
    "github.com",
    "raw.githubusercontent.com",
    "twitter.com",
    "x.com",
    "nso-group.com",
    "nsogroup.com",
    "mitre.org",
    "cve.org",
    "nvd.nist.gov",
    "doi.org",
    "w3.org",
    "ietf.org",
    "whatsapp.com",
    "telegram.org",
    "signal.org",
}


def refang_text(text: str) -> str:
    """Normaliza indicadores ofuscados ([.], hxxp, [@]) a su forma canónica y elimina bytes NUL."""
    cleaned = text.replace("\x00", "")
    for pattern, replacement in DEFANG_RULES:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned


def smart_chunk_page(text: str, chunk_size: int = 1200, overlap: int = 220) -> list[str]:
    """Limpia espacios, aplica refang y divide respetando finales de oración."""
    normalized = refang_text(text)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()

    if not normalized:
        return []

    chunks = []
    start = 0
    length = len(normalized)

    while start < length:
        end = min(start + chunk_size, length)
        if end < length:
            # Buscar límite natural (salto de línea o punto seguido de espacio)
            split_pos = max(
                normalized.rfind("\n", start + int(chunk_size * 0.6), end),
                normalized.rfind(". ", start + int(chunk_size * 0.6), end),
            )
            if split_pos != -1:
                end = split_pos + 1

        piece = normalized[start:end].strip()
        if piece:
            chunks.append(piece)

        if end >= length:
            break
        start = max(end - overlap, start + 1)

    return chunks


def extract_deterministic_indicators(full_text: str) -> dict:
    """Extrae CVEs, hashes SHA-256 y dominios candidatos sobre el texto completo."""
    refanged = refang_text(full_text)

    cves = sorted({m.upper() for m in CVE_RE.findall(refanged)})
    hashes = sorted({m.lower() for m in SHA256_RE.findall(refanged)})

    domains = set()
    for raw_dom in DOMAIN_RE.findall(refanged):
        dom = raw_dom.lower().rstrip(".")
        if dom not in BENIGN_DOMAINS and not any(dom.endswith(f".{b}") for b in BENIGN_DOMAINS):
            domains.add(dom)

    return {
        "cves": cves,
        "sha256": hashes,
        "domains": sorted(domains),
    }

