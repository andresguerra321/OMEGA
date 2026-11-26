CREATE TABLE omega_rag.google_identities (
    subject_hash VARCHAR(43) PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE omega_rag.google_auth_attempts (
    state VARCHAR(43) PRIMARY KEY,
    browser_hash VARCHAR(43) NOT NULL,
    action VARCHAR(8) NOT NULL CHECK (action IN ('LOGIN', 'REGISTER', 'LINK')),
    user_id UUID REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    registration JSONB,
    commercial_version VARCHAR(160),
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK ((action = 'LINK') = (user_id IS NOT NULL AND tenant_id IS NOT NULL)),
    CHECK ((action = 'REGISTER') = (registration IS NOT NULL))
);

CREATE INDEX google_auth_attempts_expiry_idx ON omega_rag.google_auth_attempts(expires_at);

-- Reverse
-- DROP TABLE omega_rag.google_auth_attempts;
-- DROP TABLE omega_rag.google_identities;
