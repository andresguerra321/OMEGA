-- Organizations, multi-workspace memberships and shared billing account resolution (Phase 1); additive and compatible with standalone accounts.
-- Reverse (organization/membership metadata loss; back up first):
-- DO $$
-- BEGIN
--     IF EXISTS (
--         SELECT 1 FROM omega_rag.workspace_memberships wm
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = wm.tenant_id AND u.id = wm.user_id)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.expedientes e
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = e.tenant_id AND u.id = e.owner_user_id)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.expediente_permissions ep
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = ep.tenant_id AND u.id = ep.user_id)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.documents d
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = d.tenant_id AND u.id = d.uploaded_by)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.osint_monitored_assets oma
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = oma.tenant_id AND u.id = oma.user_id)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.devices dv
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = dv.tenant_id AND u.id = dv.user_id)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.ai_usage_quotas aq
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = aq.tenant_id AND u.id = aq.user_id)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.api_tokens atok
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = atok.tenant_id AND u.id = atok.created_by_user_id)
--     ) OR EXISTS (
--         SELECT 1 FROM omega_rag.legal_document_ai_consents lc
--          WHERE NOT EXISTS (SELECT 1 FROM omega_rag.users u WHERE u.tenant_id = lc.tenant_id AND u.id = lc.accepted_by)
--     ) THEN
--         RAISE EXCEPTION 'Reversa V30 abortada: existen membresías o dueños/actores cruzados entre tenants sin fila en omega_rag.users(tenant_id, id). Depura o reasigna antes de revertir.';
--     END IF;
-- END $$;
-- DROP TRIGGER IF EXISTS trg_tenants_protect_billing_payer ON omega_rag.tenants;
-- DROP FUNCTION IF EXISTS omega_rag.protect_billing_payer_tenant();
-- DROP TRIGGER IF EXISTS trg_organizations_validate_payer ON omega_rag.organizations;
-- DROP FUNCTION IF EXISTS omega_rag.validate_organization_billing_payer();
-- DROP TRIGGER IF EXISTS trg_users_sync_root_workspace_membership ON omega_rag.users;
-- DROP FUNCTION IF EXISTS omega_rag.sync_root_workspace_membership();
-- DROP INDEX IF EXISTS omega_rag.idx_credit_reservations_workspace_tenant_id;
-- ALTER TABLE omega_rag.credit_reservations DROP COLUMN IF EXISTS workspace_tenant_id;
-- DROP INDEX IF EXISTS omega_rag.idx_tenants_billing_tenant_id;
-- DROP INDEX IF EXISTS omega_rag.idx_tenants_organization_id;
-- ALTER TABLE omega_rag.tenants
--     DROP CONSTRAINT IF EXISTS fk_tenants_org_billing,
--     DROP CONSTRAINT IF EXISTS chk_tenants_org_billing_pair,
--     DROP CONSTRAINT IF EXISTS chk_tenants_device_limit_override,
--     DROP CONSTRAINT IF EXISTS chk_tenants_credit_limit_override,
--     DROP COLUMN IF EXISTS pre_v30_billing_history,
--     DROP COLUMN IF EXISTS device_limit_override,
--     DROP COLUMN IF EXISTS credit_limit_override,
--     DROP COLUMN IF EXISTS billing_tenant_id,
--     DROP COLUMN IF EXISTS organization_id;
-- ALTER TABLE omega_rag.legal_document_ai_consents DROP CONSTRAINT IF EXISTS fk_legal_ai_consent_user_same_tenant, ADD CONSTRAINT legal_document_ai_consents_tenant_id_accepted_by_fkey FOREIGN KEY (tenant_id, accepted_by) REFERENCES omega_rag.users(tenant_id, id) ON DELETE RESTRICT;
-- ALTER TABLE omega_rag.api_tokens DROP CONSTRAINT IF EXISTS fk_api_tokens_user_same_tenant, ADD CONSTRAINT fk_api_tokens_user_same_tenant FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES omega_rag.users(tenant_id, id) ON DELETE CASCADE;
-- ALTER TABLE omega_rag.ai_usage_quotas DROP CONSTRAINT IF EXISTS fk_ai_quota_user_same_tenant, ADD CONSTRAINT fk_ai_quota_user_same_tenant FOREIGN KEY (tenant_id, user_id) REFERENCES omega_rag.users(tenant_id, id) ON DELETE CASCADE;
-- ALTER TABLE omega_rag.devices DROP CONSTRAINT IF EXISTS fk_devices_user_same_tenant, ADD CONSTRAINT fk_devices_user_same_tenant FOREIGN KEY (tenant_id, user_id) REFERENCES omega_rag.users(tenant_id, id) ON DELETE CASCADE;
-- ALTER TABLE omega_rag.osint_monitored_assets DROP CONSTRAINT IF EXISTS fk_rag_osint_user_same_tenant, ADD CONSTRAINT fk_rag_osint_user_same_tenant FOREIGN KEY (tenant_id, user_id) REFERENCES omega_rag.users(tenant_id, id) ON DELETE CASCADE;
-- ALTER TABLE omega_rag.documents DROP CONSTRAINT IF EXISTS fk_documents_uploader_same_tenant, ADD CONSTRAINT fk_documents_uploader_same_tenant FOREIGN KEY (tenant_id, uploaded_by) REFERENCES omega_rag.users(tenant_id, id) ON DELETE RESTRICT;
-- ALTER TABLE omega_rag.expediente_permissions DROP CONSTRAINT IF EXISTS fk_exp_perm_user_same_tenant, ADD CONSTRAINT fk_exp_perm_user_same_tenant FOREIGN KEY (tenant_id, user_id) REFERENCES omega_rag.users(tenant_id, id) ON DELETE CASCADE;
-- ALTER TABLE omega_rag.expedientes DROP CONSTRAINT IF EXISTS fk_expedientes_owner_same_tenant, ADD CONSTRAINT fk_expedientes_owner_same_tenant FOREIGN KEY (tenant_id, owner_user_id) REFERENCES omega_rag.users(tenant_id, id) ON DELETE RESTRICT;
-- DROP TABLE IF EXISTS omega_rag.workspace_memberships; -- removes root backfill and multi-space memberships
-- DROP TABLE IF EXISTS omega_rag.organization_members;
-- DROP TABLE IF EXISTS omega_rag.organizations;

CREATE TABLE omega_rag.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE,
    billing_tenant_id UUID NOT NULL UNIQUE REFERENCES omega_rag.tenants(id),
    owner_user_id UUID NOT NULL REFERENCES omega_rag.users(id),
    legacy_legal_payer BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organizations_id_billing_tenant UNIQUE (id, billing_tenant_id)
);

ALTER TABLE omega_rag.tenants
    ADD COLUMN organization_id UUID REFERENCES omega_rag.organizations(id),
    ADD COLUMN billing_tenant_id UUID REFERENCES omega_rag.tenants(id),
    ADD COLUMN credit_limit_override INTEGER CONSTRAINT chk_tenants_credit_limit_override CHECK (credit_limit_override IS NULL OR credit_limit_override >= 0),
    ADD COLUMN device_limit_override INTEGER CONSTRAINT chk_tenants_device_limit_override CHECK (device_limit_override IS NULL OR device_limit_override >= 0),
    ADD COLUMN pre_v30_billing_history BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT chk_tenants_org_billing_pair CHECK (
        (organization_id IS NULL AND billing_tenant_id IS NULL)
        OR (organization_id IS NOT NULL AND billing_tenant_id IS NOT NULL)
    ),
    ADD CONSTRAINT fk_tenants_org_billing
        FOREIGN KEY (organization_id, billing_tenant_id)
        REFERENCES omega_rag.organizations(id, billing_tenant_id)
        DEFERRABLE INITIALLY IMMEDIATE;

-- Snapshot strictly at V30 migration time which pre-existing tenants already had an approved payment or a non-FREE / paid_verified subscription.
UPDATE omega_rag.tenants t
   SET pre_v30_billing_history = TRUE
 WHERE EXISTS (
           SELECT 1 FROM omega_rag.billing_payments p
            WHERE p.tenant_id = t.id
              AND (p.status = 'approved' OR p.approved_at IS NOT NULL)
       )
    OR EXISTS (
           SELECT 1 FROM omega_rag.subscriptions s
            WHERE s.tenant_id = t.id
              AND (s.paid_verified = TRUE OR s.plan_code <> 'FREE')
       );

CREATE INDEX idx_tenants_organization_id
    ON omega_rag.tenants(organization_id)
    WHERE organization_id IS NOT NULL;

CREATE INDEX idx_tenants_billing_tenant_id
    ON omega_rag.tenants(billing_tenant_id)
    WHERE billing_tenant_id IS NOT NULL;

CREATE TABLE omega_rag.organization_members (
    organization_id UUID NOT NULL REFERENCES omega_rag.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    org_role VARCHAR(24) NOT NULL CONSTRAINT chk_organization_members_role CHECK (org_role IN ('ORG_OWNER', 'ORG_ADMIN', 'MEMBER')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID REFERENCES omega_rag.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_organization_members_user_id
    ON omega_rag.organization_members(user_id);

CREATE TABLE omega_rag.workspace_memberships (
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    role VARCHAR(24) NOT NULL CONSTRAINT chk_workspace_memberships_role CHECK (role IN ('ADMIN', 'ANALYST', 'CLIENT')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by_user_id UUID REFERENCES omega_rag.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX idx_workspace_memberships_user_id
    ON omega_rag.workspace_memberships(user_id);

-- Explicit root membership backfill for all pre-existing users.
INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active, created_at, updated_at)
SELECT u.tenant_id, u.id, u.role, u.active, u.created_at, NOW()
FROM omega_rag.users u
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Keep root workspace_memberships in sync with omega_rag.users across all creation/update paths.
CREATE OR REPLACE FUNCTION omega_rag.sync_root_workspace_membership()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active, created_at, updated_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.role, NEW.active, COALESCE(NEW.created_at, NOW()), NOW())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            active = EXCLUDED.active,
            updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_sync_root_workspace_membership
    AFTER INSERT OR UPDATE OF role, active ON omega_rag.users
    FOR EACH ROW
    EXECUTE FUNCTION omega_rag.sync_root_workspace_membership();

-- Re-point same-workspace composite user FKs from users(tenant_id, id) to workspace_memberships(tenant_id, user_id)
-- so a canonical user with an explicit membership can operate in child workspaces while preserving DB-level anti-IDOR checks.
ALTER TABLE omega_rag.expedientes
    DROP CONSTRAINT fk_expedientes_owner_same_tenant,
    ADD CONSTRAINT fk_expedientes_owner_same_tenant
        FOREIGN KEY (tenant_id, owner_user_id)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE RESTRICT;

ALTER TABLE omega_rag.expediente_permissions
    DROP CONSTRAINT fk_exp_perm_user_same_tenant,
    ADD CONSTRAINT fk_exp_perm_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE CASCADE;

ALTER TABLE omega_rag.documents
    DROP CONSTRAINT fk_documents_uploader_same_tenant,
    ADD CONSTRAINT fk_documents_uploader_same_tenant
        FOREIGN KEY (tenant_id, uploaded_by)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE RESTRICT;

ALTER TABLE omega_rag.osint_monitored_assets
    DROP CONSTRAINT fk_rag_osint_user_same_tenant,
    ADD CONSTRAINT fk_rag_osint_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE CASCADE;

ALTER TABLE omega_rag.devices
    DROP CONSTRAINT fk_devices_user_same_tenant,
    ADD CONSTRAINT fk_devices_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE CASCADE;

ALTER TABLE omega_rag.ai_usage_quotas
    DROP CONSTRAINT fk_ai_quota_user_same_tenant,
    ADD CONSTRAINT fk_ai_quota_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE CASCADE;

ALTER TABLE omega_rag.api_tokens
    DROP CONSTRAINT fk_api_tokens_user_same_tenant,
    ADD CONSTRAINT fk_api_tokens_user_same_tenant
        FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE CASCADE;

ALTER TABLE omega_rag.legal_document_ai_consents
    DROP CONSTRAINT legal_document_ai_consents_tenant_id_accepted_by_fkey,
    ADD CONSTRAINT fk_legal_ai_consent_user_same_tenant
        FOREIGN KEY (tenant_id, accepted_by)
        REFERENCES omega_rag.workspace_memberships(tenant_id, user_id)
        ON DELETE RESTRICT;

ALTER TABLE omega_rag.credit_reservations
    ADD COLUMN workspace_tenant_id UUID REFERENCES omega_rag.tenants(id) ON DELETE SET NULL;

CREATE INDEX idx_credit_reservations_workspace_tenant_id
    ON omega_rag.credit_reservations(workspace_tenant_id, created_at DESC)
    WHERE workspace_tenant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION omega_rag.validate_organization_billing_payer()
RETURNS TRIGGER AS $$
DECLARE
    payer_profile VARCHAR(20);
    payer_active BOOLEAN;
    payer_pre_v30_billing BOOLEAN;
BEGIN
    SELECT t.profile, t.active, t.pre_v30_billing_history
      INTO payer_profile, payer_active, payer_pre_v30_billing
      FROM omega_rag.tenants t
     WHERE t.id = NEW.billing_tenant_id;

    IF NOT FOUND OR NOT payer_active THEN
        RAISE EXCEPTION 'El espacio pagador debe existir y encontrarse activo';
    END IF;

    IF payer_profile = 'LEGAL' AND NOT NEW.legacy_legal_payer THEN
        RAISE EXCEPTION 'Una organización nueva no puede usar un espacio LEGAL como pagador';
    END IF;

    IF NEW.legacy_legal_payer THEN
        IF payer_profile <> 'LEGAL' THEN
            RAISE EXCEPTION 'legacy_legal_payer solo aplica cuando el pagador preexistente ya tenía perfil LEGAL';
        END IF;

        IF NOT payer_pre_v30_billing OR NOT (
            EXISTS (
                SELECT 1 FROM omega_rag.billing_payments p
                 WHERE p.tenant_id = NEW.billing_tenant_id
                   AND (p.status = 'approved' OR p.approved_at IS NOT NULL)
            )
            OR EXISTS (
                SELECT 1 FROM omega_rag.subscriptions s
                 WHERE s.tenant_id = NEW.billing_tenant_id
                   AND (s.paid_verified = TRUE OR s.plan_code <> 'FREE')
            )
        ) THEN
            RAISE EXCEPTION 'legacy_legal_payer requiere pago aprobado o suscripción pagada (no FREE) anteriores a V30';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_validate_payer
    BEFORE INSERT OR UPDATE OF billing_tenant_id, legacy_legal_payer ON omega_rag.organizations
    FOR EACH ROW
    EXECUTE FUNCTION omega_rag.validate_organization_billing_payer();

CREATE OR REPLACE FUNCTION omega_rag.protect_billing_payer_tenant()
RETURNS TRIGGER AS $$
DECLARE
    is_payer BOOLEAN;
    has_other_spaces BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.pre_v30_billing_history THEN
            RAISE EXCEPTION 'pre_v30_billing_history solo puede asignarse durante la migración V30';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        SELECT EXISTS (
            SELECT 1 FROM omega_rag.tenants child
            WHERE child.id <> OLD.id
              AND (child.billing_tenant_id = OLD.id
                   OR (OLD.organization_id IS NOT NULL AND child.organization_id = OLD.organization_id))
        ) INTO has_other_spaces;

        IF has_other_spaces AND (
            (OLD.billing_tenant_id IS NOT NULL AND OLD.id = OLD.billing_tenant_id)
            OR EXISTS (SELECT 1 FROM omega_rag.organizations o WHERE o.billing_tenant_id = OLD.id)
        ) THEN
            RAISE EXCEPTION 'No se puede eliminar el espacio pagador mientras existan otros espacios en la organización';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.pre_v30_billing_history IS DISTINCT FROM OLD.pre_v30_billing_history THEN
        RAISE EXCEPTION 'pre_v30_billing_history es inmutable después de la migración V30';
    END IF;

    is_payer := (NEW.billing_tenant_id IS NOT NULL AND NEW.id = NEW.billing_tenant_id)
        OR EXISTS (SELECT 1 FROM omega_rag.organizations o WHERE o.billing_tenant_id = OLD.id);

    IF is_payer THEN
        IF NEW.profile = 'LEGAL' AND OLD.profile <> 'LEGAL' THEN
            RAISE EXCEPTION 'El espacio pagador de una organización no puede cambiar al perfil LEGAL';
        END IF;

        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            SELECT EXISTS (
                SELECT 1 FROM omega_rag.tenants child
                WHERE child.id <> OLD.id
                  AND (child.billing_tenant_id = OLD.id
                       OR (NEW.organization_id IS NOT NULL AND child.organization_id = NEW.organization_id))
            ) INTO has_other_spaces;

            IF has_other_spaces THEN
                RAISE EXCEPTION 'No se puede desactivar el espacio pagador mientras existan otros espacios en la organización';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_protect_billing_payer
    BEFORE INSERT OR UPDATE OF profile, active, organization_id, billing_tenant_id, pre_v30_billing_history OR DELETE ON omega_rag.tenants
    FOR EACH ROW
    EXECUTE FUNCTION omega_rag.protect_billing_payer_tenant();
