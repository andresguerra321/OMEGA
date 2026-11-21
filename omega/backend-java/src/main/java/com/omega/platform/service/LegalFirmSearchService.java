package com.omega.platform.service;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.LegalCaseService.PageView;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Q10: Búsqueda en todo el despacho acotada estrictamente a los expedientes autorizados del tenant.
 * Busca sobre metadatos de expedientes y texto indexado de documentos con paginación SQL.
 * Nunca devuelve resultados de expedientes sin permiso ni de otro tenant; nunca registra el término buscado en audit_logs.
 */
@Service
public class LegalFirmSearchService {

    private final JdbcTemplate jdbc;
    private final AuditLogService audit;

    public LegalFirmSearchService(JdbcTemplate jdbc, AuditLogService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public record FirmSearchHit(
            String matchType,
            UUID expedienteId,
            String expedienteTitle,
            String caseReference,
            UUID documentId,
            Integer pageNumber,
            String excerpt
    ) {}

    @Transactional
    public PageView<FirmSearchHit> search(OmegaPrincipal actor, String rawQuery, int page, int size) {
        int safePage = Math.max(0, page);
        int safeSize = Math.max(1, Math.min(50, size));
        String q = rawQuery == null ? "" : rawQuery.strip();
        if (q.length() < 2) {
            return new PageView<>(List.of(), safePage, safeSize, 0, 0);
        }
        String likePattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        boolean isAdmin = actor.role() == Role.ADMIN;
        UUID tenantId = actor.tenantId();
        UUID userId = actor.userId();

        String baseCte = """
                WITH accessible_cases AS (
                    SELECT e.id, e.title, e.case_reference, e.description, e.updated_at
                    FROM omega_rag.expedientes e
                    WHERE e.tenant_id = ?
                      AND (
                          ? = TRUE
                          OR e.owner_user_id = ?
                          OR EXISTS (
                              SELECT 1 FROM omega_rag.expediente_permissions p
                              WHERE p.tenant_id = e.tenant_id
                                AND p.expediente_id = e.id
                                AND p.user_id = ?
                          )
                      )
                ),
                combined_hits AS (
                    SELECT
                        'METADATA'::text AS match_type,
                        ac.id AS expediente_id,
                        ac.title AS expediente_title,
                        ac.case_reference AS case_reference,
                        CAST(NULL AS UUID) AS document_id,
                        CAST(NULL AS INTEGER) AS page_number,
                        LEFT(COALESCE(NULLIF(ac.description, ''), ac.title), 240) AS excerpt,
                        1 AS rank_group,
                        ac.updated_at AS sort_ts
                    FROM accessible_cases ac
                    WHERE ac.title ILIKE ? ESCAPE '\\'
                       OR ac.case_reference ILIKE ? ESCAPE '\\'
                       OR ac.description ILIKE ? ESCAPE '\\'
                    UNION ALL
                    SELECT
                        'DOCUMENT_TEXT'::text AS match_type,
                        ac.id AS expediente_id,
                        ac.title AS expediente_title,
                        ac.case_reference AS case_reference,
                        c.document_id AS document_id,
                        c.page_number AS page_number,
                        LEFT(c.content, 240) AS excerpt,
                        2 AS rank_group,
                        d.created_at AS sort_ts
                    FROM accessible_cases ac
                    INNER JOIN omega_rag.documents d
                        ON d.tenant_id = ? AND d.expediente_id = ac.id AND d.status = 'INDEXED'
                    INNER JOIN omega_rag.document_chunks c
                        ON c.tenant_id = d.tenant_id AND c.document_id = d.id
                    WHERE c.content ILIKE ? ESCAPE '\\'
                )
                """;

        Long totalObj = jdbc.queryForObject(
                baseCte + "SELECT COUNT(*) FROM combined_hits",
                Long.class,
                tenantId, isAdmin, userId, userId,
                likePattern, likePattern, likePattern,
                tenantId, likePattern
        );
        long total = totalObj == null ? 0L : totalObj;
        int totalPages = total == 0 ? 0 : (int) Math.ceil((double) total / safeSize);

        List<FirmSearchHit> hits = total == 0 ? List.of() : jdbc.query(
                baseCte + """
                        SELECT match_type, expediente_id, expediente_title, case_reference, document_id, page_number, excerpt
                        FROM combined_hits
                        ORDER BY rank_group ASC, sort_ts DESC, expediente_id ASC, page_number ASC NULLS FIRST
                        LIMIT ? OFFSET ?
                        """,
                (rs, rowNum) -> {
                    String docIdStr = rs.getString("document_id");
                    Object pageObj = rs.getObject("page_number");
                    return new FirmSearchHit(
                            rs.getString("match_type"),
                            UUID.fromString(rs.getString("expediente_id")),
                            rs.getString("expediente_title"),
                            rs.getString("case_reference"),
                            docIdStr == null ? null : UUID.fromString(docIdStr),
                            pageObj == null ? null : ((Number) pageObj).intValue(),
                            rs.getString("excerpt")
                    );
                },
                tenantId, isAdmin, userId, userId,
                likePattern, likePattern, likePattern,
                tenantId, likePattern,
                safeSize, (long) safePage * safeSize
        );

        audit.record(tenantId, userId, "FIRM_SEARCH_EXECUTED", "TENANT", tenantId.toString(),
                Map.of("page", safePage, "size", safeSize, "totalResults", total));

        return new PageView<>(hits, safePage, safeSize, total, totalPages);
    }
}
