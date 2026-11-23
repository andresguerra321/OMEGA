-- V25: Pilot Launch Roadmap (Phases 1 to 3)
-- 1. Zero-PII product telemetry events (aggregated activation funnel milestones)
-- 2. Signed team email invitations with 72h expiration and SHA-256 token hash
-- 3. Sanitized in-app support tickets

CREATE TABLE IF NOT EXISTS omega_rag.product_telemetry_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID,
    profile VARCHAR(24) NOT NULL DEFAULT 'GENERAL',
    event_name VARCHAR(64) NOT NULL,
    properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_telemetry_tenant_event
    ON omega_rag.product_telemetry_events(tenant_id, event_name, created_at DESC);

CREATE TABLE IF NOT EXISTS omega_rag.tenant_invitations (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('ADMIN', 'ANALYST', 'CLIENT')),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    invited_by UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant
    ON omega_rag.tenant_invitations(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS omega_rag.support_tickets (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    category VARCHAR(32) NOT NULL CHECK (category IN ('BUG', 'FALSE_POSITIVE', 'UX', 'BILLING')),
    summary VARCHAR(2000) NOT NULL,
    current_view VARCHAR(120) NOT NULL DEFAULT '',
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant
    ON omega_rag.support_tickets(tenant_id, created_at DESC);
