"""Capa 1 unificada de ingesta CTI hacia PostgreSQL (campaigns, reports, cves, iocs, document_chunks).

Comparte una única ruta idempotente de persistencia para reportes PDF, lotes STIX 2.1
(stix_ingestor.py) y fuentes web analizadas en RAM (web_intel_loader.py).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable
from uuid import UUID

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_DSN = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST', 'localhost')}:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)


def upsert_campaign(
    cur: psycopg.Cursor,
    *,
    name: str,
    spyware_family: str,
    suspected_actor: str | None = None,
    target_sector: str = "Periodistas, sociedad civil, activistas y gobierno",
    first_seen_date: str | None = None,
    summary: str = "",
) -> UUID:
    """Inserta o actualiza una campaña de spyware normalizada devolviendo su UUID."""
    cur.execute(
        """
        INSERT INTO campaigns (name, spyware_family, suspected_actor, target_sector, first_seen_date, summary)
        VALUES (%s, %s, %s, %s, %s::date, %s)
        ON CONFLICT (name) DO UPDATE SET
            spyware_family = EXCLUDED.spyware_family,
            suspected_actor = COALESCE(campaigns.suspected_actor, EXCLUDED.suspected_actor),
            first_seen_date = COALESCE(campaigns.first_seen_date, EXCLUDED.first_seen_date),
            summary = CASE
                WHEN LENGTH(COALESCE(campaigns.summary, '')) < LENGTH(COALESCE(EXCLUDED.summary, ''))
                THEN EXCLUDED.summary
                ELSE campaigns.summary
            END
        RETURNING id;
        """,
        (
            name[:255],
            spyware_family[:100],
            suspected_actor[:255] if suspected_actor else None,
            target_sector[:255],
            first_seen_date,
            summary,
        ),
    )
    return cur.fetchone()[0]


def upsert_report(
    cur: psycopg.Cursor,
    *,
    campaign_id: UUID | None,
    title: str,
    organization: str,
    publication_date: str | None,
    source_url: str,
    local_filename: str,
    file_hash: str,
) -> UUID:
    """Registra un reporte técnico o URL CTI sin duplicados (RNF5 via file_hash SHA-256)."""
    cur.execute(
        """
        INSERT INTO reports (title, organization, publication_date, source_url, local_filename, file_hash, campaign_id)
        VALUES (%s, %s, %s::date, %s, %s, %s, %s)
        ON CONFLICT (file_hash) DO UPDATE SET
            campaign_id = COALESCE(EXCLUDED.campaign_id, reports.campaign_id),
            title = EXCLUDED.title
        RETURNING id;
        """,
        (
            title[:500],
            organization[:150],
            publication_date,
            source_url,
            local_filename[:255],
            file_hash[:64],
            campaign_id,
        ),
    )
    return cur.fetchone()[0]


def bulk_upsert_iocs(
    cur: psycopg.Cursor,
    *,
    campaign_id: UUID | None,
    report_id: UUID,
    indicators: Iterable[tuple[str, str, str]],
) -> int:
    """Inserta lotes de IOCs deduplicados por (ioc_type, ioc_value, report_id)."""
    rows = [
        (campaign_id, report_id, str(ioc_type)[:50], str(ioc_val), str(ctx)[:250])
        for ioc_type, ioc_val, ctx in indicators
        if ioc_type and ioc_val
    ]
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO iocs (campaign_id, report_id, ioc_type, ioc_value, context)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (ioc_type, ioc_value, report_id) DO NOTHING;
        """,
        rows,
    )
    return len(rows)


def upsert_campaign_cves(
    cur: psycopg.Cursor,
    *,
    campaign_id: UUID,
    report_id: UUID,
    cve_codes: Iterable[str],
) -> int:
    """Registra CVEs en el catálogo y los vincula con la campaña/reporte."""
    count = 0
    for code in sorted({str(c).strip().upper() for c in cve_codes if c}):
        cur.execute(
            """
            INSERT INTO cves (cve_code)
            VALUES (%s)
            ON CONFLICT (cve_code) DO UPDATE SET cve_code = EXCLUDED.cve_code
            RETURNING id;
            """,
            (code[:30],),
        )
        cve_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO campaign_cves (campaign_id, cve_id, report_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (campaign_id, cve_id) DO NOTHING;
            """,
            (campaign_id, cve_id, report_id),
        )
        count += 1
    return count


def upsert_web_document_chunks(
    conn: psycopg.Connection,
    cur: psycopg.Cursor,
    *,
    report_id: UUID,
    title: str,
    text_chunks: list[str],
) -> int:
    """Indexa fragmentos limpios en document_chunks usando el embedder compartido de Preguntar."""
    cleaned_chunks = [c.strip() for c in text_chunks if c and len(c.strip()) >= 40]
    if not cleaned_chunks:
        return 0

    try:
        from pgvector.psycopg import register_vector
        from services import embedder

        register_vector(conn)
        vectors = embedder.encode(cleaned_chunks, normalize_embeddings=True)
    except Exception:
        return 0

    rows = [
        (
            report_id,
            idx,
            idx + 1,
            title[:255],
            chunk,
            vectors[idx].tolist(),
        )
        for idx, chunk in enumerate(cleaned_chunks)
    ]
    cur.executemany(
        """
        INSERT INTO document_chunks (report_id, chunk_index, page_number, section_title, content, embedding)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (report_id, chunk_index) DO NOTHING;
        """,
        rows,
    )
    return len(rows)

