-- Fase 6: Registro multi-tenant de activos propios para auditoría OSINT pasiva (RNF8)
CREATE TABLE IF NOT EXISTS omega_rag.osint_monitored_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants (id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    asset_type VARCHAR(50) NOT NULL CHECK (asset_type IN ('domain', 'institutional_email', 'organization')),
    asset_value VARCHAR(255) NOT NULL,
    explicit_consent BOOLEAN NOT NULL CHECK (explicit_consent = TRUE),
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ,
    CONSTRAINT uq_rag_osint_tenant_user_asset UNIQUE (tenant_id, user_id, asset_value),
    CONSTRAINT fk_rag_osint_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.users (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rag_osint_tenant_user
    ON omega_rag.osint_monitored_assets (tenant_id, user_id, consented_at DESC);
