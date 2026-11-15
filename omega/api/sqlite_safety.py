"""Shared SQLite identifier sanitization helpers for untrusted forensic dumps."""

from __future__ import annotations

import re

SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_]+\Z")


def safe_identifier(name: str) -> str:
    """Validate that a dynamically discovered SQLite table or column name is safe to quote."""
    if not isinstance(name, str) or not SAFE_IDENTIFIER.fullmatch(name):
        raise ValueError(f"Identificador SQLite no seguro, se descarta: {name!r}")
    return name
