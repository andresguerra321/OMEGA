package com.omega.platform.billing;

import com.omega.platform.security.Role;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AccountSeatService {

    private final JdbcTemplate jdbc;
    private final BillingPolicy policy;
    private final BillingAccountResolver resolver;

    public AccountSeatService(JdbcTemplate jdbc, BillingPolicy policy) {
        this(jdbc, policy, new BillingAccountResolver(jdbc));
    }

    @Autowired
    public AccountSeatService(JdbcTemplate jdbc, BillingPolicy policy, BillingAccountResolver resolver) {
        this.jdbc = jdbc;
        this.policy = policy;
        this.resolver = resolver;
    }

    // The caller keeps this transaction open until the user or membership is inserted.
    @Transactional(propagation = Propagation.MANDATORY)
    public void requireAvailableSeat(UUID workspaceTenant) {
        requireAvailableSeat(workspaceTenant, null, Role.ANALYST);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void requireAvailableSeat(UUID workspaceTenant, UUID candidateUserId, Role candidateRole) {
        BillingAccountResolver.ResolvedBillingAccount resolved = resolver.resolve(workspaceTenant);
        UUID billingTenant = resolved.billingTenantId();

        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> {}, "billing:" + billingTenant);
        Map<String, Object> billingRow = jdbc.queryForMap(
                "SELECT account_type FROM omega_rag.tenants WHERE id = ? FOR UPDATE",
                billingTenant
        );
        if ("INDIVIDUAL".equals(resolved.workspaceAccountType())
                || (!resolved.belongsToOrganization() && "INDIVIDUAL".equals(billingRow.get("account_type")))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Una cuenta individual no permite agregar miembros.");
        }

        Role effectiveRole = candidateRole != null ? candidateRole : Role.ANALYST;
        if (effectiveRole == Role.CLIENT || !policy.enforced()) {
            return;
        }

        if (candidateUserId != null && alreadyOccupiesSeat(billingTenant, candidateUserId)) {
            return;
        }

        List<Map<String, Object>> subs = jdbc.queryForList(
                "SELECT * FROM omega_rag.subscriptions WHERE tenant_id = ?",
                billingTenant
        );
        String plan = subs.isEmpty()
                ? "FREE"
                : CreditService.effectivePlan(subs.getFirst(), OffsetDateTime.now(ZoneOffset.UTC), policy.graceDays());
        Integer limit = jdbc.queryForObject(
                "SELECT max_users FROM omega_rag.billing_plans WHERE plan_code = ? AND interval = 'MONTHLY'",
                Integer.class,
                plan
        );
        long used = countOccupiedSeats(billingTenant);
        if (limit != null && used >= limit) {
            throw new ResponseStatusException(
                    HttpStatus.PAYMENT_REQUIRED,
                    "Tu plan permite " + limit + " usuario(s). Enterprise incluye 5 puestos."
            );
        }
    }

    @Transactional
    public void assignWorkspaceMembership(UUID workspaceTenant, UUID userId, Role role, UUID grantedByUserId) {
        Role targetRole = role != null ? role : Role.ANALYST;
        requireAvailableSeat(workspaceTenant, userId, targetRole);
        jdbc.update("""
                INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active, granted_by_user_id, created_at, updated_at)
                VALUES (?, ?, ?, TRUE, ?, NOW(), NOW())
                ON CONFLICT (tenant_id, user_id) DO UPDATE
                    SET role = EXCLUDED.role,
                        active = TRUE,
                        granted_by_user_id = COALESCE(EXCLUDED.granted_by_user_id, omega_rag.workspace_memberships.granted_by_user_id),
                        updated_at = NOW()
                """,
                workspaceTenant,
                userId,
                targetRole.name(),
                grantedByUserId
        );
    }

    public long countActiveOccupiedSeats(UUID workspaceTenant) {
        UUID billingTenant = resolver.resolveBillingTenantId(workspaceTenant);
        return countOccupiedSeats(billingTenant);
    }

    private boolean alreadyOccupiesSeat(UUID billingTenant, UUID userId) {
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1
                      FROM omega_rag.workspace_memberships wm
                      JOIN omega_rag.tenants t ON t.id = wm.tenant_id
                      JOIN omega_rag.users u ON u.id = wm.user_id
                     WHERE COALESCE(t.billing_tenant_id, t.id) = ?
                       AND t.active = TRUE
                       AND wm.active = TRUE
                       AND u.active = TRUE
                       AND wm.role IN ('ADMIN', 'ANALYST')
                       AND wm.user_id = ?
                )
                """,
                Boolean.class,
                billingTenant,
                userId
        );
        return Boolean.TRUE.equals(exists);
    }

    private long countOccupiedSeats(UUID billingTenant) {
        Long count = jdbc.queryForObject("""
                SELECT COUNT(DISTINCT wm.user_id)
                  FROM omega_rag.workspace_memberships wm
                  JOIN omega_rag.tenants t ON t.id = wm.tenant_id
                  JOIN omega_rag.users u ON u.id = wm.user_id
                 WHERE COALESCE(t.billing_tenant_id, t.id) = ?
                   AND t.active = TRUE
                   AND wm.active = TRUE
                   AND u.active = TRUE
                   AND wm.role IN ('ADMIN', 'ANALYST')
                """,
                Long.class,
                billingTenant
        );
        return count != null ? count : 0L;
    }
}
