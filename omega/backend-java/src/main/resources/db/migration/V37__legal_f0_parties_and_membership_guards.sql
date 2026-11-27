-- Reverse:
-- DO $$
-- BEGIN
--     IF EXISTS (
--         SELECT 1
--           FROM omega_rag.workspace_memberships wm
--           JOIN omega_rag.users u ON u.id = wm.user_id
--           JOIN omega_rag.tenants root_t ON root_t.id = u.tenant_id
--          WHERE wm.tenant_id <> u.tenant_id
--            AND root_t.organization_id IS NULL
--     ) THEN
--         RAISE EXCEPTION 'Reversa V37 abortada: existen usuarios con cuenta raíz individual invitados a espacios de organización.';
--     END IF;
-- END;
-- $$;
-- DROP TRIGGER IF EXISTS trg_users_require_workspace_admin ON omega_rag.users;
-- DROP FUNCTION IF EXISTS omega_rag.prevent_deactivating_last_workspace_admin_user();
-- DROP TRIGGER IF EXISTS trg_workspace_memberships_require_admin ON omega_rag.workspace_memberships;
-- DROP FUNCTION IF EXISTS omega_rag.prevent_orphan_workspace_without_admin();
-- CREATE OR REPLACE FUNCTION omega_rag.validate_workspace_membership_integrity()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql
-- AS $$
-- DECLARE
--     user_root_tenant UUID;
--     user_org_id UUID;
--     target_org_id UUID;
-- BEGIN
--     SELECT u.tenant_id, rt.organization_id
--       INTO user_root_tenant, user_org_id
--       FROM omega_rag.users u
--       JOIN omega_rag.tenants rt ON rt.id = u.tenant_id
--      WHERE u.id = NEW.user_id;
--     IF user_root_tenant IS NULL THEN
--         RAISE EXCEPTION 'No existe el usuario % al validar workspace_memberships.', NEW.user_id;
--     END IF;
--     IF NEW.tenant_id = user_root_tenant THEN
--         RETURN NEW;
--     END IF;
--     SELECT t.organization_id
--       INTO target_org_id
--       FROM omega_rag.tenants t
--      WHERE t.id = NEW.tenant_id;
--     IF target_org_id IS NULL OR user_org_id IS NULL OR target_org_id <> user_org_id THEN
--         RAISE EXCEPTION
--             'Membresía rechazada: el usuario % (tenant raíz %, org %) no puede asignarse al espacio % (org %). Solo se permiten membresías en el espacio raíz o dentro de la misma organización.',
--             NEW.user_id, user_root_tenant, user_org_id, NEW.tenant_id, target_org_id;
--     END IF;
--     RETURN NEW;
-- END;
-- $$;
-- DELETE FROM omega_rag.legal_rate_limit_windows WHERE bucket_type NOT IN ('UPLOAD', 'QUERY');
-- ALTER TABLE omega_rag.legal_rate_limit_windows DROP CONSTRAINT IF EXISTS chk_legal_rate_limit_bucket_type;
-- ALTER TABLE omega_rag.legal_rate_limit_windows ALTER COLUMN bucket_type TYPE VARCHAR(24);
-- ALTER TABLE omega_rag.legal_rate_limit_windows
--     ADD CONSTRAINT legal_rate_limit_windows_bucket_type_check CHECK (bucket_type IN ('UPLOAD', 'QUERY'));
-- DROP TABLE IF EXISTS omega_rag.legal_case_parties;

-- 1. C1 / W2: Tabla de partes múltiples normalizadas por espacio y expediente
CREATE TABLE IF NOT EXISTS omega_rag.legal_case_parties (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    expediente_id UUID NOT NULL,
    party_role VARCHAR(20) NOT NULL
        CONSTRAINT chk_legal_case_parties_role
        CHECK (party_role IN ('CLIENT', 'COUNTERPARTY', 'OTHER')),
    display_name VARCHAR(200) NOT NULL,
    normalized_name VARCHAR(200) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_legal_case_parties_expediente
        FOREIGN KEY (tenant_id, expediente_id)
        REFERENCES omega_rag.expedientes (tenant_id, id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_case_parties_primary_role
    ON omega_rag.legal_case_parties (tenant_id, expediente_id, party_role)
    WHERE is_primary = TRUE AND party_role IN ('CLIENT', 'COUNTERPARTY');

CREATE INDEX IF NOT EXISTS idx_legal_case_parties_tenant_norm
    ON omega_rag.legal_case_parties (tenant_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_legal_case_parties_tenant_case
    ON omega_rag.legal_case_parties (tenant_id, expediente_id);

-- Backfill idempotente desde expedientes.client_name y counterparty_name
INSERT INTO omega_rag.legal_case_parties (id, tenant_id, expediente_id, party_role, display_name, normalized_name, is_primary)
SELECT
    gen_random_uuid(),
    e.tenant_id,
    e.id,
    'CLIENT',
    btrim(e.client_name),
    left(btrim(regexp_replace(
        regexp_replace(
            regexp_replace(
                lower(replace(replace(replace(
                    translate(
                        e.client_name,
                        'ÁÀÄÂÃÅáàäâãåÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇçÝŸýÿ',
                        'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyyy'
                    ),
                    'ß', 'ss'), 'Æ', 'ae'), 'æ', 'ae')),
                '[-/\\_]+', ' ', 'g'
            ),
            '[^a-z0-9\s]+', '', 'g'
        ),
        '\s+', ' ', 'g'
    )), 200),
    TRUE
FROM omega_rag.expedientes e
WHERE e.client_name IS NOT NULL
  AND btrim(e.client_name) <> ''
ON CONFLICT (tenant_id, expediente_id, party_role)
    WHERE is_primary = TRUE AND party_role IN ('CLIENT', 'COUNTERPARTY')
DO NOTHING;

INSERT INTO omega_rag.legal_case_parties (id, tenant_id, expediente_id, party_role, display_name, normalized_name, is_primary)
SELECT
    gen_random_uuid(),
    e.tenant_id,
    e.id,
    'COUNTERPARTY',
    btrim(e.counterparty_name),
    left(btrim(regexp_replace(
        regexp_replace(
            regexp_replace(
                lower(replace(replace(replace(
                    translate(
                        e.counterparty_name,
                        'ÁÀÄÂÃÅáàäâãåÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇçÝŸýÿ',
                        'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyyy'
                    ),
                    'ß', 'ss'), 'Æ', 'ae'), 'æ', 'ae')),
                '[-/\\_]+', ' ', 'g'
            ),
            '[^a-z0-9\s]+', '', 'g'
        ),
        '\s+', ' ', 'g'
    )), 200),
    TRUE
FROM omega_rag.expedientes e
WHERE e.counterparty_name IS NOT NULL
  AND btrim(e.counterparty_name) <> ''
ON CONFLICT (tenant_id, expediente_id, party_role)
    WHERE is_primary = TRUE AND party_role IN ('CLIENT', 'COUNTERPARTY')
DO NOTHING;

-- 2. C2: Ampliar legal_rate_limit_windows para ventanas por usuario en consultas de conflicto
ALTER TABLE omega_rag.legal_rate_limit_windows
    DROP CONSTRAINT IF EXISTS legal_rate_limit_windows_bucket_type_check,
    DROP CONSTRAINT IF EXISTS chk_legal_rate_limit_bucket_type;

ALTER TABLE omega_rag.legal_rate_limit_windows
    ALTER COLUMN bucket_type TYPE VARCHAR(64);

ALTER TABLE omega_rag.legal_rate_limit_windows
    ADD CONSTRAINT chk_legal_rate_limit_bucket_type
    CHECK (bucket_type IN ('UPLOAD', 'QUERY') OR bucket_type ~ '^CONFLICT:[0-9a-f-]{36}$');

-- 3. C6 / Decisión 4: Permitir invitar cuentas individuales existentes a espacios de una organización activa
CREATE OR REPLACE FUNCTION omega_rag.validate_workspace_membership_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    user_root_tenant UUID;
    user_org_id UUID;
    target_org_id UUID;
    target_org_active BOOLEAN;
BEGIN
    SELECT u.tenant_id, rt.organization_id
      INTO user_root_tenant, user_org_id
      FROM omega_rag.users u
      JOIN omega_rag.tenants rt ON rt.id = u.tenant_id
     WHERE u.id = NEW.user_id;

    IF user_root_tenant IS NULL THEN
        RAISE EXCEPTION 'No existe el usuario % al validar workspace_memberships.', NEW.user_id;
    END IF;

    IF NEW.tenant_id = user_root_tenant THEN
        RETURN NEW;
    END IF;

    SELECT t.organization_id, o.active
      INTO target_org_id, target_org_active
      FROM omega_rag.tenants t
      LEFT JOIN omega_rag.organizations o ON o.id = t.organization_id
     WHERE t.id = NEW.tenant_id;

    IF target_org_id IS NULL OR target_org_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'Membresía rechazada: el espacio destino % no pertenece a una organización activa.',
            NEW.tenant_id;
    END IF;

    IF user_org_id IS NOT NULL AND user_org_id <> target_org_id THEN
        RAISE EXCEPTION
            'Membresía rechazada: el usuario % (tenant raíz %, org %) no puede asignarse al espacio % (org %). No se permiten membresías cruzadas entre organizaciones distintas.',
            NEW.user_id, user_root_tenant, user_org_id, NEW.tenant_id, target_org_id;
    END IF;

    RETURN NEW;
END;
$$;

-- 4. C6: Impedir dejar un espacio activo (organizacional o sin clasificar) sin al menos un ADMIN activo
CREATE OR REPLACE FUNCTION omega_rag.prevent_orphan_workspace_without_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    tenant_is_active BOOLEAN;
    tenant_is_individual_standalone BOOLEAN;
    other_active_admin_exists BOOLEAN;
BEGIN
    IF OLD.role <> 'ADMIN' OR OLD.active IS DISTINCT FROM TRUE THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.role = 'ADMIN'
       AND NEW.active = TRUE
       AND NEW.tenant_id = OLD.tenant_id THEN
        RETURN NEW;
    END IF;

    SELECT t.active, (t.account_type = 'INDIVIDUAL' AND t.organization_id IS NULL)
      INTO tenant_is_active, tenant_is_individual_standalone
      FROM omega_rag.tenants t
     WHERE t.id = OLD.tenant_id;

    IF tenant_is_active IS DISTINCT FROM TRUE OR tenant_is_individual_standalone = TRUE THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM omega_rag.workspace_memberships wm
          JOIN omega_rag.users u ON u.id = wm.user_id
         WHERE wm.tenant_id = OLD.tenant_id
           AND wm.user_id <> OLD.user_id
           AND wm.active = TRUE
           AND wm.role = 'ADMIN'
           AND u.active = TRUE
    ) INTO other_active_admin_exists;

    IF NOT other_active_admin_exists THEN
        RAISE EXCEPTION
            'No se puede desactivar ni cambiar el rol del último ADMIN activo del espacio %.',
            OLD.tenant_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_memberships_require_admin ON omega_rag.workspace_memberships;
CREATE TRIGGER trg_workspace_memberships_require_admin
BEFORE UPDATE OR DELETE ON omega_rag.workspace_memberships
FOR EACH ROW
EXECUTE FUNCTION omega_rag.prevent_orphan_workspace_without_admin();

CREATE OR REPLACE FUNCTION omega_rag.prevent_deactivating_last_workspace_admin_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    orphan_tenant UUID;
BEGIN
    IF OLD.active IS DISTINCT FROM TRUE OR NEW.active = TRUE THEN
        RETURN NEW;
    END IF;

    SELECT wm.tenant_id
      INTO orphan_tenant
      FROM omega_rag.workspace_memberships wm
      JOIN omega_rag.tenants t ON t.id = wm.tenant_id
     WHERE wm.user_id = OLD.id
       AND wm.active = TRUE
       AND wm.role = 'ADMIN'
       AND t.active = TRUE
       AND NOT (t.account_type = 'INDIVIDUAL' AND t.organization_id IS NULL)
       AND NOT EXISTS (
           SELECT 1
             FROM omega_rag.workspace_memberships wm2
             JOIN omega_rag.users u2 ON u2.id = wm2.user_id
            WHERE wm2.tenant_id = wm.tenant_id
              AND wm2.user_id <> OLD.id
              AND wm2.active = TRUE
              AND wm2.role = 'ADMIN'
              AND u2.active = TRUE
       )
     LIMIT 1;

    IF orphan_tenant IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede desactivar al usuario % porque es el último ADMIN activo del espacio %.',
            OLD.id, orphan_tenant;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_require_workspace_admin ON omega_rag.users;
CREATE TRIGGER trg_users_require_workspace_admin
BEFORE UPDATE OF active ON omega_rag.users
FOR EACH ROW
EXECUTE FUNCTION omega_rag.prevent_deactivating_last_workspace_admin_user();
