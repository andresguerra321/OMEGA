import re

SPYWARE_FAMILIES = {
    "pegasus": "Pegasus (NSO Group)",
    "nso group": "Pegasus (NSO Group)",
    "nso": "Pegasus (NSO Group)",
    "predator": "Predator (Intellexa)",
    "intellexa": "Predator (Intellexa)",
    "cytrox": "Predator (Intellexa)",
    "candiru": "Candiru (Saito Tech)",
    "saito tech": "Candiru (Saito Tech)",
    "quadream": "QuaDream (Reign)",
    "kingspawn": "QuaDream (Reign)",
    "novispy": "NoviSpy",
    "helios": "Wintego Helios",
    "finfisher": "FinFisher (FinSpy)",
    "finspy": "FinFisher (FinSpy)",
}

FAMILY_TERMS_BY_CANONICAL: dict[str, tuple[str, ...]] = {
    "Pegasus (NSO Group)": ("pegasus", "nso", "forcedentry", "blastpass", "kismet"),
    "Predator (Intellexa)": ("predator", "intellexa", "cytrox", "alien"),
    "Candiru (Saito Tech)": ("candiru", "saito", "devil's tongue", "devils tongue"),
    "QuaDream (Reign)": ("quadream", "kingspawn", "reign"),
    "NoviSpy": ("novispy",),
    "Wintego Helios": ("helios", "wintego"),
    "FinFisher (FinSpy)": ("finfisher", "finspy"),
}

TARGET_PLATFORMS = {
    "windows": "Windows",
    "ios": "iOS",
    "iphone": "iOS",
    "ipad": "iOS",
    "ipados": "iOS",
    "imessage": "iOS",
    "android": "Android",
    "macos": "macOS",
    "linux": "Linux",
}

PLATFORM_KEYWORDS_BY_CANONICAL: dict[str, tuple[str, ...]] = {
    "Windows": ("windows", "win32", "win64"),
    "iOS": ("ios", "iphone", "ipad", "ipados", "imessage", "webkit", "safari"),
    "Android": ("android", "apk", "chrome"),
    "macOS": ("macos", "os x", "darwin"),
    "Linux": ("linux", "ubuntu", "elf"),
}

CVE_PATTERN = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE)

_SORTED_FAMILY_KEYS = sorted(SPYWARE_FAMILIES.keys(), key=len, reverse=True)
_SORTED_PLATFORM_KEYS = sorted(TARGET_PLATFORMS.keys(), key=len, reverse=True)


def _extract_entities_from_text(text: str) -> dict:
    low = (text or "").lower()

    found_family = None
    earliest_pos = len(low) + 1
    for key in _SORTED_FAMILY_KEYS:
        m = re.search(rf"\b{re.escape(key)}\b", low)
        if m and m.start() < earliest_pos:
            earliest_pos = m.start()
            found_family = SPYWARE_FAMILIES[key]

    found_os = None
    earliest_os_pos = len(low) + 1
    for key in _SORTED_PLATFORM_KEYS:
        m = re.search(rf"\b{re.escape(key)}\b", low)
        if m and m.start() < earliest_os_pos:
            earliest_os_pos = m.start()
            found_os = TARGET_PLATFORMS[key]

    cve_match = CVE_PATTERN.search(text or "")
    found_cve = cve_match.group(0).upper() if cve_match else None

    return {"family": found_family, "os": found_os, "cve": found_cve}


def resolve_conversational_context(
    query: str,
    history: list[dict] | None,
    pinned_context: dict | None = None,
) -> dict:
    """
    Resuelve el contexto activo combinando:
    1) Entidades explícitas en la pregunta actual (máxima prioridad en cambios de tema).
    2) Contexto fijado desde el Context Box de la interfaz.
    3) Entidades heredadas del historial cuando aún no hay estado explícito fijado.
    """
    history = history or []
    has_explicit_pin = isinstance(pinned_context, dict)
    pinned = pinned_context or {}
    current = _extract_entities_from_text(query)

    pinned_family = (pinned.get("family") or "").strip() or None
    pinned_os = (pinned.get("os") or "").strip() or None
    pinned_cve = (pinned.get("cve") or "").strip() or None

    family_switched = bool(current["family"] and pinned_family and current["family"] != pinned_family)
    os_switched = bool(current["os"] and pinned_os and current["os"] != pinned_os)

    if family_switched:
        resolved = {
            "family": current["family"],
            "os": current["os"],
            "cve": current["cve"],
        }
    else:
        resolved = {
            "family": current["family"] or pinned_family,
            "os": current["os"] or pinned_os,
            "cve": current["cve"] or (None if os_switched else pinned_cve),
        }

    # Solo recorrer historial si el cliente no envió estado explícito (ej. primer turno reanudado / API sin estado)
    if not has_explicit_pin:
        recent_turns = history[-6:]
        # Priorizar turnos del usuario para no heredar menciones incidentales del asistente
        ordered_turns = [
            *(t for t in reversed(recent_turns) if t.get("role") == "user"),
            *(t for t in reversed(recent_turns) if t.get("role") != "user"),
        ]
        for turn in ordered_turns:
            if resolved["family"] and (resolved["os"] or family_switched) and resolved["cve"]:
                break
            past = _extract_entities_from_text(turn.get("content", ""))
            if not resolved["family"] and past["family"]:
                resolved["family"] = past["family"]
                # Detener herencia de OS/CVE previos si pertenecen a una familia anterior distinta
                break
            if not resolved["os"] and past["os"] and not family_switched:
                resolved["os"] = past["os"]
            if not resolved["cve"] and past["cve"] and not family_switched and not os_switched:
                resolved["cve"] = past["cve"]

        # Completar OS/CVE dentro del último bloque coherente del historial si faltan
        for turn in reversed([t for t in recent_turns if t.get("role") == "user"]):
            if resolved["os"] and resolved["cve"]:
                break
            past = _extract_entities_from_text(turn.get("content", ""))
            if past["family"] and resolved["family"] and past["family"] != resolved["family"]:
                break
            if not resolved["os"] and past["os"] and not family_switched:
                resolved["os"] = past["os"]
            if not resolved["cve"] and past["cve"] and not family_switched and not os_switched:
                resolved["cve"] = past["cve"]

    return resolved


def rewrite_query_for_rrf(query: str, resolved_context: dict | None) -> str:
    """
    Ancla la búsqueda RRF a la familia activa (y CVE en foco) para recuperar siempre
    los reportes correctos, sin diluir los resultados inyectando plataformas heredadas
    que puedan no existir en el corpus de esa familia.
    """
    clean_q = (query or "").strip()
    if not resolved_context:
        return clean_q

    low_q = clean_q.lower()
    prefixes = []

    family = resolved_context.get("family")
    cve = resolved_context.get("cve")

    if family:
        terms = FAMILY_TERMS_BY_CANONICAL.get(family, (family.split()[0].lower(),))
        if not any(re.search(rf"\b{re.escape(t)}\b", low_q) for t in terms):
            prefixes.append(family)

    if cve and cve.lower() not in low_q:
        prefixes.append(cve)

    if not prefixes:
        return clean_q

    return f"{' · '.join(prefixes)}: {clean_q}"


def build_context_guardrail(resolved_context: dict | None) -> str:
    """
    Instrucción analítica y de aislamiento de entidades para evitar alucinaciones
    cruzadas y rechazos binarios secos cuando hay evidencia parcial sobre la familia.
    """
    if not resolved_context:
        return ""

    family = resolved_context.get("family")
    os_name = resolved_context.get("os")
    cve = resolved_context.get("cve")

    if not any([family, os_name, cve]):
        return ""

    lines = [
        "=== CONTEXTO CONVERSACIONAL ACTIVO ===",
        f"- Familia de spyware en foco: {family or 'No especificada'}",
        f"- Plataforma / dimensión consultada: {os_name or 'General'}",
        f"- CVE en foco: {cve or 'Ninguno'}",
        "REGLAS DE RESPUESTA ANALÍTICA Y VERACIDAD:",
        "1. Responde siempre manteniendo el foco en la 'Familia de spyware en foco'.",
        "2. PROHIBIDO atribuir a la familia activa técnicas, archivos o exploits que en los fragmentos pertenezcan a OTRO actor (ej. no atribuir técnicas de Candiru o Pegasus a Predator).",
        "3. Si los reportes indexados NO documentan actividad de la familia activa sobre la plataforma consultada (ej. Predator en Windows):",
        "   a) Declara de forma directa y transparente que los reportes indexados no documentan implantes ni ejecución nativa de esa familia en dicha plataforma.",
        "   b) A continuación, sintetiza con citas [n] qué plataformas y vectores SÍ están documentados en los fragmentos recuperados para esa familia (por ejemplo, Android/iOS, servidores de instalación/CNC o vectores de entrega) y qué alcance real se desprende de la evidencia disponible.",
        "4. Si ya respondiste con citas [n] documentando plataformas o vectores reales de la familia activa, PROHIBIDO añadir al final 'No hay evidencia suficiente en los reportes indexados para responder esta consulta.'.\n"
        "   Solo si los fragmentos recuperados carecen por completo de relación con el actor o tema consultado, responde únicamente 'No hay evidencia suficiente en los reportes indexados para responder esta consulta.'",
    ]
    return "\n".join(lines)


def get_family_filter_terms(family_label: str | None) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Devuelve (terminos_familia_activa, terminos_otras_familias) para reordenamiento RRF."""
    if not family_label:
        return (), ()
    active_terms = FAMILY_TERMS_BY_CANONICAL.get(
        family_label,
        tuple(w for w in re.findall(r"[a-z0-9]{3,}", family_label.lower())),
    )
    competing: list[str] = []
    for fam, terms in FAMILY_TERMS_BY_CANONICAL.items():
        if fam != family_label:
            for t in terms:
                if t not in active_terms and t not in competing:
                    competing.append(t)
    return active_terms, tuple(competing)

