-- =============================================================================
-- Fase 4 (Tarea 5a): Integración GitHub App (instalaciones, state de un solo
--                    uso y registro atómico anti-replay de webhooks).
-- =============================================================================

CREATE TABLE IF NOT EXISTS omega_rag.github_app_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL,
    account_login VARCHAR(120) NOT NULL DEFAULT '',
    selected_repos_json TEXT NOT NULL DEFAULT '[]',
    suspended_at TIMESTAMPTZ NULL,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_github_installation_id UNIQUE (installation_id),
    CONSTRAINT uq_github_installation_tenant UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS omega_rag.github_oauth_states (
    state_token VARCHAR(128) PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS omega_rag.github_webhook_deliveries (
    delivery_id VARCHAR(128) PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_webhook_deliveries_expires
    ON omega_rag.github_webhook_deliveries (expires_at);

-- Reversibilidad:
-- DROP TABLE IF EXISTS omega_rag.github_webhook_deliveries;
-- DROP TABLE IF EXISTS omega_rag.github_oauth_states;
-- DROP TABLE IF EXISTS omega_rag.github_app_installations;
