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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
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

    private static final Pattern TOC_NOISE = Pattern.compile("(?i)\\b(contents|table of contents)\\b|\\.{4,}");
    private static final Pattern TRACE_DUMP_NOISE = Pattern.compile("(?i)\\b(appendix\\s+[a-z]\\b|detailed traces per target|sms with link to)\\b");
    private static final Pattern EXPLANATORY_PROSE = Pattern.compile("(?i)\\b(is a surveillance|spyware|nso group|commercial surveillance|zero-click|infect|target|operates|mercenary|es un spyware|software esp[íi]a)\\b");
    private static final Pattern TRACE_INTENT = Pattern.compile("(?i)\\b(cve-\\d|ioc|sms|appendix|ap[eé]ndice|hash|dominio|domain|url|ip|traza|trace|indicador)\\b");

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
        int candidateLimit = Math.min(Math.max(topK * 4, 24), 48);

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
                LIMIT :candidateLimit
                """,
                new MapSqlParameterSource()
                        .addValue("lexicalTsQuery", tsQuery)
                        .addValue("hasFilter", hasFilter)
                        .addValue("filterPattern", "%" + rawFilter + "%")
                        .addValue("candidateLimit", candidateLimit),
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

        List<PublicChunkRow> reranked = rerankCandidates(request.question(), rows, topK);

        List<RankedChunk> ranked = reranked.stream()
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

        String responseModel = ranked.isEmpty()
                ? activeModel
                : (answer.startsWith("Resumen extractivo sin síntesis LLM")
                        ? "omega-extractive-fallback"
                        : answerGenerator.resolveActiveGeneratorModel());

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
                responseModel,
                answer,
                List.of(),
                List.of(),
                citations
        );
    }

    static List<PublicChunkRow> rerankCandidates(String question, List<PublicChunkRow> candidates, int topK) {
        if (candidates == null || candidates.size() <= 1) {
            return candidates == null ? List.of() : candidates;
        }
        boolean asksForTraces = TRACE_INTENT.matcher(question == null ? "" : question).find();

        record ScoredRow(PublicChunkRow row, double adjustedScore) {
        }

        List<ScoredRow> scored = new ArrayList<>(candidates.size());
        for (PublicChunkRow row : candidates) {
            String content = row.content() == null ? "" : row.content();
            double weight = 1.0;

            if (!asksForTraces) {
                if (TOC_NOISE.matcher(content).find()) {
                    weight *= 0.22;
                }
                if (TRACE_DUMP_NOISE.matcher(content).find()) {
                    weight *= 0.28;
                }
                if (EXPLANATORY_PROSE.matcher(content).find()) {
                    weight *= 1.48;
                }
                if (row.pageNumber() >= 1 && row.pageNumber() <= 16) {
                    weight *= 1.18;
                }
            }
            // Penalizar ligeramente párrafos demasiado cortos o portadas sin cuerpo
            if (content.length() < 180) {
                weight *= 0.65;
            }
            scored.add(new ScoredRow(row, row.lexScore() * weight));
        }

        scored.sort(Comparator.comparingDouble(ScoredRow::adjustedScore).reversed());

        // Limitar repetición del mismo reporte (máx 2 páginas seguidas por reporte en primera pasada) para mayor diversidad
        List<PublicChunkRow> selected = new ArrayList<>(topK);
        Map<UUID, Integer> perReportCount = new LinkedHashMap<>();
        List<PublicChunkRow> overflow = new ArrayList<>();

        for (ScoredRow entry : scored) {
            if (selected.size() >= topK) break;
            int seen = perReportCount.getOrDefault(entry.row().reportId(), 0);
            if (seen < 2) {
                selected.add(entry.row());
                perReportCount.put(entry.row().reportId(), seen + 1);
            } else {
                overflow.add(entry.row());
            }
        }
        for (PublicChunkRow extra : overflow) {
            if (selected.size() >= topK) break;
            selected.add(extra);
        }
        return selected;
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
