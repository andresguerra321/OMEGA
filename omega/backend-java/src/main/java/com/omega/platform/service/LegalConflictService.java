package com.omega.platform.service;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class LegalConflictService {

    private static final String SELECT_HEAD = """
            WITH matched AS (
                SELECT
                    e.id,
                    e.updated_at,
                    (
                        ? = TRUE
                        OR e.owner_user_id = ?
                        OR EXISTS (
                            SELECT 1 FROM omega_rag.expediente_permissions p
                            WHERE p.tenant_id = e.tenant_id
                              AND p.expediente_id = e.id
                              AND p.user_id = ?
                        )
                    ) AS accessible,
                    BOOL_OR(lp.party_role = 'CLIENT') AS client_hit,
                    BOOL_OR(lp.party_role = 'COUNTERPARTY') AS counterparty_hit,
                    BOOL_OR(lp.party_role = 'OTHER') AS other_hit,
                    e.case_reference,
                    e.title
                FROM omega_rag.legal_case_parties lp
                JOIN omega_rag.expedientes e
                  ON e.tenant_id = lp.tenant_id
                 AND e.id = lp.expediente_id
                WHERE lp.tenant_id = ?
                  AND lp.normalized_name LIKE ? ESCAPE '\\'
                GROUP BY e.id, e.updated_at, e.owner_user_id, e.case_reference, e.title
            )
            SELECT
                accessible,
                CASE WHEN accessible THEN case_reference ELSE NULL END AS case_reference,
                CASE WHEN accessible THEN title ELSE NULL END AS title,
                CASE WHEN accessible THEN client_hit ELSE FALSE END AS client_hit,
                CASE WHEN accessible THEN counterparty_hit ELSE FALSE END AS counterparty_hit,
                CASE WHEN accessible THEN other_hit ELSE FALSE END AS other_hit
            FROM matched
            """;

    private static final String ORDER_CLAUSE = "ORDER BY accessible DESC, updated_at DESC, id ASC\n";
    private static final String CONFLICT_SQL = SELECT_HEAD + ORDER_CLAUSE;
    private static final String CONFLICT_EXCLUDING_SQL =
            SELECT_HEAD + "WHERE NOT (accessible AND id = ?)\n" + ORDER_CLAUSE;

    private final JdbcTemplate jdbc;
    private final AuditLogService audit;
    private final LegalQuotaService quotaService;

    public LegalConflictService(JdbcTemplate jdbc, AuditLogService audit) {
        this(jdbc, audit, null);
    }

    @Autowired
    public LegalConflictService(JdbcTemplate jdbc, AuditLogService audit, LegalQuotaService quotaService) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.quotaService = quotaService;
    }

    public record ConflictMatch(String code, String title, List<String> roles) {}

    public record ConflictCheckResponse(
            int totalMatches,
            int restrictedMatches,
            List<ConflictMatch> matches
    ) {}

    @Transactional
    public ConflictCheckResponse checkConflicts(OmegaPrincipal actor, String rawName, UUID excludeCaseId) {
        UUID tenantId = TenantContext.requireTenantId();
        if (actor != null && !tenantId.equals(actor.tenantId())) {
            throw new AccessDeniedException("Contexto de tenant inconsistente");
        }
        UUID userId = actor != null ? actor.userId() : TenantContext.requireUserId();
        Role role = actor != null
                ? actor.role()
                : TenantContext.get().map(TenantScope::role).orElse(Role.CLIENT);
        if (role != Role.ADMIN && role != Role.ANALYST) {
            throw new AccessDeniedException("Solo administradores o analistas pueden verificar conflictos de interés.");
        }

        if (quotaService != null) {
            OmegaPrincipal ratePrincipal = actor != null
                    ? actor
                    : new OmegaPrincipal(userId, tenantId, "user@omega.local", role, true);
            quotaService.checkConflictSearchRate(ratePrincipal);
        }

        String trimmed = rawName == null ? "" : rawName.strip();
        if (trimmed.length() < 4 || trimmed.length() > 200) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "El nombre a consultar debe tener entre 4 y 200 caracteres.");
        }

        String normalized = LegalNameNormalizer.normalize(trimmed);
        if (normalized.length() < 2) {
            recordConflictAudit(tenantId, userId, 0, 0, 0);
            return new ConflictCheckResponse(0, 0, List.of());
        }

        String likePattern = "%" + LegalNameNormalizer.escapeLikeLiteral(normalized) + "%";
        boolean isAdmin = role == Role.ADMIN;

        List<ConflictMatch> accessibleMatches = new ArrayList<>();
        int[] restrictedCounter = {0};

        Object[] params = excludeCaseId == null
                ? new Object[]{isAdmin, userId, userId, tenantId, likePattern}
                : new Object[]{isAdmin, userId, userId, tenantId, likePattern, excludeCaseId};
        String sql = excludeCaseId == null ? CONFLICT_SQL : CONFLICT_EXCLUDING_SQL;

        jdbc.query(sql, rs -> {
            if (rs.getBoolean("accessible")) {
                List<String> roles = new ArrayList<>(3);
                if (rs.getBoolean("client_hit")) {
                    roles.add("CLIENT");
                }
                if (rs.getBoolean("counterparty_hit")) {
                    roles.add("COUNTERPARTY");
                }
                if (rs.getBoolean("other_hit")) {
                    roles.add("OTHER");
                }
                String code = rs.getString("case_reference");
                accessibleMatches.add(new ConflictMatch(
                        code == null ? "" : code,
                        rs.getString("title"),
                        List.copyOf(roles)
                ));
            } else {
                restrictedCounter[0]++;
            }
        }, params);

        int restrictedMatches = restrictedCounter[0];
        int totalMatches = accessibleMatches.size() + restrictedMatches;
        recordConflictAudit(tenantId, userId, totalMatches, accessibleMatches.size(), restrictedMatches);

        return new ConflictCheckResponse(totalMatches, restrictedMatches, List.copyOf(accessibleMatches));
    }

    private void recordConflictAudit(UUID tenantId, UUID userId, int totalMatches, int accessibleMatches, int restrictedMatches) {
        audit.record(
                tenantId,
                userId,
                "LEGAL_CONFLICT_CHECK",
                "TENANT",
                tenantId.toString(),
                Map.of(
                        "totalMatches", totalMatches,
                        "accessibleMatches", accessibleMatches,
                        "restrictedMatches", restrictedMatches
                )
        );
    }
}
