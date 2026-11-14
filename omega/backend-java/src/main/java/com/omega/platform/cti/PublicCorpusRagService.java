package com.omega.platform.cti;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.rag.HybridRagQueryService.RagCitationDto;
import com.omega.platform.rag.HybridRagQueryService.RagQueryResponse;
import com.omega.platform.rag.HybridRagSearchRepository;
import com.omega.platform.rag.RagAnswerGenerator;
import com.omega.platform.rag.RagAnswerGenerator.RankedChunk;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Consulta RAG sobre el corpus público CTI (`public.document_chunks` + `public.reports`),
 * usando búsqueda léxica GIN (`pg_catalog.simple`) y generación grounded con citas obligatorias.
 */
@Service
public class PublicCorpusRagService {

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final PublicSchemaSupport publicSchemaSupport;
    private final RagAnswerGenerator answerGenerator;
    private final OmegaProperties properties;
    private final AuditLogService auditLogService;

    public PublicCorpusRagService(
            NamedParameterJdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport,
            RagAnswerGenerator answerGenerator,
            OmegaProperties properties,
            AuditLogService auditLogService
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.publicSchemaSupport = publicSchemaSupport;
        this.answerGenerator = answerGenerator;
        this.properties = properties;
        this.auditLogService = auditLogService;
    }

    @Transactional
    public RagQueryResponse queryPublicCorpus(OmegaPrincipal principal, PublicCtiQueryRequest request) {
        int topK = request.topK() != null ? Math.max(1, Math.min(request.topK(), 20)) : 6;
        String activeModel = properties.rag().embeddingModel();

        if (!publicSchemaSupport.hasTable("public.document_chunks")
                || !publicSchemaSupport.hasTable("public.reports")) {
            return new RagQueryResponse(
                    "OK_EMPTY",
                    activeModel,
                    "El corpus público de reportes aún no está cargado en este entorno.",
                    List.of("NO_PUBLIC_CORPUS"),
                    List.of(),
                    List.of()
            );
        }

        String tsQuery = HybridRagSearchRepository.buildSanitizedOrTsQuery(request.question());
        if (tsQuery.isBlank()) {
            return new RagQueryResponse(
                    "OK_EMPTY",
                    activeModel,
                    "No se detectaron términos técnicos consultables. Especifica un CVE, familia de spyware o indicador.",
                    List.of(),
                    List.of(),
                    List.of()
            );
        }

        String rawFilter = request.sourceFilter() != null ? request.sourceFilter().trim() : "";
        boolean hasFilter = !rawFilter.isBlank() && !"Todas las fuentes".equalsIgnoreCase(rawFilter);

        List<PublicChunkRow> rows = jdbcTemplate.query(
                """
                SELECT c.report_id,
                       r.title,
                       r.organization,
                       r.source_url,
                       r.file_hash,
                       c.page_number,
                       c.section_title,
                       c.chunk_index,
                       c.content,
                       ts_rank_cd(
                           COALESCE(c.search_vector, to_tsvector('pg_catalog.simple', c.content)),
                           to_tsquery('pg_catalog.simple', :lexicalTsQuery),
                           32
                       ) AS lex_score
                FROM public.document_chunks c
                INNER JOIN public.reports r ON r.id = c.report_id
                WHERE COALESCE(c.search_vector, to_tsvector('pg_catalog.simple', c.content))
                      @@ to_tsquery('pg_catalog.simple', :lexicalTsQuery)
                  AND (:hasFilter = FALSE OR r.organization ILIKE :filterPattern OR r.title ILIKE :filterPattern)
                ORDER BY lex_score DESC, c.id ASC
                LIMIT :topK
                """,
                new MapSqlParameterSource()
                        .addValue("lexicalTsQuery", tsQuery)
                        .addValue("hasFilter", hasFilter)
                        .addValue("filterPattern", "%" + rawFilter + "%")
                        .addValue("topK", topK),
                (rs, rowNum) -> new PublicChunkRow(
                        UUID.fromString(rs.getString("report_id")),
                        rs.getString("title"),
                        rs.getString("organization"),
                        rs.getString("source_url"),
                        rs.getString("file_hash"),
                        rs.getInt("page_number"),
                        rs.getString("section_title"),
                        rs.getInt("chunk_index"),
                        rs.getString("content"),
                        rs.getDouble("lex_score")
                )
        );

        List<RankedChunk> ranked = rows.stream()
                .map(r -> new RankedChunk(
                        r.reportId(),
                        r.title(),
                        r.fileHash(),
                        r.pageNumber(),
                        r.organization() + (r.sectionTitle() != null && !r.sectionTitle().isBlank()
                                ? " · " + r.sectionTitle()
                                : ""),
                        r.chunkIndex(),
                        r.content(),
                        0.0,
                        r.lexScore(),
                        r.lexScore()
                ))
                .toList();

        String answer = ranked.isEmpty()
                ? "No se encontraron pasajes verificados en los informes CTI públicos para esta consulta."
                : answerGenerator.generateGroundedAnswer(request.question(), ranked);

        List<RagCitationDto> citations = ranked.stream()
                .map(c -> new RagCitationDto(
                        c.documentId(),
                        c.originalFilename(),
                        c.sha256Hash(),
                        c.pageNumber(),
                        c.sectionTitle(),
                        c.citationLabel(),
                        c.content().length() > 1500 ? c.content().substring(0, 1497) + "..." : c.content(),
                        c.vectorScore(),
                        c.lexicalScore(),
                        c.rrfScore()
                ))
                .toList();

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "PUBLIC_CTI_RAG_QUERIED",
                "PUBLIC_CTI_CORPUS",
                hasFilter ? rawFilter : "ALL_SOURCES",
                Map.of("citationsCount", citations.size(), "topK", topK)
        );

        return new RagQueryResponse(
                citations.isEmpty() ? "OK_EMPTY" : "OK",
                activeModel,
                answer,
                List.of(),
                List.of(),
                citations
        );
    }

    public record PublicCtiQueryRequest(
            @NotBlank @Size(min = 2, max = 2000) String question,
            @Min(1) @Max(20) Integer topK,
            @JsonProperty("source_filter") String sourceFilter
    ) {
    }

    private record PublicChunkRow(
            UUID reportId,
            String title,
            String organization,
            String sourceUrl,
            String fileHash,
            int pageNumber,
            String sectionTitle,
            int chunkIndex,
            String content,
            double lexScore
    ) {
    }
}
