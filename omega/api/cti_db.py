"""Acceso compartido de solo lectura a PostgreSQL CTI para el worker forense.

Centraliza DB_DSN y las consultas deterministas sobre indicadores STIX 2.1
ingestados por backend-java (`omega_rag.ioc_indicators` / `omega_rag.campaigns`),
manteniendo compatibilidad de lectura con el corpus heredado (`public.iocs`) si existe.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def get_db_dsn() -> str:
    return (
        f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
        f"@{os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
    )


def get_connection() -> psycopg.Connection:
    return psycopg.connect(get_db_dsn())


def _has_relation(cur: psycopg.Cursor, regclass_name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL;", (regclass_name,))
    row = cur.fetchone()
    return bool(row and row[0])


def lookup_iocs_detailed(candidates: list[str]) -> list[dict[str, Any]]:
    """Cruza valores normalizados contra el catálogo de IOCs y campañas."""
    cleaned = sorted({str(c).strip().lower() for c in candidates if c and str(c).strip()})
    if not cleaned:
        return []

    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    with get_connection() as conn:
        with conn.cursor() as cur:
            if _has_relation(cur, "omega_rag.ioc_indicators"):
                cur.execute(
                    """
                    SELECT
                        i.ioc_type,
                        i.normalized_value,
                        i.context,
                        COALESCE(c.name, 'Sin campaña vinculada') AS campaign_name,
                        COALESCE(c.spyware_family, 'Desconocida') AS spyware_family,
                        COALESCE(i.source_report, COALESCE(c.source_feed, 'STIX 2.1')) AS report_title,
                        COALESCE(i.organization, 'Catálogo CTI OMEGA') AS organization,
                        COALESCE(i.source_url, '') AS source_url
                    FROM omega_rag.ioc_indicators i
                    LEFT JOIN omega_rag.campaigns c ON i.campaign_id = c.id
                    WHERE i.normalized_value = ANY(%s);
                    """,
                    (cleaned,),
                )
                for r in cur.fetchall():
                    key = (str(r[0]), str(r[1]), str(r[3]))
                    if key not in seen:
                        seen.add(key)
                        results.append(
                            {
                                "ioc_type": r[0],
                                "ioc_value": r[1],
                                "context": r[2],
                                "campaign": r[3],
                                "spyware_family": r[4],
                                "source_report": r[5],
                                "organization": r[6],
                                "source_url": r[7],
                            }
                        )

            if _has_relation(cur, "public.iocs"):
                cur.execute(
                    """
                    SELECT
                        i.ioc_type,
                        LOWER(i.ioc_value),
                        i.context,
                        COALESCE(c.name, 'Sin campaña vinculada') AS campaign_name,
                        COALESCE(c.spyware_family, 'Desconocida') AS spyware_family,
                        COALESCE(r.title, 'Corpus público CTI') AS report_title,
                        COALESCE(r.organization, 'Catálogo OMEGA') AS organization,
                        COALESCE(r.source_url, '') AS source_url
                    FROM public.iocs i
                    LEFT JOIN public.reports r ON i.report_id = r.id
                    LEFT JOIN public.campaigns c ON i.campaign_id = c.id
                    WHERE LOWER(i.ioc_value) = ANY(%s);
                    """,
                    (cleaned,),
                )
                for r in cur.fetchall():
                    key = (str(r[0]), str(r[1]), str(r[3]))
                    if key not in seen:
                        seen.add(key)
                        results.append(
                            {
                                "ioc_type": r[0],
                                "ioc_value": r[1],
                                "context": r[2],
                                "campaign": r[3],
                                "spyware_family": r[4],
                                "source_report": r[5],
                                "organization": r[6],
                                "source_url": r[7],
                            }
                        )

    return results


def lookup_ioc_families(
    candidates: list[str],
    ioc_types: tuple[str, ...] = ("ip", "domain"),
) -> dict[str, str]:
    cleaned = sorted({str(c).strip().lower() for c in candidates if c and str(c).strip()})
    if not cleaned:
        return {}

    matched_map: dict[str, str] = {}
    types_list = list(ioc_types)
    with get_connection() as conn:
        with conn.cursor() as cur:
            if _has_relation(cur, "omega_rag.ioc_indicators"):
                cur.execute(
                    """
                    SELECT i.normalized_value, COALESCE(c.spyware_family, 'Spyware')
                    FROM omega_rag.ioc_indicators i
                    LEFT JOIN omega_rag.campaigns c ON i.campaign_id = c.id
                    WHERE i.normalized_value = ANY(%s)
                      AND i.ioc_type = ANY(%s);
                    """,
                    (cleaned, types_list),
                )
                for val, fam in cur.fetchall():
                    matched_map[str(val).lower()] = str(fam)

            if _has_relation(cur, "public.iocs"):
                cur.execute(
                    """
                    SELECT LOWER(i.ioc_value), COALESCE(c.spyware_family, 'Spyware')
                    FROM public.iocs i
                    LEFT JOIN public.campaigns c ON i.campaign_id = c.id
                    WHERE LOWER(i.ioc_value) = ANY(%s)
                      AND i.ioc_type = ANY(%s);
                    """,
                    (cleaned, types_list),
                )
                for val, fam in cur.fetchall():
                    matched_map.setdefault(str(val).lower(), str(fam))

    return matched_map


def fetch_yara_iocs(limit: int = 180) -> list[tuple[str, str, str]]:
    """Obtiene hasta `limit` IOCs filtrados para compilar reglas YARA en RAM."""
    rows_out: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    allowed_types = ["domain", "process", "package", "file_path", "sha256"]

    with get_connection() as conn:
        with conn.cursor() as cur:
            if _has_relation(cur, "omega_rag.ioc_indicators"):
                cur.execute(
                    """
                    SELECT DISTINCT ON (i.normalized_value)
                        i.ioc_value,
                        i.ioc_type,
                        COALESCE(c.spyware_family, 'Spyware Comercial')
                    FROM omega_rag.ioc_indicators i
                    LEFT JOIN omega_rag.campaigns c ON i.campaign_id = c.id
                    WHERE i.ioc_type = ANY(%s)
                      AND LENGTH(TRIM(i.ioc_value)) >= 6
                      AND LENGTH(TRIM(i.ioc_value)) <= 140
                    ORDER BY i.normalized_value
                    LIMIT %s;
                    """,
                    (allowed_types, limit),
                )
                for val, ioc_type, fam in cur.fetchall():
                    key = str(val).strip().lower()
                    if key not in seen:
                        seen.add(key)
                        rows_out.append((str(val), str(ioc_type), str(fam)))

            if len(rows_out) < limit and _has_relation(cur, "public.iocs"):
                cur.execute(
                    """
                    SELECT DISTINCT ON (LOWER(i.ioc_value))
                        i.ioc_value,
                        i.ioc_type,
                        COALESCE(c.spyware_family, 'Spyware Comercial')
                    FROM public.iocs i
                    LEFT JOIN public.campaigns c ON i.campaign_id = c.id
                    WHERE i.ioc_type = ANY(%s)
                      AND LENGTH(TRIM(i.ioc_value)) >= 6
                      AND LENGTH(TRIM(i.ioc_value)) <= 140
                    ORDER BY LOWER(i.ioc_value)
                    LIMIT %s;
                    """,
                    (allowed_types, limit - len(rows_out)),
                )
                for val, ioc_type, fam in cur.fetchall():
                    key = str(val).strip().lower()
                    if key not in seen:
                        seen.add(key)
                        rows_out.append((str(val), str(ioc_type), str(fam)))

    return rows_out


def fetch_campaign_detection_bundle(
    campaign_id: str,
) -> tuple[dict[str, str] | None, list[tuple[str, str]], list[str], list[str]]:
    """Carga campaña e IOCs desde `omega_rag` o `public` para exportar reglas YARA / script MVT."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if _has_relation(cur, "omega_rag.campaigns"):
                cur.execute(
                    """
                    SELECT name, spyware_family, COALESCE(suspected_actor, 'No atribuido'),
                           COALESCE(source_feed, 'STIX 2.1')
                    FROM omega_rag.campaigns
                    WHERE id = %s::uuid;
                    """,
                    (campaign_id,),
                )
                camp = cur.fetchone()
                if camp:
                    cur.execute(
                        """
                        SELECT DISTINCT ioc_type, ioc_value
                        FROM omega_rag.ioc_indicators
                        WHERE campaign_id = %s::uuid
                        ORDER BY ioc_type, ioc_value
                        LIMIT 100;
                        """,
                        (campaign_id,),
                    )
                    iocs = [(str(r[0]), str(r[1])) for r in cur.fetchall()]
                    cur.execute(
                        """
                        SELECT DISTINCT source_url
                        FROM omega_rag.ioc_indicators
                        WHERE campaign_id = %s::uuid AND source_url IS NOT NULL AND source_url <> ''
                        LIMIT 5;
                        """,
                        (campaign_id,),
                    )
                    sources = [str(r[0]) for r in cur.fetchall()] or [str(camp[3])]
                    return (
                        {
                            "name": str(camp[0]),
                            "spyware_family": str(camp[1]),
                            "suspected_actor": str(camp[2]),
                        },
                        iocs,
                        [],
                        sources,
                    )

            if _has_relation(cur, "public.campaigns"):
                cur.execute(
                    """
                    SELECT name, spyware_family, COALESCE(suspected_actor, 'No atribuido')
                    FROM public.campaigns
                    WHERE id = %s::uuid;
                    """,
                    (campaign_id,),
                )
                camp = cur.fetchone()
                if camp:
                    cur.execute(
                        """
                        SELECT DISTINCT ioc_type, ioc_value
                        FROM public.iocs
                        WHERE campaign_id = %s::uuid
                        ORDER BY ioc_type, ioc_value
                        LIMIT 100;
                        """,
                        (campaign_id,),
                    )
                    iocs = [(str(r[0]), str(r[1])) for r in cur.fetchall()]
                    cur.execute(
                        """
                        SELECT DISTINCT cv.cve_code
                        FROM public.campaign_cves cc
                        JOIN public.cves cv ON cc.cve_id = cv.id
                        WHERE cc.campaign_id = %s::uuid;
                        """,
                        (campaign_id,),
                    )
                    cves = [str(r[0]) for r in cur.fetchall()]
                    cur.execute(
                        """
                        SELECT DISTINCT source_url
                        FROM public.reports
                        WHERE campaign_id = %s::uuid
                        LIMIT 5;
                        """,
                        (campaign_id,),
                    )
                    sources = [str(r[0]) for r in cur.fetchall()]
                    return (
                        {
                            "name": str(camp[0]),
                            "spyware_family": str(camp[1]),
                            "suspected_actor": str(camp[2]),
                        },
                        iocs,
                        cves,
                        sources,
                    )

    return None, [], [], []
