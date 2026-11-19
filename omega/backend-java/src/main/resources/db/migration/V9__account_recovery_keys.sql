CREATE TABLE omega_rag.account_recovery_keys (
    user_id UUID PRIMARY KEY REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
