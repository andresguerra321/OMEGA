-- =============================================================================
-- Fase 4 (Hardening 5b/6): Estado de procesamiento en entregas de webhook
--                          para distinguir RECEIVED / PROCESSED / FAILED.
-- =============================================================================

ALTER TABLE omega_rag.github_webhook_deliveries
    ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED'));

-- Reversibilidad:
-- ALTER TABLE omega_rag.github_webhook_deliveries DROP COLUMN IF EXISTS status;
