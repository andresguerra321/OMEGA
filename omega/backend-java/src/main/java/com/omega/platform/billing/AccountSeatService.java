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

    /**
     * Registra o actualiza una membresía activa en {@code omega_rag.workspace_memberships} validando únicamente
     * disponibilidad de puesto ({@code max_users}) bajo bloqueo transaccional del {@code billing_tenant_id}.
     *
     * <p><strong>CONTRATO DE SEGURIDAD (NO AUTORIZA):</strong> Este método NO valida permisos del actor invocador
     * ni reglas de custodia de espacios {@code LEGAL}. Solo debe invocarse desde controladores o servicios de
     * aplicación que hayan verificado explícitamente la autorización del actor antes de delegar aquí.
     */
    @Transactional
    public void assignWorkspaceMembership(UUID workspaceTenant, UUID userId, Role role, UUID grantedByUserId) {
        updateWorkspaceMembershipState(workspaceTenant, userId, role, true, grantedByUserId);
    }

    /**
     * Actualiza el rol y/o estado activo de una membresía en {@code omega_rag.workspace_memberships}.
     * Si la membresía queda activa con rol {@code ADMIN} o {@code ANALYST}, verifica disponibilidad de puesto
     * mediante {@link #requireAvailableSeat(UUID, UUID, Role)} (permitiendo al titular único de una cuenta
     * {@code INDIVIDUAL} ajustar su propio rol sin agregar miembros externos).
     *
     * <p><strong>CONTRATO DE SEGURIDAD (NO AUTORIZA):</strong> Este método NO valida permisos del actor invocador.
     * Solo debe invocarse desde métodos que hayan verificado explícitamente la autorización previa.
     */
    @Transactional
    public void updateWorkspaceMembershipState(
            UUID workspaceTenant,
            UUID userId,
            Role role,
            boolean active,
            UUID grantedByUserId
    ) {
        Role targetRole = role != null ? role : Role.ANALYST;
        if (!active) {
            int updated = jdbc.update("""
                    UPDATE omega_rag.workspace_memberships
                       SET active = FALSE,
                           role = ?,
                           updated_at = NOW()
                     WHERE tenant_id = ? AND user_id = ?
                    """, targetRole.name(), workspaceTenant, userId);
            if (updated == 0) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Membresía de espacio no encontrada.");
            }
            return;
        }

        if (!isSoleIndividualOwnerSelfUpdate(workspaceTenant, userId)) {
            requireAvailableSeat(workspaceTenant, userId, targetRole);
        }

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

    private boolean isSoleIndividualOwnerSelfUpdate(UUID workspaceTenant, UUID userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT account_type, owner_user_id, organization_id
                  FROM omega_rag.tenants
                 WHERE id = ? AND active = TRUE
                """, workspaceTenant);
        if (rows.isEmpty()) {
            return false;
        }
        Map<String, Object> row = rows.getFirst();
        if (row.get("organization_id") != null) {
            return false;
        }
        String accountType = String.valueOf(row.get("account_type"));
        UUID ownerId = (UUID) row.get("owner_user_id");
        if ("INDIVIDUAL".equals(accountType)) {
            return userId != null && userId.equals(ownerId);
        }
        if ("UNCLASSIFIED".equals(accountType)) {
            Long totalMembers = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM omega_rag.workspace_memberships WHERE tenant_id = ?",
                    Long.class,
                    workspaceTenant
            );
            return totalMembers != null && totalMembers == 1L && (ownerId == null || userId.equals(ownerId));
        }
        return false;
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
