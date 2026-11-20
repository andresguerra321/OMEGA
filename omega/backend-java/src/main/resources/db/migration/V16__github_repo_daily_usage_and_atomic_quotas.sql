-- =============================================================================
-- Fase 4 (Cierre): Tope diario persistente por repositorio y soporte de
--                  reconciliación para entregas de webhook FAILED.
-- =============================================================================

CREATE TABLE IF NOT EXISTS omega_rag.github_repo_daily_usage (
    repo_full_name VARCHAR(255) NOT NULL,
    usage_date DATE NOT NULL,
    scans_used INTEGER NOT NULL DEFAULT 0 CHECK (scans_used >= 0),
    PRIMARY KEY (repo_full_name, usage_date)
);

ALTER TABLE omega_rag.github_webhook_deliveries
    ADD COLUMN IF NOT EXISTS event_type VARCHAR(64),
    ADD COLUMN IF NOT EXISTS payload_json TEXT,
    ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Reversibilidad:
-- ALTER TABLE omega_rag.github_webhook_deliveries DROP COLUMN IF EXISTS retry_count, DROP COLUMN IF EXISTS payload_json, DROP COLUMN IF EXISTS event_type;
-- DROP TABLE IF EXISTS omega_rag.github_repo_daily_usage;
