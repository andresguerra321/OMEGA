-- V23: Endurecimiento Ola 1 de auditoría de seguridad (B-01, B-02, A-02).
-- 1) mfa_challenges: control de reenvíos y cooldown (resend_count, last_sent_at).
-- 2) password_reset_tokens: contador de intentos fallidos por token (attempts).
-- 3) auth_rate_limits: ventanas atómicas persistentes en PostgreSQL para LoginRateLimiter.
--
-- Reversa:
--   DROP INDEX IF EXISTS omega_rag.idx_auth_rate_limits_expires;
--   DROP TABLE IF EXISTS omega_rag.auth_rate_limits;
--   ALTER TABLE omega_rag.password_reset_tokens DROP COLUMN IF EXISTS attempts;
--   ALTER TABLE omega_rag.mfa_challenges
--     DROP COLUMN IF EXISTS last_sent_at,
--     DROP COLUMN IF EXISTS resend_count;

ALTER TABLE omega_rag.mfa_challenges
    ADD COLUMN IF NOT EXISTS resend_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

ALTER TABLE omega_rag.password_reset_tokens
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS omega_rag.auth_rate_limits (
    bucket_key        VARCHAR(255) PRIMARY KEY,
    attempt_count     INT          NOT NULL DEFAULT 0,
    window_expires_at TIMESTAMPTZ  NOT NULL,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expires
    ON omega_rag.auth_rate_limits (window_expires_at);
