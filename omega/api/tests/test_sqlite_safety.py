import logging
import sqlite3

import pytest

from behavioral_forensics import (
    _get_columns,
    _inspect_datausage_sqlite,
    _inspect_sqlite_behavioral,
    _inspect_tcc_sqlite,
)
from sqlite_safety import safe_identifier
from temporal_correlator import _extract_sqlite_timeline
from triage_orchestrator import _worker_a_messaging_sqlite


def _serialize_in_memory_db(setup_fn) -> bytes:
    conn = sqlite3.connect(":memory:")
    try:
        setup_fn(conn)
        conn.commit()
        return conn.serialize()
    finally:
        conn.close()


@pytest.mark.parametrize(
    "valid_name",
    ["ZPROCESS", "ZLIVEUSAGE", "access", "message_2", "Table_01"],
)
def test_safe_identifier_accepts_valid_names(valid_name):
    assert safe_identifier(valid_name) == valid_name


@pytest.mark.parametrize(
    "unsafe_name",
    [
        "",
        "access\" UNION SELECT sql,1,1 FROM sqlite_master--",
        "tbl; DROP TABLE message;--",
        "tbl name",
        "tbl\nnewline",
        "tbl-hyphen",
        "schema.table",
        None,
        123,
    ],
)
def test_safe_identifier_rejects_injection_payloads(unsafe_name):
    with pytest.raises(ValueError, match="Identificador SQLite no seguro"):
        safe_identifier(unsafe_name)  # type: ignore[arg-type]


def test_triage_worker_discards_malicious_table_name_and_keeps_valid_tables(caplog):
    def build_db(conn: sqlite3.Connection) -> None:
        conn.execute(
            'CREATE TABLE "access"" UNION SELECT sql,1,1 FROM sqlite_master--" (txt TEXT)'
        )
        conn.execute(
            'INSERT INTO "access"" UNION SELECT sql,1,1 FROM sqlite_master--" VALUES (?)',
            ("https://should-not-parse.invalid/exfil",),
        )
        conn.execute("CREATE TABLE sms_records (body TEXT)")
        conn.execute(
            "INSERT INTO sms_records VALUES (?)",
            ("Mensaje sospechoso con https://canary-c2.example/stage2",),
        )

    db_bytes = _serialize_in_memory_db(build_db)

    with caplog.at_level(logging.WARNING, logger="triage_orchestrator"):
        result = _worker_a_messaging_sqlite([{"filename": "craft.db", "bytes": db_bytes}])

    assert result["files_processed"] == 1
    assert "https://canary-c2.example/stage2" in result["tokens"]
    assert "https://should-not-parse.invalid/exfil" not in result["tokens"]
    assert any("Tabla SQLite descartada" in note for note in result["notes"])
    assert any("Tabla SQLite descartada" in rec.message for rec in caplog.records)


def test_behavioral_forensics_rejects_unsafe_table_identifiers():
    conn = sqlite3.connect(":memory:")
    try:
        unsafe = 'access" UNION SELECT sql,1,1 FROM sqlite_master--'
        with pytest.raises(ValueError, match="Identificador SQLite no seguro"):
            _get_columns(conn, unsafe)
        with pytest.raises(ValueError, match="Identificador SQLite no seguro"):
            _inspect_tcc_sqlite(conn, {"access": unsafe}, "tcc.db")
        with pytest.raises(ValueError, match="Identificador SQLite no seguro"):
            _inspect_datausage_sqlite(
                conn,
                {"zprocess": unsafe, "zliveusage": "ZLIVEUSAGE"},
                "net.db",
            )
    finally:
        conn.close()


def test_corrupt_sqlite_logs_debug_instead_of_silent_pass(caplog):
    corrupt_bytes = b"SQLite format 3\x00not-a-valid-btree-payload"

    with caplog.at_level(logging.DEBUG):
        beh_findings = _inspect_sqlite_behavioral("corrupt_beh.db", corrupt_bytes)
        tmp_events = _extract_sqlite_timeline(corrupt_bytes, "corrupt_tmp.db")

    assert beh_findings == []
    assert tmp_events == []
    messages = [rec.getMessage() for rec in caplog.records]
    assert any("corrupt_beh.db" in m for m in messages)
    assert any("corrupt_tmp.db" in m for m in messages)
