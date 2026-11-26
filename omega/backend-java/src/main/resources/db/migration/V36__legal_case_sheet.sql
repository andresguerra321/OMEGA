-- Reverse:
-- DROP INDEX IF EXISTS omega_rag.idx_expedientes_tenant_parties;
-- ALTER TABLE omega_rag.expedientes
--     DROP CONSTRAINT IF EXISTS chk_expedientes_process_type,
--     DROP COLUMN IF EXISTS client_name,
--     DROP COLUMN IF EXISTS counterparty_name,
--     DROP COLUMN IF EXISTS court_name,
--     DROP COLUMN IF EXISTS process_type,
--     DROP COLUMN IF EXISTS case_stage;

ALTER TABLE omega_rag.expedientes
    ADD COLUMN IF NOT EXISTS client_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS court_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS process_type VARCHAR(20)
        CONSTRAINT chk_expedientes_process_type
        CHECK (process_type IS NULL OR process_type IN (
            'CIVIL', 'LABORAL', 'PENAL', 'FAMILIA', 'ADMINISTRATIVO', 'COMERCIAL', 'OTRO'
        )),
    ADD COLUMN IF NOT EXISTS case_stage VARCHAR(60);

CREATE INDEX IF NOT EXISTS idx_expedientes_tenant_parties
    ON omega_rag.expedientes (tenant_id)
    WHERE client_name IS NOT NULL OR counterparty_name IS NOT NULL;
