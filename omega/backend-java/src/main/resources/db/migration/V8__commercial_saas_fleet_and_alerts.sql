-- =============================================================================
-- Fase 8: Capa Comercial SaaS (Suscripciones, Flota de Dispositivos, Cuotas IA
--         y Registro de Despacho de Alertas Críticas)
-- =============================================================================

CREATE TABLE IF NOT EXISTS omega_rag.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    plan_code VARCHAR(24) NOT NULL DEFAULT 'PERSONAL'
        CHECK (plan_code IN ('PERSONAL', 'PRO', 'ENTERPRISE')),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELED')),
    max_devices INTEGER NOT NULL DEFAULT 3,
    monthly_ai_quota INTEGER NOT NULL DEFAULT 100,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subscriptions_tenant UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS omega_rag.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    device_uid VARCHAR(128) NOT NULL,
    hostname VARCHAR(200) NOT NULL,
    os_platform VARCHAR(64) NOT NULL DEFAULT 'unknown',
    sensor_version VARCHAR(40) NOT NULL DEFAULT '1.10.1',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT uq_devices_tenant_uid UNIQUE (tenant_id, device_uid),
    CONSTRAINT fk_devices_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.users (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_tenant_status
    ON omega_rag.devices (tenant_id, status, last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS omega_rag.ai_usage_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    period_ym VARCHAR(7) NOT NULL,
    cloud_queries_used INTEGER NOT NULL DEFAULT 0,
    vision_queries_used INTEGER NOT NULL DEFAULT 0,
    sovereign_queries_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ai_quota_tenant_user_period UNIQUE (tenant_id, user_id, period_ym),
    CONSTRAINT fk_ai_quota_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.users (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_quota_tenant_period
    ON omega_rag.ai_usage_quotas (tenant_id, period_ym);

CREATE TABLE IF NOT EXISTS omega_rag.alert_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID,
    channel VARCHAR(24) NOT NULL CHECK (channel IN ('WEBHOOK', 'TELEGRAM', 'EMAIL')),
    severity VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    delivered BOOLEAN NOT NULL DEFAULT FALSE,
    status_detail VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_dispatches_tenant_created
    ON omega_rag.alert_dispatches (tenant_id, created_at DESC);
