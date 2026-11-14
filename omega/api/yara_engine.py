"""Motor YARA nativo en RAM (libyara / yara-python) con respaldo determinístico.

Compila reglas `.yar` de spyware móvil (Pegasus, Predator/Cytrox, Triangulation,
NoviSpy), spyware de escritorio (Candiru/DevilsTongue, Wintego Helios) e IOCs
vivos de PostgreSQL directamente en memoria volátil sin escribir artefactos en disco.
"""

from __future__ import annotations

import re
import time
from typing import Any

from cti_db import fetch_yara_iocs

try:
    import yara  # type: ignore

    HAS_YARA_PYTHON = True
    YARA_VERSION = getattr(yara, "__version__", "4.x")
except ImportError:  # pragma: no cover - fallback cuando yara-python no está presente
    yara = None
    HAS_YARA_PYTHON = False
    YARA_VERSION = "fallback"

SAFE_YARA_EXCLUSIONS = frozenset({
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "apple.com",
    "icloud.com",
    "google.com",
    "gstatic.com",
    "googleapis.com",
    "android.com",
    "microsoft.com",
    "windows.com",
    "windowsupdate.com",
    "system32",
    "explorer.exe",
    "svchost.exe",
})

BUILTIN_YARA_RULES_META: dict[str, dict[str, str]] = {
    "Pegasus_FORCEDENTRY_ZeroClick_Chain": {
        "family": "NSO Pegasus",
        "cve": "CVE-2021-30860 / FORCEDENTRY",
        "severity": "CRITICAL",
        "description": (
            "Indicadores de explotación zero-click FORCEDENTRY / JBIG2 contra "
            "IMTranscoderAgent o BlastDoor en iMessage."
        ),
    },
    "Pegasus_Mobile_Implants_And_Daemons": {
        "family": "NSO Pegasus",
        "cve": "MITRE M1049 / Pegasus",
        "severity": "CRITICAL",
        "description": (
            "Artefactos binarios, rutas volátiles o nombres de procesos asociados a "
            "implantes móviles de NSO Group (roleaboutd, BridgeHead, staging.sqlite)."
        ),
    },
    "Operation_Triangulation_TriangleDB": {
        "family": "Operation Triangulation",
        "cve": "CVE-2023-32434 / TriangleDB",
        "severity": "CRITICAL",
        "description": (
            "Marcadores de cadena Operation Triangulation / TriangleDB: abuso de "
            "IMTranscoderAgent o osanalyticshelper con carga Mach-O en /var/tmp."
        ),
    },
    "Predator_Cytrox_Mobile_Implant": {
        "family": "Predator / Cytrox",
        "cve": "CVE-2023-41993 / Predator",
        "severity": "CRITICAL",
        "description": (
            "Rastros de librería nativa o persistencia Alien/Predator (libalien, "
            "libpredator, taurus/cytrox) en Android o iOS."
        ),
    },
    "NoviSpy_Android_Agent": {
        "family": "NoviSpy (Android)",
        "cve": "Amnesty / Serbia NoviSpy",
        "severity": "CRITICAL",
        "description": (
            "Indicadores del implante Android NoviSpy desplegado mediante extracción "
            "física o depuración USB no autorizada."
        ),
    },
    "Candiru_DevilsTongue_Desktop_Implant": {
        "family": "Candiru / DevilsTongue",
        "cve": "CVE-2021-33771 / CVE-2021-31979",
        "severity": "CRITICAL",
        "description": (
            "Indicadores de DevilsTongue/Candiru en Windows: artefactos AgentService.dat, "
            "secuestro fuera de wbem\\wmiutils.dll o persistencia WMI anómala."
        ),
    },
    "Wintego_Helios_Desktop_Agent": {
        "family": "Wintego / Helios",
        "cve": "Citizen Lab / Helios",
        "severity": "HIGH",
        "description": (
            "Cadenas o módulos de vigilancia de escritorio compatibles con Wintego Helios "
            "y recolectores pasivos de credenciales/sesiones."
        ),
    },
    "Malicious_Mobile_Config_Profile": {
        "family": "Spyware / MDM Abuse",
        "cve": "Perfiles .mobileconfig / CA Root",
        "severity": "HIGH",
        "description": (
            "Perfil de configuración móvil con servidor MDM externo, VPN oculta o "
            "instalación de certificado raíz no estándar para intercepción HTTPS."
        ),
    },
}

CORE_YARA_SOURCE = r"""
rule Pegasus_FORCEDENTRY_ZeroClick_Chain {
    meta:
        family = "NSO Pegasus"
        cve = "CVE-2021-30860 / FORCEDENTRY"
        severity = "CRITICAL"
    strings:
        $jbig = "jbig2dec" nocase ascii wide
        $pdf_header = "%PDF-1." ascii
        $imt = "IMTranscoderAgent" ascii wide
        $bd = "BlastDoorService" ascii wide
        $exc = "EXC_BAD_ACCESS" ascii
        $com_sms = "com.apple.MobileSMS" ascii wide
        $kismet = "com.apple.kismet" ascii wide
    condition:
        $kismet or ($jbig and ($imt or $pdf_header)) or ($exc and ($imt or $bd) and $com_sms)
}

rule Pegasus_Mobile_Implants_And_Daemons {
    meta:
        family = "NSO Pegasus"
        cve = "MITRE M1049 / Pegasus"
        severity = "CRITICAL"
    strings:
        $bh1 = "BridgeHead" ascii wide
        $bh2 = "roleaboutd" ascii wide
        $bh3 = "staging.sqlite" ascii wide
        $bh4 = "libimagent" ascii wide
        $bh5 = "com.apple.diagnosticd.plist" ascii wide
        $var_tmp = "/private/var/tmp/" ascii
        $macho = { CF FA ED FE }
        $macho_rev = { FE ED FA CF }
    condition:
        ($bh1 and ($bh2 or $bh3 or $var_tmp))
        or $bh2
        or $bh3
        or ($bh5 and $var_tmp)
        or (($macho or $macho_rev) and ($bh1 or $bh4 or $var_tmp))
}

rule Operation_Triangulation_TriangleDB {
    meta:
        family = "Operation Triangulation"
        cve = "CVE-2023-32434 / TriangleDB"
        severity = "CRITICAL"
    strings:
        $tdb = "TriangleDB" ascii wide
        $os_helper = "osanalyticshelper" ascii wide
        $var_tmp = "/private/var/tmp/" ascii
        $sysdiagnose = "IMTranscoderAgent" ascii wide
        $jsc = "JavaScriptCore" ascii
        $exc = "EXC_BAD_ACCESS" ascii
    condition:
        $tdb or ($os_helper and $var_tmp) or ($sysdiagnose and $jsc and $exc and $var_tmp)
}

rule Predator_Cytrox_Mobile_Implant {
    meta:
        family = "Predator / Cytrox"
        cve = "CVE-2023-41993 / Predator"
        severity = "CRITICAL"
    strings:
        $alien = "libalien" nocase ascii wide
        $pred = "libpredator" nocase ascii wide
        $cytrox = "cytrox" nocase ascii wide
        $tactic = "tacticus" nocase ascii wide
        $local_tmp = "/data/local/tmp/." ascii
        $elf = { 7F 45 4C 46 }
    condition:
        $alien or $pred or $cytrox or ($elf and $local_tmp and $tactic) or ($tactic and $local_tmp)
}

rule NoviSpy_Android_Agent {
    meta:
        family = "NoviSpy (Android)"
        cve = "Amnesty / Serbia NoviSpy"
        severity = "CRITICAL"
    strings:
        $novi1 = "novispy" nocase ascii wide
        $novi2 = "com.novi." nocase ascii wide
        $novi3 = "bia_agent" nocase ascii wide
    condition:
        any of them
}

rule Candiru_DevilsTongue_Desktop_Implant {
    meta:
        family = "Candiru / DevilsTongue"
        cve = "CVE-2021-33771 / CVE-2021-31979"
        severity = "CRITICAL"
    strings:
        $dt1 = "DevilsTongue" nocase ascii wide
        $dt2 = "AgentService.dat" nocase ascii wide
        $sys32_wmi = "\\Windows\\System32\\wmiutils.dll" nocase ascii wide
        $wbem = "\\wbem\\wmiutils.dll" nocase ascii wide
        $wmi_bind = "__FilterToConsumerBinding" nocase ascii wide
        $wmi_cmd = "CommandLineEventConsumer" nocase ascii wide
        $wmi_scr = "ActiveScriptEventConsumer" nocase ascii wide
        $appdata = "\\AppData\\" nocase ascii wide
        $progdata = "\\ProgramData\\" nocase ascii wide
        $ps_enc = "-EncodedCommand" nocase ascii wide
    condition:
        $dt1
        or $dt2
        or ($sys32_wmi and not $wbem)
        or ($wmi_bind and ($wmi_cmd or $wmi_scr) and ($appdata or $progdata or $ps_enc))
}

rule Wintego_Helios_Desktop_Agent {
    meta:
        family = "Wintego / Helios"
        cve = "Citizen Lab / Helios"
        severity = "HIGH"
    strings:
        $w1 = "HeliosAgent" nocase ascii wide
        $w2 = "wintego" nocase ascii wide
        $w3 = "helios_core" nocase ascii wide
    condition:
        any of them
}

rule Malicious_Mobile_Config_Profile {
    meta:
        family = "Spyware / MDM Abuse"
        cve = "Perfiles .mobileconfig / CA Root"
        severity = "HIGH"
    strings:
        $mc1 = "com.apple.security.root" ascii
        $mc2 = "PayloadType" ascii
        $mc3 = "com.apple.mdm" ascii
        $http_p = "HTTPProxy" ascii
        $vpn = "com.apple.vpn.managed" ascii
        $untrusted = "CheckURL" ascii
    condition:
        $mc2 and (($mc1 and ($http_p or $untrusted)) or ($mc3 and $vpn))
}
"""

_YARA_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "compiled": None,
    "rules_count": len(BUILTIN_YARA_RULES_META),
    "db_ioc_lookup": {},
}


def _escape_yara_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "").replace("\r", "")


def _fetch_db_yara_iocs() -> list[tuple[str, str, str]]:
    """Extrae hasta 180 IOCs de alto valor desde PostgreSQL para compilación YARA en RAM."""
    try:
        rows = fetch_yara_iocs(limit=180)
        cleaned: list[tuple[str, str, str]] = []
        for val, ioc_type, family in rows:
            s = (val or "").strip()
            low = s.lower()
            if not s or low in SAFE_YARA_EXCLUSIONS:
                continue
            if any(ord(ch) < 32 for ch in s):
                continue
            cleaned.append((s, str(ioc_type), str(family)))
        return cleaned
    except Exception:
        return []


def compile_omega_yara_rules(force_refresh: bool = False) -> tuple[Any, dict[str, dict[str, str]], int]:
    """Compila reglas YARA nativas + IOCs dinámicos de PostgreSQL en memoria (cache 60s)."""
    now = time.monotonic()
    if (
        not force_refresh
        and _YARA_CACHE["compiled"] is not None
        and now < _YARA_CACHE["expires_at"]
    ):
        return (
            _YARA_CACHE["compiled"],
            _YARA_CACHE["db_ioc_lookup"],
            _YARA_CACHE["rules_count"],
        )

    db_iocs = _fetch_db_yara_iocs()
    db_lookup: dict[str, dict[str, str]] = {}
    rule_count = len(BUILTIN_YARA_RULES_META)

    if not HAS_YARA_PYTHON:
        _YARA_CACHE.update(
            {
                "expires_at": now + 60.0,
                "compiled": None,
                "rules_count": rule_count,
                "db_ioc_lookup": {v.lower(): {"value": v, "type": t, "family": f} for v, t, f in db_iocs},
            }
        )
        return None, _YARA_CACHE["db_ioc_lookup"], rule_count

    dynamic_lines: list[str] = []
    if db_iocs:
        dynamic_lines.append("rule Omega_Live_PostgreSQL_CTI_IOCs {")
        dynamic_lines.append("    meta:")
        dynamic_lines.append('        family = "CTI Catalog (STIX2)"')
        dynamic_lines.append('        cve = "PostgreSQL IOC Feed"')
        dynamic_lines.append('        severity = "CRITICAL"')
        dynamic_lines.append("    strings:")
        for idx, (val, ioc_type, family) in enumerate(db_iocs):
            escaped = _escape_yara_literal(val)
            ident = f"$db_{idx}"
            mod = "nocase ascii wide" if ioc_type != "file_path" else "ascii wide"
            dynamic_lines.append(f'        {ident} = "{escaped}" {mod}')
            db_lookup[ident] = {"value": val, "type": ioc_type, "family": family}
        dynamic_lines.append("    condition:")
        dynamic_lines.append("        any of them")
        dynamic_lines.append("}")
        rule_count += 1

    full_source = CORE_YARA_SOURCE + "\n\n" + "\n".join(dynamic_lines)
    try:
        compiled = yara.compile(source=full_source)
    except Exception:
        # Si un IOC en BD contiene sintaxis exótica, compila al menos las reglas base sin fallar
        compiled = yara.compile(source=CORE_YARA_SOURCE)
        db_lookup = {}
        rule_count = len(BUILTIN_YARA_RULES_META)

    _YARA_CACHE.update(
        {
            "expires_at": now + 60.0,
            "compiled": compiled,
            "rules_count": rule_count,
            "db_ioc_lookup": db_lookup,
        }
    )
    return compiled, db_lookup, rule_count


def _extract_matched_terms_yara4(match_obj: Any, db_lookup: dict[str, dict[str, str]]) -> tuple[list[str], str | None]:
    terms: list[str] = []
    resolved_family: str | None = None
    for s_match in getattr(match_obj, "strings", []):
        ident = getattr(s_match, "identifier", "")
        if ident in db_lookup:
            info = db_lookup[ident]
            terms.append(info["value"])
            if not resolved_family:
                resolved_family = info["family"]
        else:
            instances = getattr(s_match, "instances", []) or []
            sample = ""
            if instances:
                raw_bytes = getattr(instances[0], "matched_data", b"")
                try:
                    sample = raw_bytes.decode("utf-8", errors="ignore").strip()
                except Exception:
                    sample = ident
            terms.append(sample if sample and sample.isprintable() else ident)
    # Deduplica manteniendo orden
    seen: set[str] = set()
    uniq = []
    for t in terms:
        low = t.lower()
        if low not in seen:
            seen.add(low)
            uniq.append(t)
    return uniq[:12], resolved_family


def _fallback_scan(raw_bytes: bytes, text_lower: str, filename: str, db_lookup: dict[str, dict[str, str]]) -> list[dict]:
    """Respaldo mínimo determinístico si yara-python no estuviera disponible."""
    hits: list[dict] = []
    patterns = [
        ("Pegasus_FORCEDENTRY_ZeroClick_Chain", ("jbig2dec", "imtranscoderagent", "com.apple.kismet")),
        ("Pegasus_Mobile_Implants_And_Daemons", ("roleaboutd", "bridgehead", "staging.sqlite")),
        ("Operation_Triangulation_TriangleDB", ("triangledb",)),
        ("Predator_Cytrox_Mobile_Implant", ("libalien", "libpredator", "cytrox")),
        ("NoviSpy_Android_Agent", ("novispy", "com.novi.", "bia_agent")),
        ("Candiru_DevilsTongue_Desktop_Implant", ("devilstongue", "agentservice.dat")),
        ("Wintego_Helios_Desktop_Agent", ("heliosagent", "wintego", "helios_core")),
    ]
    for rule_name, needles in patterns:
        matched = [n for n in needles if n in text_lower]
        if matched:
            meta = BUILTIN_YARA_RULES_META[rule_name]
            hits.append(
                {
                    "rule_name": rule_name,
                    "spyware_family": meta["family"],
                    "family": meta["family"],
                    "cve": meta["cve"],
                    "severity": meta["severity"],
                    "description": meta["description"],
                    "artifact": filename,
                    "matched_strings": matched,
                    "engine": "fallback",
                    "yara_version": "fallback",
                }
            )
    for info in db_lookup.values():
        val = info["value"]
        if val.lower() in text_lower:
            hits.append(
                {
                    "rule_name": "Omega_Live_PostgreSQL_CTI_IOCs",
                    "spyware_family": info["family"],
                    "family": info["family"],
                    "cve": f"IOC DB ({info['type']})",
                    "severity": "CRITICAL",
                    "description": f"Indicador del catálogo CTI detectado en artefacto en RAM: {val}",
                    "artifact": filename,
                    "matched_strings": [val],
                    "engine": "fallback",
                    "yara_version": "fallback",
                }
            )
            break
    return hits


def scan_artifacts_with_yara(artifacts: list[dict[str, Any]], force_refresh: bool = False) -> list[dict[str, Any]]:
    """Escanea todos los artefactos en RAM usando yara-python compilado."""
    compiled, db_lookup, _ = compile_omega_yara_rules(force_refresh=force_refresh)
    findings: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()

    for art in artifacts or []:
        filename = str(art.get("filename") or "artefacto_ram")
        raw_bytes: bytes | None = art.get("raw_bytes")
        if raw_bytes is None and isinstance(art.get("bytes"), (bytes, bytearray)):
            raw_bytes = bytes(art["bytes"])
        text_content = art.get("content")
        if raw_bytes is None:
            if isinstance(text_content, bytes):
                raw_bytes = text_content
            elif isinstance(text_content, str):
                raw_bytes = text_content.encode("utf-8", errors="ignore")
            else:
                raw_bytes = b""

        if not raw_bytes:
            continue
        # Evita escanear dos veces dumps gigantes idénticos
        scan_slice = raw_bytes[: 4 * 1024 * 1024]

        if compiled is not None:
            try:
                matches = compiled.match(data=scan_slice, timeout=5)
            except Exception:
                matches = []
            for m in matches:
                rule_name = m.rule
                dedupe_key = (rule_name, filename)
                if dedupe_key in seen_keys:
                    continue
                seen_keys.add(dedupe_key)

                matched_terms, db_family = _extract_matched_terms_yara4(m, db_lookup)
                meta = BUILTIN_YARA_RULES_META.get(rule_name, {})
                m_meta = getattr(m, "meta", {}) or {}
                family = db_family or m_meta.get("family") or meta.get("family") or "Spyware Comercial"
                cve = m_meta.get("cve") or meta.get("cve") or "YARA Live Match"
                severity = m_meta.get("severity") or meta.get("severity") or "CRITICAL"
                description = meta.get("description") or (
                    f"Regla YARA {rule_name} activada en RAM con {len(matched_terms)} marcador(es)."
                )
                findings.append(
                    {
                        "rule_name": rule_name,
                        "spyware_family": family,
                        "family": family,
                        "cve": cve,
                        "severity": severity,
                        "description": description,
                        "artifact": filename,
                        "matched_strings": matched_terms,
                        "engine": "yara-python",
                        "yara_version": YARA_VERSION,
                    }
                )
        else:
            text_lower = scan_slice.decode("utf-8", errors="ignore").lower()
            for hit in _fallback_scan(scan_slice, text_lower, filename, db_lookup):
                dedupe_key = (hit["rule_name"], filename)
                if dedupe_key not in seen_keys:
                    seen_keys.add(dedupe_key)
                    findings.append(hit)

    return findings


def get_yara_engine_status() -> dict[str, Any]:
    """Expone estado del compilador YARA para diagnósticos y verificación."""
    _, _, rules_count = compile_omega_yara_rules()
    return {
        "yara_available": HAS_YARA_PYTHON,
        "engine": "yara-python" if HAS_YARA_PYTHON else "fallback",
        "version": YARA_VERSION,
        "rules_compiled": rules_count,
    }
