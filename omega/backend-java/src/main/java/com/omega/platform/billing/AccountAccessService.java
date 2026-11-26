package com.omega.platform.billing;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

@Service
public class AccountAccessService {

    private final TenantRepository tenants;
    private final JdbcTemplate jdbc;
    private final BillingAccountResolver resolver;

    public AccountAccessService(TenantRepository tenants) {
        this(tenants, null, null);
    }

    @Autowired
    public AccountAccessService(
            TenantRepository tenants,
            @Autowired(required = false) JdbcTemplate jdbc,
            @Autowired(required = false) BillingAccountResolver resolver
    ) {
        this.tenants = tenants;
        this.jdbc = jdbc;
        this.resolver = resolver;
    }

    /**
     * Evalúa si el usuario puede administrar la configuración operativa del espacio actual.
     */
    public boolean canManage(UUID tenantId, UUID userId, Role role) {
        TenantEntity tenant = tenants.findByIdAndActiveTrue(tenantId)
                .orElseThrow(() -> new AccessDeniedException("Cuenta no disponible"));
        return "INDIVIDUAL".equals(tenant.getAccountType())
                ? userId.equals(tenant.getOwnerUserId())
                : role == Role.ADMIN;
    }

    /**
     * Evalúa si el usuario puede mutar facturación (checkout, cancelación, datos fiscales y comprobantes).
     * Un ADMIN de un espacio hijo no pagador nunca puede gestionar la facturación salvo que sea ORG_OWNER u ORG_ADMIN.
     */
    public boolean canManageBilling(UUID tenantId, UUID userId, Role role) {
        if (resolver == null || jdbc == null) {
            return canManage(tenantId, userId, role);
        }
        BillingAccountResolver.ResolvedBillingAccount account = resolver.resolve(tenantId);
        if (!account.belongsToOrganization()) {
            TenantEntity tenant = tenants.findByIdAndActiveTrue(tenantId)
                    .orElseThrow(() -> new AccessDeniedException("Cuenta no disponible"));
            return "INDIVIDUAL".equals(tenant.getAccountType())
                    ? userId.equals(tenant.getOwnerUserId())
                    : role == Role.ADMIN;
        }

        Boolean hasOrgAuthority = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1
                      FROM omega_rag.organizations o
                      LEFT JOIN omega_rag.organization_members om
                             ON om.organization_id = o.id
                            AND om.user_id = ?
                            AND om.active = TRUE
                     WHERE o.id = ?
                       AND o.active = TRUE
                       AND (
                           om.org_role IN ('ORG_OWNER', 'ORG_ADMIN')
                           OR (
                               NOT EXISTS (SELECT 1 FROM omega_rag.organization_members any_om WHERE any_om.organization_id = o.id)
                               AND (o.owner_user_id = ? OR (? = TRUE AND ? = 'ADMIN'))
                           )
                       )
                )
                """,
                Boolean.class,
                userId,
                account.organizationId(),
                userId,
                account.billingWorkspace(),
                role != null ? role.name() : ""
        );
        return Boolean.TRUE.equals(hasOrgAuthority);
    }

    public void requireManager(OmegaPrincipal actor) {
        if (actor == null || !canManage(actor.tenantId(), actor.userId(), actor.role())) {
            throw new AccessDeniedException("Solo el titular o un administrador del espacio puede realizar esta acción.");
        }
    }

    public void requireBillingManager(OmegaPrincipal actor) {
        if (actor == null || !canManageBilling(actor.tenantId(), actor.userId(), actor.role())) {
            throw new AccessDeniedException("Solo el titular o un administrador de facturación de la organización puede realizar esta acción.");
        }
    }
}
