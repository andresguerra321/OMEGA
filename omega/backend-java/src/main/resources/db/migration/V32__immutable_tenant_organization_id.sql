-- Phase 2a-1 hardening: make omega_rag.tenants.organization_id immutable once assigned (only NULL -> value allowed).
-- Reverse (restores V30/V31 protect_billing_payer_tenant without organization_id immutability guard):
-- CREATE OR REPLACE FUNCTION omega_rag.protect_billing_payer_tenant()
-- RETURNS TRIGGER AS $$
-- DECLARE
--     is_payer BOOLEAN;
--     has_other_spaces BOOLEAN;
-- BEGIN
--     IF TG_OP = 'INSERT' THEN
--         IF NEW.pre_v30_billing_history THEN
--             RAISE EXCEPTION 'pre_v30_billing_history solo puede asignarse durante la migración V30';
--         END IF;
--         RETURN NEW;
--     END IF;
--     IF TG_OP = 'DELETE' THEN
--         SELECT EXISTS (
--             SELECT 1 FROM omega_rag.tenants child
--             WHERE child.id <> OLD.id
--               AND (child.billing_tenant_id = OLD.id
--                    OR (OLD.organization_id IS NOT NULL AND child.organization_id = OLD.organization_id))
--         ) INTO has_other_spaces;
--         IF has_other_spaces AND (
--             (OLD.billing_tenant_id IS NOT NULL AND OLD.id = OLD.billing_tenant_id)
--             OR EXISTS (SELECT 1 FROM omega_rag.organizations o WHERE o.billing_tenant_id = OLD.id)
--         ) THEN
--             RAISE EXCEPTION 'No se puede eliminar el espacio pagador mientras existan otros espacios en la organización';
--         END IF;
--         RETURN OLD;
--     END IF;
--     IF NEW.pre_v30_billing_history IS DISTINCT FROM OLD.pre_v30_billing_history THEN
--         RAISE EXCEPTION 'pre_v30_billing_history es inmutable después de la migración V30';
--     END IF;
--     is_payer := (NEW.billing_tenant_id IS NOT NULL AND NEW.id = NEW.billing_tenant_id)
--         OR EXISTS (SELECT 1 FROM omega_rag.organizations o WHERE o.billing_tenant_id = OLD.id);
--     IF is_payer THEN
--         IF NEW.profile = 'LEGAL' AND OLD.profile <> 'LEGAL' THEN
--             RAISE EXCEPTION 'El espacio pagador de una organización no puede cambiar al perfil LEGAL';
--         END IF;
--         IF OLD.active = TRUE AND NEW.active = FALSE THEN
--             SELECT EXISTS (
--                 SELECT 1 FROM omega_rag.tenants child
--                 WHERE child.id <> OLD.id
--                   AND (child.billing_tenant_id = OLD.id
--                        OR (NEW.organization_id IS NOT NULL AND child.organization_id = NEW.organization_id))
--             ) INTO has_other_spaces;
--             IF has_other_spaces THEN
--                 RAISE EXCEPTION 'No se puede desactivar el espacio pagador mientras existan otros espacios en la organización';
--             END IF;
--         END IF;
--     END IF;
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

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

    IF OLD.organization_id IS NOT NULL AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'organization_id de un espacio es inmutable una vez asignado (no puede cambiarse ni ponerse en NULL)';
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
