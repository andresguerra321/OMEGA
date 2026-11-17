ALTER TABLE omega_rag.users
    ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mfa_method VARCHAR(20) NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS mfa_totp_secret VARCHAR(128),
    ADD COLUMN IF NOT EXISTS mfa_totp_pending_secret VARCHAR(128),
    ADD COLUMN IF NOT EXISTS mfa_backup_codes_json TEXT;

CREATE TABLE IF NOT EXISTS omega_rag.mfa_challenges (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL,
    method VARCHAR(20) NOT NULL,
    email_code_hash VARCHAR(64),
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_expires
    ON omega_rag.mfa_challenges (user_id, expires_at DESC);
