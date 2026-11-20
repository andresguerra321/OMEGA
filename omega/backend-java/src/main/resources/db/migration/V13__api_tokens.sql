-- =============================================================================
-- Fase 4 (Tarea 1): Tokens de API con alcance limitado (REPO_SCAN) y cuotas
--                   mensuales de escaneo de repositorios por plan.
-- =============================================================================

CREATE TABLE IF NOT EXISTS omega_rag.api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL,
    name VARCHAR(120) NOT NULL,
    token_prefix VARCHAR(24) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    scope VARCHAR(32) NOT NULL DEFAULT 'REPO_SCAN'
        CHECK (scope IN ('REPO_SCAN')),
    max_uses INTEGER NULL CHECK (max_uses IS NULL OR max_uses > 0),
    uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
    expires_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    last_used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_api_tokens_hash UNIQUE (token_hash),
    CONSTRAINT fk_api_tokens_user_same_tenant
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES omega_rag.users (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_tenant_revoked
    ON omega_rag.api_tokens (tenant_id, revoked_at, created_at DESC);

CREATE TABLE IF NOT EXISTS omega_rag.repo_scan_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    period_ym VARCHAR(7) NOT NULL,
    scans_used INTEGER NOT NULL DEFAULT 0 CHECK (scans_used >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_repo_scan_usage_tenant_period UNIQUE (tenant_id, period_ym)
);

-- Reversibilidad:
-- DROP TABLE IF EXISTS omega_rag.repo_scan_usage;
-- DROP TABLE IF EXISTS omega_rag.api_tokens;
