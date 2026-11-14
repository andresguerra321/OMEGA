package com.omega.platform.rag;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.rag.RagAnswerGenerator.RankedChunk;
import java.sql.ResultSet;
import java.sql.SQLException;
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
    private static final Set<String> STOP_WORDS = Set.of(
            "que", "los", "las", "una", "uno", "unos", "unas", "con", "por", "para", "como",
            "donde", "sobre", "entre", "esta", "este", "estos", "estas", "ese", "esa", "del",
            "hay", "son", "fue", "fueron", "desde", "hasta", "cual", "cuales", "quien", "quienes",
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
                        ORDER BY ts_rank_cd(c.search_vector, to_tsquery('pg_catalog.simple', :lexicalTsQuery)) DESC, c.id
                    ) AS lex_rank,
                    ts_rank_cd(c.search_vector, to_tsquery('pg_catalog.simple', :lexicalTsQuery)) AS lex_score
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

    static String buildSanitizedOrTsQuery(String question) {
        if (question == null || question.isBlank()) {
            return "";
        }
        String normalized = question.toLowerCase(Locale.ROOT);
        Matcher m = TOKEN_PATTERN.matcher(normalized);
        Set<String> tokens = new LinkedHashSet<>();
        while (m.find() && tokens.size() < 24) {
            String tok = m.group();
            if (!STOP_WORDS.contains(tok)) {
                tokens.add(tok);
            }
        }
        return String.join(" | ", tokens);
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
