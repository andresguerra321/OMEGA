#!/usr/bin/env python3
"""Evaluador determinista de resultados Semgrep SAST para OMEGA.

Separa:
1. Errores fatales del escáner (nunca pasan silenciosamente como éxito).
2. Riesgos explícitamente aceptados/triados en `semgrep-accepted-risks.json`.
3. Deuda preexistente en `semgrep-baseline.json`.
4. Hallazgos nuevos (bloqueando según el modo de enforcement configurado).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

NON_FATAL_PARSER_TYPES = {"PartialParsing", "Internal matching error"}


def normalize_path(raw: str) -> str:
    return raw.replace("\\", "/").lstrip("./")


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def evaluate_report(
    report: dict[str, Any],
    *,
    semgrep_rc: int = 0,
    accepted_risks: list[dict[str, Any]] | None = None,
    baseline_findings: list[dict[str, Any]] | None = None,
    mode: str = "enforce-new-error",
) -> tuple[int, dict[str, Any], str]:
    if semgrep_rc >= 2:
        msg = f"::error::Semgrep falló con código de error técnico ({semgrep_rc})."
        return 2, {"scanner_fatal": True, "semgrep_rc": semgrep_rc}, msg

    errors = report.get("errors", []) or []
    fatal_errors = []
    parser_warnings = []
    for err in errors:
        err_type = str(err.get("type") or "")
        # Semgrep serializa PartialParsing como ["PartialParsing", ...] o "PartialParsing"
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

    accepted_map: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in accepted_risks or []:
        cid = str(entry.get("check_id") or "").strip()
        p = normalize_path(str(entry.get("path") or ""))
        if cid and p:
            accepted_map[(cid, p)] = entry

    baseline_counts: Counter[tuple[str, str]] = Counter()
    for entry in baseline_findings or []:
        cid = str(entry.get("check_id") or "").strip()
        p = normalize_path(str(entry.get("path") or ""))
        if cid and p:
            baseline_counts[(cid, p)] += int(entry.get("count", 1))

    results = report.get("results", []) or []
    accepted_matches: list[dict[str, Any]] = []
    preexisting_matches: list[dict[str, Any]] = []
    new_matches: list[dict[str, Any]] = []

    seen_for_baseline: Counter[tuple[str, str]] = Counter()
    for item in results:
        cid = str(item.get("check_id") or "").strip()
        p = normalize_path(str(item.get("path") or ""))
        key = (cid, p)
        if key in accepted_map:
            accepted_matches.append(item)
            continue
        seen_for_baseline[key] += 1
        if seen_for_baseline[key] <= baseline_counts.get(key, 0):
            preexisting_matches.append(item)
        else:
            new_matches.append(item)

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
        f"- **Riesgos aceptados/triados:** `{len(accepted_matches)}`",
        f"- **Advertencias de parser no fatales:** `{len(parser_warnings)}`",
        "",
    ]

    if new_matches:
        lines.append("### Hallazgos nuevos detectados")
        lines.append("| Severidad | Regla | Archivo | Línea |")
        lines.append("| :--- | :--- | :--- | ---: |")
        for item in new_matches[:30]:
            sev = str(item.get("extra", {}).get("severity", "UNKNOWN")).upper()
            rule = item.get("check_id", "")
            path = item.get("path", "")
            line = item.get("start", {}).get("line", 0)
            lines.append(f"| `{sev}` | `{rule}` | `{path}` | {line} |")
        lines.append("")

    if accepted_matches:
        lines.append("### Riesgos aceptados documentados")
        for item in accepted_matches:
            cid = str(item.get("check_id") or "")
            p = normalize_path(str(item.get("path") or ""))
            meta = accepted_map.get((cid, p), {})
            lines.append(
                f"- `{cid}` en `{p}:{item.get('start', {}).get('line', 0)}` — `{meta.get('classification', 'ACCEPTED')}`"
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
    elif mode == "enforce" and active_sev.get("ERROR", 0) > 0:
        exit_code = 1
        lines.append(
            f"**GATE BLOQUEADO (`enforce`):** {active_sev['ERROR']} hallazgo(s) activo(s) de severidad ERROR."
        )
    else:
        lines.append("**GATE APROBADO:** Sin hallazgos bloqueantes bajo la política configurada.")

    metrics = {
        "scanner_fatal": False,
        "total_results": len(results),
        "new_count": len(new_matches),
        "new_error_count": new_sev.get("ERROR", 0),
        "new_warning_count": new_sev.get("WARNING", 0),
        "preexisting_count": len(preexisting_matches),
        "accepted_count": len(accepted_matches),
        "parser_warning_count": len(parser_warnings),
    }
    return exit_code, metrics, "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--exit-code", type=int, default=0)
    parser.add_argument("--accepted-risks", default=".github/security/semgrep-accepted-risks.json")
    parser.add_argument("--baseline", default=".github/security/semgrep-baseline.json")
    parser.add_argument("--mode", default="enforce-new-error")
    args = parser.parse_args()

    report_path = Path(args.report)
    if not report_path.is_file():
        print(f"::error::No se encontró el reporte Semgrep: {report_path}", file=sys.stderr)
        return 2

    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"::error::Reporte Semgrep JSON inválido: {exc}", file=sys.stderr)
        return 2

    accepted_doc = load_json(Path(args.accepted_risks), {}) or {}
    baseline_doc = load_json(Path(args.baseline), {}) or {}

    code, _, summary = evaluate_report(
        report,
        semgrep_rc=args.exit_code,
        accepted_risks=accepted_doc.get("accepted_risks", []),
        baseline_findings=baseline_doc.get("baseline_findings", []),
        mode=args.mode,
    )

    print(summary)
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as fh:
            fh.write(summary + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
