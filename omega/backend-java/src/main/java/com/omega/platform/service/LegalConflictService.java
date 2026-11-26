package com.omega.platform.service;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class LegalConflictService {

    private static final String ACCENT_FROM = "ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüû";
    private static final String ACCENT_TO   = "aaaaaaaaaaeeeeeeeeiiiiiiiiioooooooooouuuuuuuu";

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
                    (
                        e.client_name IS NOT NULL
                        AND translate(LOWER(e.client_name),
                            'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüû',
                            'aaaaaaaaaaeeeeeeeeiiiiiiiiioooooooooouuuuuuuu') LIKE ? ESCAPE '\\'
                    ) AS client_hit,
                    (
                        e.counterparty_name IS NOT NULL
                        AND translate(LOWER(e.counterparty_name),
                            'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüû',
                            'aaaaaaaaaaeeeeeeeeiiiiiiiiioooooooooouuuuuuuu') LIKE ? ESCAPE '\\'
                    ) AS counterparty_hit,
                    e.case_reference,
                    e.title
                FROM omega_rag.expedientes e
                WHERE e.tenant_id = ?
            """;

    private static final String SELECT_TAIL = """
            )
            SELECT
                accessible,
                CASE WHEN accessible THEN case_reference ELSE NULL END AS case_reference,
                CASE WHEN accessible THEN title ELSE NULL END AS title,
                CASE WHEN accessible THEN client_hit ELSE FALSE END AS client_hit,
                CASE WHEN accessible THEN counterparty_hit ELSE FALSE END AS counterparty_hit
            FROM matched
            WHERE client_hit OR counterparty_hit
            ORDER BY accessible DESC, updated_at DESC, id ASC
            """;

    private static final String CONFLICT_SQL = SELECT_HEAD + SELECT_TAIL;
    private static final String CONFLICT_EXCLUDING_SQL = SELECT_HEAD + "      AND e.id <> ?\n" + SELECT_TAIL;

    private final JdbcTemplate jdbc;
    private final AuditLogService audit;

    public LegalConflictService(JdbcTemplate jdbc, AuditLogService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
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

        String trimmed = rawName == null ? "" : rawName.strip();
        if (trimmed.length() < 4 || trimmed.length() > 200) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "El nombre a consultar debe tener entre 4 y 200 caracteres.");
        }

        String normalized = foldAccentsAndLower(trimmed);
        String escaped = normalized
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        String likePattern = "%" + escaped + "%";
        boolean isAdmin = role == Role.ADMIN;

        List<ConflictMatch> accessibleMatches = new ArrayList<>();
        int[] restrictedCounter = {0};

        Object[] params = excludeCaseId == null
                ? new Object[]{isAdmin, userId, userId, likePattern, likePattern, tenantId}
                : new Object[]{isAdmin, userId, userId, likePattern, likePattern, tenantId, excludeCaseId};
        String sql = excludeCaseId == null ? CONFLICT_SQL : CONFLICT_EXCLUDING_SQL;

        jdbc.query(sql, rs -> {
            if (rs.getBoolean("accessible")) {
                List<String> roles = new ArrayList<>(2);
                if (rs.getBoolean("client_hit")) {
                    roles.add("CLIENT");
                }
                if (rs.getBoolean("counterparty_hit")) {
                    roles.add("COUNTERPARTY");
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

        audit.record(
                tenantId,
                userId,
                "LEGAL_CONFLICT_CHECK",
                "TENANT",
                tenantId.toString(),
                Map.of(
                        "totalMatches", totalMatches,
                        "accessibleMatches", accessibleMatches.size(),
                        "restrictedMatches", restrictedMatches
                )
        );

        return new ConflictCheckResponse(totalMatches, restrictedMatches, List.copyOf(accessibleMatches));
    }

    static String foldAccentsAndLower(String value) {
        String lower = value.toLowerCase(Locale.ROOT);
        StringBuilder sb = new StringBuilder(lower.length());
        for (int i = 0; i < lower.length(); i++) {
            char ch = lower.charAt(i);
            int idx = ACCENT_FROM.indexOf(ch);
            sb.append(idx >= 0 ? ACCENT_TO.charAt(idx) : ch);
        }
        return sb.toString();
    }
}
