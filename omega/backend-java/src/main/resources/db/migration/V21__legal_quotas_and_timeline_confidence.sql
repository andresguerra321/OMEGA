-- Q8 & Q5 hardening: persistent atomic rate-limiting/concurrency tables for multi-instance LEGAL deployments
-- and confidence metadata on legal_timeline_events.
-- Reverse (back up first):
--   ALTER TABLE omega_rag.legal_timeline_events DROP COLUMN IF EXISTS confidence_reason;
--   ALTER TABLE omega_rag.legal_timeline_events DROP COLUMN IF EXISTS confidence;
--   DROP TABLE IF EXISTS omega_rag.legal_indexing_inflight;
--   DROP TABLE IF EXISTS omega_rag.legal_rate_limit_windows;

CREATE TABLE IF NOT EXISTS omega_rag.legal_rate_limit_windows (
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    bucket_type VARCHAR(24) NOT NULL CHECK (bucket_type IN ('UPLOAD', 'QUERY')),
    window_minute TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, bucket_type, window_minute)
);

CREATE INDEX IF NOT EXISTS idx_legal_rate_limit_window_cleanup
    ON omega_rag.legal_rate_limit_windows(window_minute);

CREATE TABLE IF NOT EXISTS omega_rag.legal_indexing_inflight (
    reservation_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    expediente_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_indexing_inflight_tenant
    ON omega_rag.legal_indexing_inflight(tenant_id, created_at);

ALTER TABLE omega_rag.legal_timeline_events
    ADD COLUMN IF NOT EXISTS confidence VARCHAR(16) NOT NULL DEFAULT 'HIGH'
        CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
    ADD COLUMN IF NOT EXISTS confidence_reason VARCHAR(200) NOT NULL DEFAULT '';
