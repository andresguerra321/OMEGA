package com.omega.platform.security;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.TenantRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Política centralizada de MFA multi-espacio y frescura de {@code mfa_at} para espacios {@code LEGAL}
 * pertenecientes a una organización ({@code organization_id IS NOT NULL}).
 */
@Service
public class WorkspaceMfaPolicyService {

    public static final Duration ORGANIZATIONAL_LEGAL_MFA_MAX_AGE = Duration.ofMinutes(15);

    private final JdbcTemplate jdbc;
    private final TenantRepository tenantRepository;

    @Autowired
    public WorkspaceMfaPolicyService(
            @Autowired(required = false) JdbcTemplate jdbc,
            @Autowired(required = false) TenantRepository tenantRepository
    ) {
        this.jdbc = jdbc;
        this.tenantRepository = tenantRepository;
    }

    public static boolean isOrganizationalLegalWorkspace(TenantEntity tenant) {
        return tenant != null
                && tenant.getOrganizationId() != null
                && tenant.getProfile() == TenantProfile.LEGAL;
    }

    public static boolean isRecentMfa(Instant mfaAt, Instant now) {
        if (mfaAt == null || now == null) {
            return false;
        }
        if (mfaAt.isAfter(now.plusSeconds(60))) {
            return false;
        }
        return Duration.between(mfaAt, now).compareTo(ORGANIZATIONAL_LEGAL_MFA_MAX_AGE) <= 0;
    }

    public boolean hasMandatoryMfaObligation(UUID userId) {
        if (jdbc == null || userId == null) {
            return false;
        }
        Long activeMemberships = jdbc.queryForObject("""
                SELECT COUNT(*)
                  FROM omega_rag.workspace_memberships wm
                  JOIN omega_rag.tenants t ON t.id = wm.tenant_id
                 WHERE wm.user_id = ?
                   AND wm.active = TRUE
                   AND t.active = TRUE
                """, Long.class, userId);
        if (activeMemberships != null && activeMemberships > 1L) {
            return true;
        }
        Boolean orgAdminOrLegal = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1
                      FROM omega_rag.organization_members om
                      JOIN omega_rag.organizations o ON o.id = om.organization_id
                     WHERE om.user_id = ?
                       AND om.active = TRUE
                       AND o.active = TRUE
                       AND om.org_role IN ('ORG_OWNER', 'ORG_ADMIN')
                ) OR EXISTS (
                    SELECT 1
                      FROM omega_rag.workspace_memberships wm
                      JOIN omega_rag.tenants t ON t.id = wm.tenant_id
                     WHERE wm.user_id = ?
                       AND wm.active = TRUE
                       AND t.active = TRUE
                       AND t.organization_id IS NOT NULL
                       AND t.profile = 'LEGAL'
                )
                """, Boolean.class, userId, userId);
        return Boolean.TRUE.equals(orgAdminOrLegal);
    }

    public void requireRecentMfaIfOrganizationalLegal(OmegaPrincipal principal) {
        if (principal == null) {
            return;
        }
        requireRecentMfaIfOrganizationalLegal(principal.tenantId(), principal.mfaAt());
    }

    public void requireRecentMfaIfOrganizationalLegal(UUID tenantId, Instant mfaAt) {
        if (tenantId == null) {
            return;
        }
        boolean orgLegal = false;
        if (tenantRepository != null) {
            orgLegal = tenantRepository.findByIdAndActiveTrue(tenantId)
                    .map(WorkspaceMfaPolicyService::isOrganizationalLegalWorkspace)
                    .orElse(false);
        } else if (jdbc != null) {
            Boolean row = jdbc.queryForObject("""
                    SELECT EXISTS (
                        SELECT 1
                          FROM omega_rag.tenants t
                         WHERE t.id = ?
                           AND t.active = TRUE
                           AND t.organization_id IS NOT NULL
                           AND t.profile = 'LEGAL'
                    )
                    """, Boolean.class, tenantId);
            orgLegal = Boolean.TRUE.equals(row);
        }
        if (orgLegal && !isRecentMfa(mfaAt, Instant.now())) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "MFA_STEP_UP_REQUIRED: Esta acción sensible en un espacio LEGAL organizacional requiere verificación 2FA reciente (máximo 15 minutos)."
            );
        }
    }
}
