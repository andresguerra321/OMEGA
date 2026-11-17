CREATE TABLE IF NOT EXISTS omega_rag.password_reset_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_user_created
    ON omega_rag.password_reset_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_hash
    ON omega_rag.password_reset_tokens (token_hash);
