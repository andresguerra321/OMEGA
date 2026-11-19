#!/usr/bin/env python3
"""Evaluador determinista y fail-closed de resultados Semgrep SAST para OMEGA.

Controles implementados:
1. Rechaza reportes ausentes, JSON inválido o códigos de salida técnicos >= 2.
2. Bloquea ante errores fatales del motor Semgrep (nunca pasan como éxito).
3. Identifica excepciones mediante fingerprint nativo (si existe) + SHA-256 del
   contexto de código normalizado (tolerante a desplazamientos de línea, resistente
   a nuevas vulnerabilidades en el mismo archivo y limitado 1:1 por ocurrencia).
4. Valida de forma fail-closed el esquema, responsable y caducidad de cada
   excepción en `semgrep-accepted-risks.json`.
5. Separa deuda preexistente (`semgrep-baseline.json`) de hallazgos nuevos y
   aplica la política de enforcement configurada (`enforce-new-error`,
   `enforce-all-error` u `observe`).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

NON_FATAL_PARSER_TYPES = {"PartialParsing", "Internal matching error"}
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
REQUIRED_EXCEPTION_FIELDS = (
    "check_id",
    "path",
    "classification",
    "justification",
    "owner",
    "reviewed_at",
    "expires_at",
)


def normalize_path(raw: str) -> str:
    return raw.replace("\\", "/").lstrip("./")


def _normalize_code_line(line: str) -> str:
    return " ".join(line.strip().split())


def compute_context_fingerprint(
    check_id: str,
    rel_path: str,
    start_line: int,
    end_line: int,
    *,
    repo_root: Path | None = None,
    sarif_snippet: str | None = None,
    extra_lines: str | None = None,
    start_col: int = 0,
) -> tuple[str, str]:
    """Devuelve `(context_sha256, source)` para identificar de forma estable un hallazgo.

    Usa las líneas del archivo en disco (hasta 3 líneas de contexto previo no vacío,
    la región coincidente y 1 línea posterior) para resistir cambios de número de línea
    sin permitir que código nuevo diferente o en otro método herede excepciones.
    """
    norm_path = normalize_path(rel_path)
    root = repo_root or Path(".")
    file_path = root / norm_path

    if file_path.is_file() and start_line > 0:
        try:
            all_lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
            s_idx = max(0, start_line - 1)
            e_idx = max(s_idx, min(len(all_lines) - 1, (end_line or start_line) - 1))

            before: list[str] = []
            cursor = s_idx - 1
            while cursor >= 0 and len(before) < 3:
                norm = _normalize_code_line(all_lines[cursor])
                if norm and not norm.startswith(("//", "#", "/*", "*")):
                    before.append(norm)
                cursor -= 1
            before.reverse()

            matched = [_normalize_code_line(l) for l in all_lines[s_idx : e_idx + 1] if _normalize_code_line(l)]

            after: list[str] = []
            cursor = e_idx + 1
            while cursor < len(all_lines) and len(after) < 1:
                norm = _normalize_code_line(all_lines[cursor])
                if norm and not norm.startswith(("//", "#", "/*", "*")):
                    after.append(norm)
                cursor += 1

            canonical = "\n".join(
                [
                    f"rule={check_id}",
                    f"path={norm_path}",
                    f"before={' | '.join(before)}",
                    f"match={' | '.join(matched)}",
                    f"after={' | '.join(after)}",
                ]
            )
            return hashlib.sha256(canonical.encode("utf-8")).hexdigest(), "source-context"
        except OSError:
            pass

    snippet = ""
    if sarif_snippet and sarif_snippet.strip():
        snippet = _normalize_code_line(sarif_snippet)
    elif extra_lines and extra_lines.strip() and extra_lines.strip() != "requires login":
        snippet = _normalize_code_line(extra_lines)

    if snippet:
        canonical = f"rule={check_id}\npath={norm_path}\nsnippet={snippet}"
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest(), "sarif-snippet"

    canonical = f"rule={check_id}\npath={norm_path}\nloc={start_line}:{start_col}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest(), "location-fallback"


def extract_sarif_snippets(sarif_path: Path | None) -> dict[tuple[str, str, int], str]:
    snippets: dict[tuple[str, str, int], str] = {}
    if not sarif_path or not sarif_path.is_file():
        return snippets
    try:
        sarif = json.loads(sarif_path.read_text(encoding="utf-8"))
        for run in sarif.get("runs", []) or []:
            for res in run.get("results", []) or []:
                rule_id = str(res.get("ruleId") or "").strip()
                for loc in res.get("locations", []) or []:
                    phys = loc.get("physicalLocation", {})
                    uri = normalize_path(str(phys.get("artifactLocation", {}).get("uri") or ""))
                    reg = phys.get("region", {})
                    line = int(reg.get("startLine") or 0)
                    text = str(reg.get("snippet", {}).get("text") or "")
                    if rule_id and uri and line and text:
                        snippets[(rule_id, uri, line)] = text
    except (OSError, json.JSONDecodeError, ValueError, TypeError):
        return {}
    return snippets


def validate_accepted_risks(
    entries: Any,
    *,
    reference_date: dt.date | None = None,
) -> list[dict[str, Any]]:
    """Valida de forma fail-closed las excepciones configuradas."""
    if entries is None:
        return []
    if not isinstance(entries, list):
        raise ValueError("`accepted_risks` debe ser una lista JSON.")

    today = reference_date or dt.datetime.now(dt.timezone.utc).date()
    validated: list[dict[str, Any]] = []

    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"Excepción #{idx} no es un objeto JSON válido.")
        for field in REQUIRED_EXCEPTION_FIELDS:
            val = entry.get(field)
            if not isinstance(val, str) or not val.strip():
                raise ValueError(f"Excepción #{idx} omite campo obligatorio `{field}`.")

        check_id = entry["check_id"].strip()
        path = normalize_path(entry["path"])
        if "*" in check_id or "*" in path:
            raise ValueError(f"Excepción #{idx} contiene comodines prohibidos (`*`): {check_id} / {path}.")

        if len(entry["justification"].strip()) < 20:
            raise ValueError(f"Excepción #{idx} requiere justificación técnica detallada (>= 20 caracteres).")

        ctx_sha = str(entry.get("context_sha256") or "").strip().lower()
        semgrep_fp = str(entry.get("semgrep_fingerprint") or "").strip()
        if semgrep_fp.lower() in {"requires login", "*"}:
            raise ValueError(f"Excepción #{idx} usa un fingerprint placeholder no válido (`{semgrep_fp}`).")
        if not ctx_sha and not semgrep_fp:
            raise ValueError(
                f"Excepción #{idx} ({check_id} en {path}) debe especificar `context_sha256` o `semgrep_fingerprint`."
            )
        if ctx_sha and not SHA256_RE.match(ctx_sha):
            raise ValueError(f"Excepción #{idx} tiene `context_sha256` inválido: `{ctx_sha}`.")

        try:
            reviewed_date = dt.date.fromisoformat(entry["reviewed_at"].strip())
            expires_date = dt.date.fromisoformat(entry["expires_at"].strip())
        except ValueError as exc:
            raise ValueError(f"Excepción #{idx} tiene fecha ISO inválida: {exc}") from exc

        if expires_date < reviewed_date:
            raise ValueError(f"Excepción #{idx} caduca antes de la fecha de revisión.")
        if expires_date < today:
            raise ValueError(
                f"Excepción #{idx} ({check_id} en {path}) caducó el {expires_date.isoformat()}; requiere nueva revisión."
            )

        max_occ = entry.get("max_occurrences", 1)
        if not isinstance(max_occ, int) or isinstance(max_occ, bool) or max_occ < 1:
            raise ValueError(f"Excepción #{idx} tiene `max_occurrences` inválido: {max_occ}")

        clean = dict(entry)
        clean["check_id"] = check_id
        clean["path"] = path
        clean["context_sha256"] = ctx_sha
        clean["semgrep_fingerprint"] = semgrep_fp
        clean["max_occurrences"] = max_occ
        validated.append(clean)

    return validated


def validate_baseline_findings(entries: Any) -> list[dict[str, Any]]:
    if entries is None:
        return []
    if not isinstance(entries, list):
        raise ValueError("`baseline_findings` debe ser una lista JSON.")
    validated: list[dict[str, Any]] = []
    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"Entrada de línea base #{idx} inválida.")
        check_id = str(entry.get("check_id") or "").strip()
        path = normalize_path(str(entry.get("path") or ""))
        ctx_sha = str(entry.get("context_sha256") or "").strip().lower()
        count = entry.get("count", 1)
        if not check_id or not path or not SHA256_RE.match(ctx_sha):
            raise ValueError(
                f"Entrada de línea base #{idx} requiere `check_id`, `path` y `context_sha256` SHA-256 válido."
            )
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise ValueError(f"Entrada de línea base #{idx} tiene `count` inválido: {count}")
        clean = dict(entry)
        clean["check_id"] = check_id
        clean["path"] = path
        clean["context_sha256"] = ctx_sha
        clean["count"] = count
        validated.append(clean)
    return validated


def evaluate_report(
    report: dict[str, Any],
    *,
    semgrep_rc: int = 0,
    accepted_risks: list[dict[str, Any]] | None = None,
    baseline_findings: list[dict[str, Any]] | None = None,
    mode: str = "enforce-new-error",
    repo_root: Path | None = None,
    sarif_snippets: dict[tuple[str, str, int], str] | None = None,
    reference_date: dt.date | None = None,
) -> tuple[int, dict[str, Any], str]:
    if mode not in {"observe", "enforce-new-error", "enforce-all-error"}:
        return 2, {"config_invalid": True}, f"::error::Modo de control inválido: `{mode}`."

    if semgrep_rc >= 2:
        msg = f"::error::Semgrep falló con código de error técnico ({semgrep_rc})."
        return 2, {"scanner_fatal": True, "semgrep_rc": semgrep_rc}, msg

    if not isinstance(report, dict) or "results" not in report or not isinstance(report.get("results"), list):
        return 2, {"scanner_fatal": True}, "::error::Reporte Semgrep incompleto: falta campo `results` válido."

    try:
        valid_accepted = validate_accepted_risks(accepted_risks, reference_date=reference_date)
        valid_baseline = validate_baseline_findings(baseline_findings)
    except ValueError as exc:
        msg = f"::error::Configuración de seguridad inválida (fail-closed): {exc}"
        return 2, {"config_invalid": True}, msg

    errors = report.get("errors", []) or []
    fatal_errors = []
    parser_warnings = []
    for err in errors:
        err_type = str(err.get("type") or "")
        if isinstance(err.get("type"), list) and err["type"]:
            err_type = str(err["type"][0])
        if any(token in err_type for token in NON_FATAL_PARSER_TYPES):
            parser_warnings.append(err)
        else:
            fatal_errors.append(err)

    if fatal_errors:
        lines = [
            f"::error::Semgrep reportó {len(fatal_errors)} error(es) fatal(es) de escaneo:"
        ]
        for err in fatal_errors[:10]:
            lines.append(f"  - {err.get('type')}: {err.get('message', '')}")
        return 2, {"scanner_fatal": True, "fatal_errors": fatal_errors}, "\n".join(lines)

    remaining_budget: dict[int, int] = {i: e["max_occurrences"] for i, e in enumerate(valid_accepted)}
    baseline_counts: Counter[tuple[str, str, str]] = Counter()
    for entry in valid_baseline:
        baseline_counts[(entry["check_id"], entry["path"], entry["context_sha256"])] += entry["count"]

    results = report.get("results", []) or []
    accepted_matches: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    preexisting_matches: list[dict[str, Any]] = []
    new_matches: list[dict[str, Any]] = []
    seen_baseline: Counter[tuple[str, str, str]] = Counter()
    snippets_map = sarif_snippets or {}

    for item in results:
        cid = str(item.get("check_id") or "").strip()
        p = normalize_path(str(item.get("path") or ""))
        start = item.get("start", {}) or {}
        end = item.get("end", {}) or {}
        start_line = int(start.get("line") or 0)
        start_col = int(start.get("col") or 0)
        end_line = int(end.get("line") or start_line)

        extra = item.get("extra", {}) or {}
        raw_fp = str(extra.get("fingerprint") or "").strip()
        has_native_fp = bool(raw_fp and raw_fp.lower() != "requires login")

        ctx_sha, fp_source = compute_context_fingerprint(
            cid,
            p,
            start_line,
            end_line,
            repo_root=repo_root,
            sarif_snippet=snippets_map.get((cid, p, start_line)),
            extra_lines=str(extra.get("lines") or ""),
            start_col=start_col,
        )

        matched_exc_idx = None
        for idx, exc in enumerate(valid_accepted):
            if remaining_budget[idx] <= 0:
                continue
            if exc["check_id"] != cid or exc["path"] != p:
                continue
            fp_ok = bool(exc["semgrep_fingerprint"] and has_native_fp and exc["semgrep_fingerprint"] == raw_fp)
            ctx_ok = bool(exc["context_sha256"] and exc["context_sha256"] == ctx_sha)
            if fp_ok or ctx_ok:
                matched_exc_idx = idx
                remaining_budget[idx] -= 1
                break

        item_annotated = dict(item)
        item_annotated["_context_sha256"] = ctx_sha
        item_annotated["_fp_source"] = fp_source

        if matched_exc_idx is not None:
            accepted_matches.append((item_annotated, valid_accepted[matched_exc_idx], ctx_sha))
            continue

        b_key = (cid, p, ctx_sha)
        seen_baseline[b_key] += 1
        if seen_baseline[b_key] <= baseline_counts.get(b_key, 0):
            preexisting_matches.append(item_annotated)
        else:
            new_matches.append(item_annotated)

    new_sev = Counter(
        str(r.get("extra", {}).get("severity", "UNKNOWN")).upper() for r in new_matches
    )
    pre_sev = Counter(
        str(r.get("extra", {}).get("severity", "UNKNOWN")).upper() for r in preexisting_matches
    )
    active_matches = preexisting_matches + new_matches
    active_sev = Counter(
        str(r.get("extra", {}).get("severity", "UNKNOWN")).upper() for r in active_matches
    )

    lines = [
        "## Semgrep SAST Summary (OMEGA)",
        "",
        f"- **Modo de control:** `{mode}`",
        f"- **Hallazgos totales crudos:** `{len(results)}`",
        f"- **Hallazgos nuevos:** `{len(new_matches)}` (`ERROR`: `{new_sev.get('ERROR', 0)}`, `WARNING`: `{new_sev.get('WARNING', 0)}`)",
        f"- **Deuda preexistente en línea base:** `{len(preexisting_matches)}` (`ERROR`: `{pre_sev.get('ERROR', 0)}`, `WARNING`: `{pre_sev.get('WARNING', 0)}`)",
        f"- **Riesgos aceptados (por fingerprint verificable):** `{len(accepted_matches)}`",
        f"- **Advertencias de parser no fatales:** `{len(parser_warnings)}`",
        "",
    ]

    if new_matches:
        lines.append("### Hallazgos nuevos detectados")
        lines.append("| Severidad | Regla | Archivo | Línea | Context SHA-256 |")
        lines.append("| :--- | :--- | :--- | ---: | :--- |")
        for item in new_matches[:30]:
            sev = str(item.get("extra", {}).get("severity", "UNKNOWN")).upper()
            rule = item.get("check_id", "")
            path = item.get("path", "")
            line = item.get("start", {}).get("line", 0)
            sha12 = item.get("_context_sha256", "")[:12]
            lines.append(f"| `{sev}` | `{rule}` | `{path}` | {line} | `{sha12}` |")
        lines.append("")

    if accepted_matches:
        lines.append("### Riesgos aceptados documentados")
        for item, meta, ctx_sha in accepted_matches:
            p = normalize_path(str(item.get("path") or ""))
            line = item.get("start", {}).get("line", 0)
            lines.append(
                f"- `{item.get('check_id')}` en `{p}:{line}` (ctx `{ctx_sha[:12]}`, {item.get('_fp_source')}) — "
                f"`{meta['classification']}` (owner: `{meta['owner']}`, vence: `{meta['expires_at']}`)"
            )
        lines.append("")

    exit_code = 0
    if mode == "enforce-new-error" and new_sev.get("ERROR", 0) > 0:
        exit_code = 1
        lines.append(
            f"**GATE BLOQUEADO (`enforce-new-error`):** {new_sev['ERROR']} hallazgo(s) nuevo(s) de severidad ERROR."
        )
    elif mode == "enforce-all-error" and active_sev.get("ERROR", 0) > 0:
        exit_code = 1
        lines.append(
            f"**GATE BLOQUEADO (`enforce-all-error`):** {active_sev['ERROR']} hallazgo(s) activo(s) de severidad ERROR."
        )
    else:
        lines.append("**GATE APROBADO:** Sin hallazgos bloqueantes bajo la política configurada.")

    metrics = {
        "scanner_fatal": False,
        "config_invalid": False,
        "total_results": len(results),
        "new_count": len(new_matches),
        "new_error_count": new_sev.get("ERROR", 0),
        "new_warning_count": new_sev.get("WARNING", 0),
        "preexisting_count": len(preexisting_matches),
        "accepted_count": len(accepted_matches),
        "parser_warning_count": len(parser_warnings),
        "fingerprints": [
            (r.get("check_id"), normalize_path(str(r.get("path") or "")), r.get("_context_sha256"))
            for r in active_matches
        ],
    }
    return exit_code, metrics, "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--sarif", default="")
    parser.add_argument("--exit-code", type=int, default=0)
    parser.add_argument("--accepted-risks", default=".github/security/semgrep-accepted-risks.json")
    parser.add_argument("--baseline", default=".github/security/semgrep-baseline.json")
    parser.add_argument("--mode", default="enforce-new-error")
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    report_path = Path(args.report)
    if not report_path.is_file():
        print(f"::error::No se encontró el reporte Semgrep: {report_path}", file=sys.stderr)
        return 2

    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        accepted_raw = json.loads(Path(args.accepted_risks).read_text(encoding="utf-8"))
        baseline_raw = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"::error::Error cargando reporte o configuración de seguridad (fail-closed): {exc}", file=sys.stderr)
        return 2

    if not isinstance(accepted_raw, dict) or not isinstance(baseline_raw, dict):
        print("::error::Los archivos de excepciones y línea base deben ser objetos JSON válidos.", file=sys.stderr)
        return 2

    sarif_path = Path(args.sarif) if args.sarif else None
    sarif_snippets = extract_sarif_snippets(sarif_path)

    code, _, summary = evaluate_report(
        report,
        semgrep_rc=args.exit_code,
        accepted_risks=accepted_raw.get("accepted_risks"),
        baseline_findings=baseline_raw.get("baseline_findings"),
        mode=args.mode,
        repo_root=Path(args.repo_root),
        sarif_snippets=sarif_snippets,
    )

    print(summary)
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as fh:
            fh.write(summary + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
