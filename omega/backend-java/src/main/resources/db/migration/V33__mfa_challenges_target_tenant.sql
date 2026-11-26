-- Phase 2a-2: bind MFA login challenges to the target workspace tenant_id so multi-workspace
-- logins issue a single-tid JWT for the requested workspace after 2FA verification.
-- Reverse:
-- ALTER TABLE omega_rag.mfa_challenges DROP COLUMN IF EXISTS target_tenant_id;

ALTER TABLE omega_rag.mfa_challenges
    ADD COLUMN IF NOT EXISTS target_tenant_id UUID REFERENCES omega_rag.tenants(id) ON DELETE CASCADE;
