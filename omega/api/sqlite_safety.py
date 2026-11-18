"""Shared SQLite identifier sanitization helpers for untrusted forensic dumps."""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path


def harden_connection(connection, instruction_limit=1_000_000):
    connection.enable_load_extension(False)
    connection.execute('PRAGMA trusted_schema=OFF')
    connection.execute('PRAGMA query_only=ON')
    remaining = [instruction_limit]
    def progress():
        remaining[0] -= 1000
        return int(remaining[0] <= 0)
    connection.set_progress_handler(progress, 1000)
    return connection


def open_readonly(path):
    return harden_connection(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=10))


def open_memory(raw):
    connection = sqlite3.connect(':memory:')
    try:
        connection.deserialize(raw)
        return harden_connection(connection)
    except Exception:
        connection.close()
        raise

SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_]+\Z")


def safe_identifier(name: str) -> str:
    """Validate that a dynamically discovered SQLite table or column name is safe to quote."""
    if not isinstance(name, str) or not SAFE_IDENTIFIER.fullmatch(name):
        raise ValueError(f"Identificador SQLite no seguro, se descarta: {name!r}")
    return name
