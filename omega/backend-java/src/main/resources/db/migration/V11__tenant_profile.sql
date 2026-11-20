-- =============================================================================
-- V11: Perfil operativo del tenant (LEGAL, DEVELOPER, GENERAL)
-- Segura sobre datos existentes: asigna DEFAULT 'GENERAL' a tenants previos.
-- Reversible por diseño:
--   ALTER TABLE omega_rag.tenants DROP CONSTRAINT IF EXISTS chk_tenants_profile;
--   ALTER TABLE omega_rag.tenants DROP COLUMN IF EXISTS profile;
-- =============================================================================

ALTER TABLE omega_rag.tenants
    ADD COLUMN IF NOT EXISTS profile VARCHAR(20) NOT NULL DEFAULT 'GENERAL';

ALTER TABLE omega_rag.tenants
    DROP CONSTRAINT IF EXISTS chk_tenants_profile;

ALTER TABLE omega_rag.tenants
    ADD CONSTRAINT chk_tenants_profile CHECK (profile IN ('LEGAL', 'DEVELOPER', 'GENERAL'));
