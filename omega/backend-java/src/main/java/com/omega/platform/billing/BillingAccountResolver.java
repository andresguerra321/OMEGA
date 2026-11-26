package com.omega.platform.billing;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * Resuelve de forma única y verificada el espacio pagador (billing_tenant_id)
 * para suscripción, bolsa de créditos, puestos, flota y datos comerciales,
 * garantizando que un espacio jamás consuma ni consulte facturación de otra organización.
 */
@Service
public class BillingAccountResolver {

    private final JdbcTemplate jdbc;

    public BillingAccountResolver(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ResolvedBillingAccount(
            UUID workspaceTenantId,
            UUID billingTenantId,
            UUID organizationId,
            String workspaceAccountType,
            String workspaceProfile,
            boolean billingWorkspace
    ) {
        public boolean belongsToOrganization() {
            return organizationId != null;
        }
    }

    public ResolvedBillingAccount resolve(UUID workspaceTenantId) {
        if (workspaceTenantId == null) {
            throw new AccessDeniedException("Cuenta o espacio no disponible");
        }
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT t.id AS workspace_id,
                       t.active AS workspace_active,
                       t.account_type AS workspace_account_type,
                       t.profile AS workspace_profile,
                       t.organization_id AS org_id,
                       t.billing_tenant_id AS raw_billing_id,
                       o.active AS org_active,
                       o.billing_tenant_id AS org_billing_id,
                       bt.active AS billing_active,
                       bt.organization_id AS bt_org_id
                  FROM omega_rag.tenants t
                  LEFT JOIN omega_rag.organizations o ON o.id = t.organization_id
                  LEFT JOIN omega_rag.tenants bt ON bt.id = COALESCE(t.billing_tenant_id, t.id)
                 WHERE t.id = ?
                """, workspaceTenantId);

        if (rows.isEmpty() || !Boolean.TRUE.equals(rows.getFirst().get("workspace_active"))) {
            throw new AccessDeniedException("Cuenta o espacio no disponible");
        }

        Map<String, Object> row = rows.getFirst();
        UUID orgId = (UUID) row.get("org_id");
        UUID rawBillingId = (UUID) row.get("raw_billing_id");
        String accountType = String.valueOf(row.get("workspace_account_type"));
        String profile = String.valueOf(row.get("workspace_profile"));

        if (orgId == null && rawBillingId == null) {
            return new ResolvedBillingAccount(
                    workspaceTenantId,
                    workspaceTenantId,
                    null,
                    accountType,
                    profile,
                    true
            );
        }

        UUID orgBillingId = (UUID) row.get("org_billing_id");
        UUID btOrgId = (UUID) row.get("bt_org_id");
        boolean orgActive = Boolean.TRUE.equals(row.get("org_active"));
        boolean billingActive = Boolean.TRUE.equals(row.get("billing_active"));

        if (orgId == null
                || rawBillingId == null
                || !orgActive
                || !billingActive
                || !rawBillingId.equals(orgBillingId)
                || !orgId.equals(btOrgId)) {
            throw new AccessDeniedException("Cuenta de facturación inválida o perteneciente a otra organización");
        }

        return new ResolvedBillingAccount(
                workspaceTenantId,
                rawBillingId,
                orgId,
                accountType,
                profile,
                workspaceTenantId.equals(rawBillingId)
        );
    }

    public UUID resolveBillingTenantId(UUID workspaceTenantId) {
        return resolve(workspaceTenantId).billingTenantId();
    }
}
