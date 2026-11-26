-- Phase 2a-1: Workspace membership cross-tenant integrity trigger and insert-only root membership creation.
-- Reverse (restores UPDATE OF role, active sync from omega_rag.users and drops V31 integrity trigger):
-- DROP TRIGGER IF EXISTS trg_workspace_memberships_integrity ON omega_rag.workspace_memberships;
-- DROP FUNCTION IF EXISTS omega_rag.validate_workspace_membership_integrity();
-- DROP TRIGGER IF EXISTS trg_users_sync_root_workspace_membership ON omega_rag.users;
-- CREATE OR REPLACE FUNCTION omega_rag.sync_root_workspace_membership()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active, created_at, updated_at)
--     VALUES (NEW.tenant_id, NEW.id, NEW.role, NEW.active, COALESCE(NEW.created_at, NOW()), NOW())
--     ON CONFLICT (tenant_id, user_id) DO UPDATE
--         SET role = EXCLUDED.role,
--             active = EXCLUDED.active,
--             updated_at = NOW();
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- CREATE TRIGGER trg_users_sync_root_workspace_membership
--     AFTER INSERT OR UPDATE OF role, active ON omega_rag.users
--     FOR EACH ROW
--     EXECUTE FUNCTION omega_rag.sync_root_workspace_membership();

-- 1. Integrity trigger on workspace_memberships:
--    Allows a row ONLY if users.tenant_id = workspace_memberships.tenant_id (root workspace)
--    OR both the target workspace and the user's root workspace share the SAME non-null organization_id.
CREATE OR REPLACE FUNCTION omega_rag.validate_workspace_membership_integrity()
RETURNS TRIGGER AS $$
DECLARE
    user_root_tenant UUID;
    user_org_id UUID;
    target_org_id UUID;
BEGIN
    SELECT u.tenant_id
      INTO user_root_tenant
      FROM omega_rag.users u
     WHERE u.id = NEW.user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membresía inválida: el usuario % no existe en omega_rag.users', NEW.user_id;
    END IF;

    IF user_root_tenant = NEW.tenant_id THEN
        RETURN NEW;
    END IF;

    SELECT t.organization_id
      INTO user_org_id
      FROM omega_rag.tenants t
     WHERE t.id = user_root_tenant;

    SELECT t.organization_id
      INTO target_org_id
      FROM omega_rag.tenants t
     WHERE t.id = NEW.tenant_id;

    IF user_org_id IS NULL OR target_org_id IS NULL OR user_org_id <> target_org_id THEN
        RAISE EXCEPTION 'Membresía rechazada: solo se permite pertenecer al espacio raíz del usuario o a espacios de la misma organización';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workspace_memberships_integrity
    BEFORE INSERT OR UPDATE OF tenant_id, user_id ON omega_rag.workspace_memberships
    FOR EACH ROW
    EXECUTE FUNCTION omega_rag.validate_workspace_membership_integrity();

-- 2. Remove UPDATE OF role, active branch from root sync trigger; keep INSERT-only root membership creation.
DROP TRIGGER IF EXISTS trg_users_sync_root_workspace_membership ON omega_rag.users;

CREATE OR REPLACE FUNCTION omega_rag.sync_root_workspace_membership()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active, created_at, updated_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.role, NEW.active, COALESCE(NEW.created_at, NOW()), NOW())
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_sync_root_workspace_membership
    AFTER INSERT ON omega_rag.users
    FOR EACH ROW
    EXECUTE FUNCTION omega_rag.sync_root_workspace_membership();
