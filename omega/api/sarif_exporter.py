"""Exportador SARIF 2.1.0 para hallazgos del scanner estático de repositorios OMEGA."""

from __future__ import annotations

import re
from typing import Any

SARIF_SCHEMA_URL = (
    "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json"
)
SARIF_VERSION = "2.1.0"

# Límites oficiales documentados por GitHub Code Scanning (soft limit 5,000 / hard 25,000)
MAX_RESULTS_PER_RUN = 5000
MAX_RULES_PER_RUN = 25000

SEVERITY_TO_SARIF_LEVEL: dict[str, str] = {
    "CRITICAL": "error",
    "HIGH": "error",
    "MEDIUM": "warning",
    "LOW": "note",
}

SEVERITY_TO_SECURITY_SCORE: dict[str, str] = {
    "CRITICAL": "9.5",
    "HIGH": "7.5",
    "MEDIUM": "5.0",
    "LOW": "2.5",
}

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SECRET_RE = re.compile(
    r"(omega_scan_[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|sk-(?:proj-|ant-api03-)?[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|xox[baprs]-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{16,}|-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{12,})",
    re.IGNORECASE,
)

# Subconjunto estricto del esquema oficial OASIS SARIF 2.1.0 para validación offline en tests
SARIF_210_CORE_SCHEMA: dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["version", "runs"],
    "properties": {
        "$schema": {"type": "string"},
        "version": {"type": "string", "enum": ["2.1.0"]},
        "runs": {
            "type": "array",
            "minItems": 1,
            "maxItems": 20,
            "items": {
                "type": "object",
                "required": ["tool", "results"],
                "properties": {
                    "tool": {
                        "type": "object",
                        "required": ["driver"],
                        "properties": {
                            "driver": {
                                "type": "object",
                                "required": ["name", "rules"],
                                "properties": {
                                    "name": {"type": "string", "minLength": 1},
                                    "version": {"type": "string"},
                                    "rules": {
                                        "type": "array",
                                        "maxItems": MAX_RULES_PER_RUN,
                                        "items": {
                                            "type": "object",
                                            "required": ["id", "shortDescription"],
                                            "properties": {
                                                "id": {"type": "string", "minLength": 1},
                                                "shortDescription": {
                                                    "type": "object",
                                                    "required": ["text"],
                                                    "properties": {"text": {"type": "string"}},
                                                },
                                            },
                                        },
                                    },
                                },
                            }
                        },
                    },
                    "results": {
                        "type": "array",
                        "maxItems": MAX_RESULTS_PER_RUN,
                        "items": {
                            "type": "object",
                            "required": ["ruleId", "level", "message", "locations"],
                            "properties": {
                                "ruleId": {"type": "string", "minLength": 1},
                                "level": {
                                    "type": "string",
                                    "enum": ["none", "note", "warning", "error"],
                                },
                                "message": {
                                    "type": "object",
                                    "required": ["text"],
                                    "properties": {"text": {"type": "string", "minLength": 1}},
                                },
                                "locations": {
                                    "type": "array",
                                    "minItems": 1,
                                    "items": {
                                        "type": "object",
                                        "required": ["physicalLocation"],
                                        "properties": {
                                            "physicalLocation": {
                                                "type": "object",
                                                "required": ["artifactLocation"],
                                                "properties": {
                                                    "artifactLocation": {
                                                        "type": "object",
                                                        "required": ["uri"],
                                                        "properties": {
                                                            "uri": {"type": "string", "minLength": 1},
                                                            "uriBaseId": {"type": "string"},
                                                        },
                                                    },
                                                    "region": {
                                                        "type": "object",
                                                        "properties": {
                                                            "startLine": {"type": "integer", "minimum": 1}
                                                        },
                                                    },
                                                },
                                            }
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}


def sanitize_untrusted_text(value: Any, *, max_len: int = 1000) -> str:
    """Limpia texto proveniente del repositorio para evitar escapes ANSI, control chars y fugas de tokens."""
    text = str(value or "")
    text = _ANSI_RE.sub("", text)
    text = _CONTROL_RE.sub(" ", text)
    text = _SECRET_RE.sub("[REDACTED_TOKEN]", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text


def normalize_sarif_location(location: Any) -> tuple[str, int | None]:
    """Normaliza una ruta/ubicación a URI POSIX determinista relativa a %SRCROOT%."""
    raw = sanitize_untrusted_text(location, max_len=500).replace("\\", "/")
    line_num: int | None = None
    if ":" in raw:
        path_part, maybe_line = raw.rsplit(":", 1)
        if maybe_line.isdigit() and int(maybe_line) >= 1:
            line_num = int(maybe_line)
            raw = path_part

    segments = [seg for seg in raw.split("/") if seg and seg not in (".", "..")]
    uri = "/".join(segments) if segments else "repository-root"
    return uri, line_num


def _read_attr(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def scan_status_to_sarif(
    scan_status: Any,
    *,
    tool_version: str = "2.0.9",
) -> dict[str, Any]:
    """Convierte ScanStatus/dict de OMEGA a un documento SARIF 2.1.0 compatible con GitHub Code Scanning."""
    findings = list(_read_attr(scan_status, "findings", []) or [])[:MAX_RESULTS_PER_RUN]
    score = int(_read_attr(scan_status, "score", 0) or 0)
    breakdown = list(_read_attr(scan_status, "score_breakdown", []) or [])
    limitations = [
        sanitize_untrusted_text(item, max_len=400)
        for item in (_read_attr(scan_status, "limitations", []) or [])
    ]
    summary = sanitize_untrusted_text(
        _read_attr(scan_status, "summary", "")
        or (
            "Sin señales detectadas con las reglas actuales."
            if not findings
            else f"{len(findings)} señal(es) detectada(s)."
        ),
        max_len=500,
    )
    zero_retention_notice = sanitize_untrusted_text(
        _read_attr(
            scan_status,
            "zero_retention_notice",
            "Análisis estático en RAM/tmpfs; contenido purgado al finalizar.",
        ),
        max_len=300,
    )

    rules_by_id: dict[str, dict[str, Any]] = {}
    results: list[dict[str, Any]] = []

    for finding in findings:
        rule_id = sanitize_untrusted_text(_read_attr(finding, "rule_id", "OMEGA-RULE"), max_len=120) or "OMEGA-RULE"
        severity = str(_read_attr(finding, "severity", "MEDIUM") or "MEDIUM").upper()
        if severity not in SEVERITY_TO_SARIF_LEVEL:
            severity = "MEDIUM"
        confidence = float(_read_attr(finding, "confidence", 0.5) or 0.5)
        confidence = max(0.0, min(1.0, confidence))
        explanation = sanitize_untrusted_text(_read_attr(finding, "explanation", ""), max_len=1000)
        evidence = sanitize_untrusted_text(_read_attr(finding, "evidence", ""), max_len=1000)
        uri, line_num = normalize_sarif_location(_read_attr(finding, "location", "repository-root"))

        if rule_id not in rules_by_id and len(rules_by_id) < MAX_RULES_PER_RUN:
            rules_by_id[rule_id] = {
                "id": rule_id,
                "name": rule_id,
                "shortDescription": {"text": f"OMEGA Supply-Chain / Static Signal ({rule_id})"},
                "fullDescription": {"text": explanation or f"Detección estática para la regla {rule_id}."},
                "help": {
                    "text": (
                        f"{explanation or 'Revisar la señal reportada.'} "
                        "OMEGA nunca ejecuta código del repositorio; verifica manualmente la evidencia."
                    )
                },
                "defaultConfiguration": {"level": SEVERITY_TO_SARIF_LEVEL[severity]},
                "properties": {
                    "tags": ["security", "supply-chain", "omega"],
                    "security-severity": SEVERITY_TO_SECURITY_SCORE[severity],
                },
            }

        physical_location: dict[str, Any] = {
            "artifactLocation": {
                "uri": uri,
                "uriBaseId": "%SRCROOT%",
            }
        }
        if line_num is not None:
            physical_location["region"] = {"startLine": line_num}

        msg_text = explanation or f"Señal detectada por {rule_id}"
        if evidence:
            msg_text = f"{msg_text} | Evidencia: {evidence}"

        results.append(
            {
                "ruleId": rule_id,
                "level": SEVERITY_TO_SARIF_LEVEL[severity],
                "message": {"text": msg_text},
                "locations": [{"physicalLocation": physical_location}],
                "properties": {
                    "severity": severity,
                    "confidence": round(confidence, 3),
                    "evidence": evidence,
                },
            }
        )

    return {
        "$schema": SARIF_SCHEMA_URL,
        "version": SARIF_VERSION,
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "OMEGA Repo Scanner",
                        "version": tool_version,
                        "informationUri": "https://github.com/omega-cti/omega",
                        "rules": list(rules_by_id.values()),
                    }
                },
                "results": results,
                "properties": {
                    "omegaScore": score,
                    "omegaScoreBreakdown": breakdown,
                    "summary": summary,
                    "limitations": limitations,
                    "zeroRetentionNotice": zero_retention_notice,
                },
            }
        ],
    }


def validate_sarif_document(sarif_doc: dict[str, Any]) -> None:
    """Valida el documento SARIF 2.1.0 contra el esquema base usando jsonschema."""
    import jsonschema

    jsonschema.validate(instance=sarif_doc, schema=SARIF_210_CORE_SCHEMA)
