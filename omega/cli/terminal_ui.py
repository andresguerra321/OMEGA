"""Utilidades de salida en terminal (solo stdlib) con soporte TTY, NO_COLOR y fallback ASCII."""

from __future__ import annotations

import os
import sys
from typing import Any, Callable, TextIO


class TerminalRenderer:
    """Renderizador minimalista de consola sin dependencias externas."""

    def __init__(
        self,
        stream: TextIO | None = None,
        *,
        force_color: bool | None = None,
        force_ascii: bool | None = None,
    ) -> None:
        self.stream = stream or sys.stdout
        if force_color is not None:
            self.use_color = force_color
        else:
            no_color = os.environ.get("NO_COLOR", "") != ""
            is_tty = hasattr(self.stream, "isatty") and self.stream.isatty()
            self.use_color = bool(is_tty and not no_color)

        if force_ascii is not None:
            self.use_ascii = force_ascii
        else:
            encoding = (getattr(self.stream, "encoding", None) or "").lower()
            self.use_ascii = "utf" not in encoding

    def _c(self, code: str, text: str) -> str:
        if not self.use_color:
            return text
        return f"\x1b[{code}m{text}\x1b[0m"

    def red(self, text: str) -> str:
        return self._c("31", text)

    def amber(self, text: str) -> str:
        return self._c("33", text)

    def green(self, text: str) -> str:
        return self._c("32", text)

    def bold(self, text: str) -> str:
        return self._c("1", text)

    def dim(self, text: str) -> str:
        return self._c("2", text)

    @property
    def check_mark(self) -> str:
        return "[OK]" if self.use_ascii else "✓"

    def step(self, message: str) -> None:
        mark = self.green(self.check_mark)
        self.stream.write(f"{mark} {message}\n")

    def warn(self, message: str) -> None:
        tag = self.amber("[AVISO]" if self.use_ascii else "▲")
        self.stream.write(f"{tag} {message}\n")

    def error(self, message: str) -> None:
        tag = self.red("[ERROR]" if self.use_ascii else "✗")
        self.stream.write(f"{tag} {message}\n")

    def summary_box(self, title: str, rows: list[tuple[str, str]]) -> None:
        tl, tr, bl, br, hz, vt = (
            ("+", "+", "+", "+", "-", "|")
            if self.use_ascii
            else ("┌", "┐", "└", "┘", "─", "│")
        )
        key_width = max((len(k) for k, _ in rows), default=10)
        lines = [f"{k.ljust(key_width)} : {v}" for k, v in rows]
        inner_width = max([len(title), *(len(line) for line in lines)], default=24)

        self.stream.write(f"{tl}{hz * (inner_width + 2)}{tr}\n")
        self.stream.write(f"{vt} {self.bold(title.ljust(inner_width))} {vt}\n")
        self.stream.write(f"{vt}{hz * (inner_width + 2)}{vt}\n")
        for line in lines:
            self.stream.write(f"{vt} {line.ljust(inner_width)} {vt}\n")
        self.stream.write(f"{bl}{hz * (inner_width + 2)}{br}\n")

    def render_scan_result(
        self,
        result: dict[str, Any],
        *,
        sanitizer: Callable[[str], str],
    ) -> None:
        findings = list(result.get("findings") or [])
        score = int(result.get("score") or 0)
        files_scanned = int(result.get("files_scanned") or 0)
        scan_id = sanitizer(str(result.get("scan_id") or "local"))

        if not findings:
            verdict = self.green("Sin señales detectadas con las reglas actuales")
        elif any(str(f.get("severity", "")).upper() in ("CRITICAL", "HIGH") for f in findings):
            verdict = self.red(f"{len(findings)} señal(es) — revisión prioritaria")
        else:
            verdict = self.amber(f"{len(findings)} señal(es) — revisar evidencia")

        self.summary_box(
            "OMEGA Repo Scanner — Resumen",
            [
                ("Escaneo", scan_id),
                ("Archivos analizados", str(files_scanned)),
                ("Puntaje", f"{score}/100"),
                ("Estado", verdict),
            ],
        )

        breakdown = list(result.get("score_breakdown") or [])
        if breakdown:
            self.stream.write("\nDesglose de puntaje:\n")
            for item in breakdown:
                rule = sanitizer(str(item.get("rule_id") or item.get("signal") or "regla"))
                weight = item.get("weight", item.get("points", 0))
                self.stream.write(f"  - {rule}: +{weight} pts\n")

        if findings:
            self.stream.write("\nHallazgos detectados:\n")
            for f in findings:
                sev = str(f.get("severity") or "MEDIUM").upper()
                rule_id = sanitizer(str(f.get("rule_id") or "OMEGA-RULE"))
                loc = sanitizer(str(f.get("location") or "repository-root"))
                expl = sanitizer(str(f.get("explanation") or ""))
                evid = sanitizer(str(f.get("evidence") or ""))
                sev_label = (
                    self.red(sev)
                    if sev in ("CRITICAL", "HIGH")
                    else self.amber(sev)
                    if sev == "MEDIUM"
                    else self.dim(sev)
                )
                self.stream.write(f"  [{sev_label}] {rule_id} ({loc})\n")
                if expl:
                    self.stream.write(f"    {expl}\n")
                if evid:
                    self.stream.write(f"    Evidencia: {evid}\n")

        limitations = list(result.get("limitations") or [])
        if limitations:
            self.stream.write("\nLimitaciones:\n")
            for lim in limitations:
                self.stream.write(f"  - {sanitizer(str(lim))}\n")
