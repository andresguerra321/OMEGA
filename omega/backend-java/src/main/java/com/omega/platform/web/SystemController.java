package com.omega.platform.web;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.cti.PublicSchemaSupport;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Gobernanza agregada del sistema: estadísticas del corpus público, aislamiento de tenant
 * Zero-Retention e integridad de auditoría.
 */
@RestController
@RequestMapping("/api/v1/system")
public class SystemController {

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final PublicSchemaSupport publicSchemaSupport;
    private final AuditLogService auditLogService;
    private final OmegaProperties properties;

    public SystemController(
            NamedParameterJdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService,
            OmegaProperties properties
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.publicSchemaSupport = publicSchemaSupport;
        this.auditLogService = auditLogService;
        this.properties = properties;
    }

    @GetMapping("/governance")
    @Transactional(readOnly = true)
    public GovernanceResponse governance(@AuthenticationPrincipal OmegaPrincipal principal) {
        long reports = 0L;
        long chunks = 0L;
        long publicIocs = 0L;
        long publicCampaigns = 0L;
        List<IndexedSourceItem> indexedSources = List.of();

        if (publicSchemaSupport.hasTable("public.reports")) {
            reports = queryCount("SELECT COUNT(*) FROM public.reports");
            indexedSources = jdbcTemplate.query(
                    """
                    SELECT title, organization, publication_date, ingested_at, source_url
                    FROM public.reports
                    ORDER BY publication_date DESC NULLS LAST, ingested_at DESC
                    LIMIT 50
                    """,
                    (rs, rowNum) -> new IndexedSourceItem(
                            rs.getString("title"),
                            rs.getString("organization"),
                            rs.getDate("publication_date") != null ? rs.getDate("publication_date").toString() : null,
                            rs.getTimestamp("ingested_at") != null ? rs.getTimestamp("ingested_at").toInstant().toString() : null,
                            rs.getString("source_url")
                    )
            );
        }
        if (publicSchemaSupport.hasTable("public.document_chunks")) {
            chunks += queryCount("SELECT COUNT(*) FROM public.document_chunks");
        }
        if (publicSchemaSupport.hasTable("public.iocs")) {
            publicIocs += queryCount("SELECT COUNT(*) FROM public.iocs");
        }
        if (publicSchemaSupport.hasTable("public.campaigns")) {
            publicCampaigns += queryCount("SELECT COUNT(*) FROM public.campaigns");
        }

        long stixIocs = queryCount("SELECT COUNT(*) FROM omega_rag.ioc_indicators");
        long stixCampaigns = queryCount("SELECT COUNT(*) FROM omega_rag.campaigns");

        UUID tenantId = principal.tenantId();
        MapSqlParameterSource tenantParams = new MapSqlParameterSource("tenantId", tenantId);
        long tenantExpedientes = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.expedientes WHERE tenant_id = :tenantId",
                tenantParams
        );
        long tenantDocuments = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.documents WHERE tenant_id = :tenantId",
                tenantParams
        );
        long tenantChunks = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.document_chunks WHERE tenant_id = :tenantId",
                tenantParams
        );
        long purgedPdfs = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.documents WHERE tenant_id = :tenantId AND temp_deleted_at IS NOT NULL",
                tenantParams
        );
        long tenantOsintAssets = publicSchemaSupport.hasTable("omega_rag.osint_monitored_assets")
                ? queryTenantCount(
                        "SELECT COUNT(*) FROM omega_rag.osint_monitored_assets WHERE tenant_id = :tenantId",
                        tenantParams
                )
                : 0L;

        boolean auditChainValid = auditLogService.verifyTenantChain(tenantId).valid();

        return new GovernanceResponse(
                tenantId.toString(),
                properties.rag().embeddingModel(),
                auditChainValid,
                new CorpusStats(
                        reports,
                        chunks + tenantChunks,
                        publicIocs + stixIocs,
                        Math.max(publicCampaigns, stixCampaigns)
                ),
                new TenantStats(
                        tenantExpedientes,
                        tenantDocuments,
                        tenantChunks,
                        purgedPdfs,
                        tenantOsintAssets
                ),
                indexedSources,
                Map.of(
                        "pdf_retention", "zero-retention",
                        "forensic_worker", "ram-only-isolated",
                        "public_corpus_scope", "global-read-only"
                )
        );
    }

    private long queryCount(String sql) {
        Long val = jdbcTemplate.queryForObject(sql, new MapSqlParameterSource(), Long.class);
        return val != null ? val : 0L;
    }

    private long queryTenantCount(String sql, MapSqlParameterSource params) {
        Long val = jdbcTemplate.queryForObject(sql, params, Long.class);
        return val != null ? val : 0L;
    }

    public record CorpusStats(long reports, long chunks, long iocs, long campaigns) {
    }

    public record TenantStats(
            long expedientes,
            long documents,
            long chunks,
            @JsonProperty("zero_retention_purged_pdfs") long zeroRetentionPurgedPdfs,
            @JsonProperty("osint_assets") long osintAssets
    ) {
    }

    public record IndexedSourceItem(
            String title,
            String organization,
            @JsonProperty("publication_date") String publicationDate,
            @JsonProperty("ingested_at") String ingestedAt,
            @JsonProperty("source_url") String sourceUrl
    ) {
    }

    public record GovernanceResponse(
            @JsonProperty("workspace_id") String workspaceId,
            @JsonProperty("embedding_model") String embeddingModel,
            @JsonProperty("audit_chain_valid") boolean auditChainValid,
            @JsonProperty("corpus_stats") CorpusStats corpusStats,
            @JsonProperty("tenant_stats") TenantStats tenantStats,
            @JsonProperty("indexed_sources") List<IndexedSourceItem> indexedSources,
            Map<String, String> guarantees
    ) {
    }
}
