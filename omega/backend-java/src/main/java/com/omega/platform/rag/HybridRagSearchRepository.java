package com.omega.platform.rag;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.rag.RagAnswerGenerator.RankedChunk;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.text.Normalizer;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Repositorio JDBC nativo para búsqueda híbrida (pgvector coseno + PostgreSQL GIN tsvector)
 * fusionada mediante Reciprocal Rank Fusion (RRF) con aislamiento estricto por tenant y expediente.
 */
@Repository
public class HybridRagSearchRepository {

    private static final Pattern TOKEN_PATTERN = Pattern.compile("[\\p{L}\\p{N}]{3,64}");
    private static final Pattern CVE_PATTERN = Pattern.compile("\\bcve-(\\d{4})-(\\d{4,7})\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern DIACRITICS = Pattern.compile("\\p{M}+");
    private static final Set<String> STOP_WORDS = Set.of(
            "que", "los", "las", "una", "uno", "unos", "unas", "con", "por", "para", "como",
            "donde", "sobre", "entre", "esta", "este", "estos", "estas", "ese", "esa", "esos",
            "esas", "del", "hay", "son", "fue", "fueron", "desde", "hasta", "cual", "cuales",
            "quien", "quienes", "segun", "sus", "sin", "mas", "pero", "estan", "tienen",
            "the", "and", "for", "with", "what", "how", "where", "when", "who", "from", "this", "that", "into"
    );

    private static final String HYBRID_RRF_SQL = """
            WITH vector_candidates AS (
                SELECT
                    c.id,
                    ROW_NUMBER() OVER (ORDER BY (c.embedding <=> CAST(:queryVector AS public.vector)) ASC, c.id) AS vec_rank,
                    (1.0 - (c.embedding <=> CAST(:queryVector AS public.vector))) AS vec_score
                FROM omega_rag.document_chunks c
                INNER JOIN omega_rag.documents d
                    ON d.id = c.document_id
                   AND d.tenant_id = c.tenant_id
                   AND d.expediente_id = c.expediente_id
                WHERE c.tenant_id = :tenantId
                  AND c.expediente_id = :expedienteId
                  AND d.status = 'INDEXED'
                  AND d.embedding_model = :embeddingModel
                  AND c.embedding_model = :embeddingModel
                ORDER BY (c.embedding <=> CAST(:queryVector AS public.vector)) ASC
                LIMIT :candidateLimit
            ),
            lexical_candidates AS (
                SELECT
                    c.id,
                    ROW_NUMBER() OVER (
                        ORDER BY ts_rank_cd(c.search_vector, to_tsquery('pg_catalog.simple', :lexicalTsQuery), 32) DESC, c.id
                    ) AS lex_rank,
                    ts_rank_cd(c.search_vector, to_tsquery('pg_catalog.simple', :lexicalTsQuery), 32) AS lex_score
                FROM omega_rag.document_chunks c
                INNER JOIN omega_rag.documents d
                    ON d.id = c.document_id
                   AND d.tenant_id = c.tenant_id
                   AND d.expediente_id = c.expediente_id
                WHERE :hasLexical = TRUE
                  AND c.tenant_id = :tenantId
                  AND c.expediente_id = :expedienteId
                  AND d.status = 'INDEXED'
                  AND d.embedding_model = :embeddingModel
                  AND c.embedding_model = :embeddingModel
                  AND c.search_vector @@ to_tsquery('pg_catalog.simple', :lexicalTsQuery)
                ORDER BY lex_score DESC
                LIMIT :candidateLimit
            ),
            fused AS (
                SELECT
                    COALESCE(v.id, l.id) AS chunk_id,
                    COALESCE(v.vec_score, 0.0) AS vector_score,
                    COALESCE(l.lex_score, 0.0) AS lexical_score,
                    (
                        COALESCE(:vectorWeight / (:rrfK + v.vec_rank), 0.0) +
                        COALESCE(:lexicalWeight / (:rrfK + l.lex_rank), 0.0)
                    ) AS rrf_score
                FROM vector_candidates v
                FULL OUTER JOIN lexical_candidates l ON v.id = l.id
            )
            SELECT
                c.document_id,
                d.original_filename,
                d.sha256_hash,
                c.page_number,
                c.section_title,
                c.chunk_order,
                c.content,
                f.vector_score,
                f.lexical_score,
                f.rrf_score
            FROM fused f
            INNER JOIN omega_rag.document_chunks c ON c.id = f.chunk_id
            INNER JOIN omega_rag.documents d
                ON d.id = c.document_id
               AND d.tenant_id = c.tenant_id
               AND d.expediente_id = c.expediente_id
            WHERE c.tenant_id = :tenantId
              AND c.expediente_id = :expedienteId
            ORDER BY f.rrf_score DESC, f.vector_score DESC, c.page_number ASC, c.chunk_order ASC
            LIMIT :topK
            """;

    private static final String LEXICAL_ONLY_SQL = """
            WITH lexical_ranked AS (
                SELECT
                    c.id,
                    ROW_NUMBER() OVER (
                        ORDER BY ts_rank_cd(c.search_vector, to_tsquery('pg_catalog.simple', :lexicalTsQuery), 32) DESC, c.id
                    ) AS lex_rank,
                    ts_rank_cd(c.search_vector, to_tsquery('pg_catalog.simple', :lexicalTsQuery), 32) AS lex_score
                FROM omega_rag.document_chunks c
                INNER JOIN omega_rag.documents d
                    ON d.id = c.document_id
                   AND d.tenant_id = c.tenant_id
                   AND d.expediente_id = c.expediente_id
                WHERE c.tenant_id = :tenantId
                  AND c.expediente_id = :expedienteId
                  AND d.status = 'INDEXED'
                  AND d.embedding_model IN (:embeddingModels)
                  AND c.embedding_model IN (:embeddingModels)
                  AND c.search_vector @@ to_tsquery('pg_catalog.simple', :lexicalTsQuery)
                ORDER BY lex_score DESC
                LIMIT :topK
            )
            SELECT
                c.document_id,
                d.original_filename,
                d.sha256_hash,
                c.page_number,
                c.section_title,
                c.chunk_order,
                c.content,
                CAST(0.0 AS double precision) AS vector_score,
                CAST(lr.lex_score AS double precision) AS lexical_score,
                (CAST(:lexicalWeight AS double precision) / (:rrfK + lr.lex_rank)) AS rrf_score
            FROM lexical_ranked lr
            INNER JOIN omega_rag.document_chunks c ON c.id = lr.id
            INNER JOIN omega_rag.documents d
                ON d.id = c.document_id
               AND d.tenant_id = c.tenant_id
               AND d.expediente_id = c.expediente_id
            WHERE c.tenant_id = :tenantId
              AND c.expediente_id = :expedienteId
            ORDER BY lr.lex_score DESC, c.page_number ASC, c.chunk_order ASC
            LIMIT :topK
            """;

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final OmegaProperties properties;

    public HybridRagSearchRepository(NamedParameterJdbcTemplate jdbcTemplate, OmegaProperties properties) {
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
    }

    public List<RankedChunk> searchHybrid(
            UUID tenantId,
            UUID expedienteId,
            String question,
            float[] queryVector,
            String embeddingModel,
            int topK
    ) {
        int safeTopK = Math.max(1, Math.min(topK, 20));
        int candidateLimit = Math.max(safeTopK * 4, 24);
        String tsQuery = buildSanitizedOrTsQuery(question);
        boolean hasLexical = !tsQuery.isBlank();

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("expedienteId", expedienteId)
                .addValue("embeddingModel", embeddingModel)
                .addValue("queryVector", toVectorLiteral(queryVector))
                .addValue("lexicalTsQuery", hasLexical ? tsQuery : "omega_noop")
                .addValue("hasLexical", hasLexical)
                .addValue("candidateLimit", candidateLimit)
                .addValue("topK", safeTopK)
                .addValue("rrfK", (double) properties.rag().rrfK())
                .addValue("vectorWeight", properties.rag().vectorWeight())
                .addValue("lexicalWeight", properties.rag().lexicalWeight());

        return jdbcTemplate.query(HYBRID_RRF_SQL, params, HybridRagSearchRepository::mapRow);
    }

    /**
     * Búsqueda de respaldo léxica pura (`tsvector` GIN) usada cuando el proveedor remoto
     * de embeddings no responde, manteniendo intacto el aislamiento por tenant y expediente.
     */
    public List<RankedChunk> searchLexicalOnly(
            UUID tenantId,
            UUID expedienteId,
            String question,
            String embeddingModel,
            int topK
    ) {
        if (embeddingModel == null || embeddingModel.isBlank()) {
            return List.of();
        }
        return searchLexicalOnly(tenantId, expedienteId, question, List.of(embeddingModel), topK);
    }

    /**
     * Búsqueda de respaldo léxica pura (`tsvector` GIN) sobre uno o más modelos indexados
     * (activos o `lexical-only-tsvector`), manteniendo intacto el aislamiento por tenant y expediente.
     */
    public List<RankedChunk> searchLexicalOnly(
            UUID tenantId,
            UUID expedienteId,
            String question,
            Collection<String> embeddingModels,
            int topK
    ) {
        if (embeddingModels == null || embeddingModels.isEmpty()) {
            return List.of();
        }
        String tsQuery = buildSanitizedOrTsQuery(question);
        if (tsQuery.isBlank()) {
            return List.of();
        }
        int safeTopK = Math.max(1, Math.min(topK, 20));
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("expedienteId", expedienteId)
                .addValue("embeddingModels", List.copyOf(embeddingModels))
                .addValue("lexicalTsQuery", tsQuery)
                .addValue("topK", safeTopK)
                .addValue("rrfK", (double) properties.rag().rrfK())
                .addValue("lexicalWeight", properties.rag().lexicalWeight());

        return jdbcTemplate.query(LEXICAL_ONLY_SQL, params, HybridRagSearchRepository::mapRow);
    }

    public static String buildSanitizedOrTsQuery(String question) {
        if (question == null || question.isBlank()) {
            return "";
        }
        String normalized = question.toLowerCase(Locale.ROOT)
                .replaceAll("[\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212]", "-");
        Set<String> clauses = new LinkedHashSet<>();
        Set<String> cveSubTokensToSkip = new HashSet<>();

        Matcher cveMatcher = CVE_PATTERN.matcher(normalized);
        while (cveMatcher.find() && clauses.size() < 8) {
            String year = cveMatcher.group(1);
            String number = cveMatcher.group(2);
            clauses.add("(cve <-> " + year + " <-> " + number + ")");
            cveSubTokensToSkip.add("cve");
            cveSubTokensToSkip.add(year);
            cveSubTokensToSkip.add(number);
        }

        Matcher m = TOKEN_PATTERN.matcher(normalized);
        while (m.find() && clauses.size() < 24) {
            String tok = m.group();
            String ascii = stripAccents(tok);
            if (!ascii.chars().allMatch(Character::isDigit)
                    && !STOP_WORDS.contains(ascii)
                    && !cveSubTokensToSkip.contains(ascii)) {
                clauses.add(tok);
            }
        }
        return String.join(" | ", clauses);
    }

    private static String stripAccents(String value) {
        return DIACRITICS.matcher(Normalizer.normalize(value, Normalizer.Form.NFD)).replaceAll("");
    }

    static String toVectorLiteral(float[] vector) {
        StringBuilder sb = new StringBuilder(vector.length * 10);
        sb.append('[');
        for (int i = 0; i < vector.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(String.format(Locale.ROOT, "%.7f", vector[i]));
        }
        sb.append(']');
        return sb.toString();
    }

    private static RankedChunk mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new RankedChunk(
                UUID.fromString(rs.getString("document_id")),
                rs.getString("original_filename"),
                rs.getString("sha256_hash"),
                rs.getInt("page_number"),
                rs.getString("section_title"),
                rs.getInt("chunk_order"),
                rs.getString("content"),
                rs.getDouble("vector_score"),
                rs.getDouble("lexical_score"),
                rs.getDouble("rrf_score")
        );
    }
}
