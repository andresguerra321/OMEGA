package com.omega.platform.cti;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.ingest.PdfChunkExtractor;
import com.omega.platform.ingest.PdfChunkExtractor.ExtractedChunk;
import com.omega.platform.ingest.PdfChunkExtractor.ExtractionResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Date;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Indexa automáticamente el corpus documental público (`corpus_mvp/pdfs`) en `public.reports` y
 * `public.document_chunks` al iniciar si la base está vacía, garantizando documentación CTI lista
 * desde el primer arranque.
 */
@Service
public class PublicCorpusBootstrapService {

    private static final Logger log = LoggerFactory.getLogger(PublicCorpusBootstrapService.class);
    private static final String ZERO_VECTOR_768 =
            "[" + IntStream.range(0, 768).mapToObj(i -> "0").collect(Collectors.joining(",")) + "]";

    private final ObjectMapper objectMapper;
    private final JdbcTemplate jdbcTemplate;
    private final PublicSchemaSupport publicSchemaSupport;
    private final PdfChunkExtractor pdfChunkExtractor;

    public PublicCorpusBootstrapService(
            ObjectMapper objectMapper,
            JdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport,
            PdfChunkExtractor pdfChunkExtractor
    ) {
        this.objectMapper = objectMapper;
        this.jdbcTemplate = jdbcTemplate;
        this.publicSchemaSupport = publicSchemaSupport;
        this.pdfChunkExtractor = pdfChunkExtractor;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seedPublicCorpusAsync() {
        CompletableFuture.runAsync(this::seedPublicCorpusIfEmpty);
    }

    public void seedPublicCorpusIfEmpty() {
        try {
            if (!publicSchemaSupport.hasTable("public.reports")
                    || !publicSchemaSupport.hasTable("public.document_chunks")) {
                return;
            }
            Long count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM public.reports", Long.class);
            if (count != null && count > 0) {
                return;
            }
            Path manifestPath = resolveManifestPath();
            if (manifestPath == null) {
                return;
            }
            Path pdfsDir = manifestPath.getParent().resolve("pdfs");
            if (!Files.isDirectory(pdfsDir)) {
                return;
            }

            JsonNode entries = objectMapper.readTree(manifestPath.toFile());
            if (!entries.isArray()) {
                return;
            }

            int reportsLoaded = 0;
            int chunksLoaded = 0;

            for (JsonNode item : entries) {
                String filename = item.path("local_filename").asText("").trim();
                if (filename.isBlank()) continue;
                Path pdfPath = pdfsDir.resolve(filename);
                if (!Files.isRegularFile(pdfPath)) continue;

                String actualSha = computeSha256Hex(pdfPath);
                String expectedSha = item.path("expected_sha256").asText("").trim().toLowerCase(Locale.ROOT);
                if (!expectedSha.isBlank() && !expectedSha.equals(actualSha)) {
                    log.warn("Omitido PDF público {} por mismatch SHA-256", filename);
                    continue;
                }

                String title = item.path("title").asText(filename).trim();
                String org = item.path("organization").asText("OMEGA CTI").trim();
                String pubDateStr = item.path("publication_date").asText("").trim();
                String sourceUrl = item.path("source_url").asText("https://omega.local/corpus/" + filename).trim();
                Date pubDate = null;
                if (!pubDateStr.isBlank()) {
                    try {
                        pubDate = Date.valueOf(pubDateStr);
                    } catch (IllegalArgumentException ignored) {
                        pubDate = null;
                    }
                }

                UUID reportId = UUID.randomUUID();
                int insertedReport = jdbcTemplate.update(
                        """
                        INSERT INTO public.reports
                            (id, title, organization, publication_date, source_url, local_filename, file_hash, ingested_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                        ON CONFLICT (file_hash) DO NOTHING
                        """,
                        reportId,
                        truncate(title, 500),
                        truncate(org, 150),
                        pubDate,
                        sourceUrl,
                        truncate(filename, 255),
                        actualSha
                );
                if (insertedReport == 0) {
                    continue;
                }

                ExtractionResult extraction = pdfChunkExtractor.extractAndChunk(pdfPath);
                List<ExtractedChunk> chunks = extraction.chunks();
                for (ExtractedChunk chunk : chunks) {
                    jdbcTemplate.update(
                            """
                            INSERT INTO public.document_chunks
                                (id, report_id, chunk_index, page_number, section_title, content, embedding, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, CAST(? AS vector), NOW())
                            ON CONFLICT (report_id, chunk_index) DO NOTHING
                            """,
                            UUID.randomUUID(),
                            reportId,
                            chunk.chunkOrder(),
                            Math.max(1, chunk.pageNumber()),
                            truncate(chunk.sectionTitle() == null ? "Documento CTI" : chunk.sectionTitle(), 255),
                            chunk.content(),
                            ZERO_VECTOR_768
                    );
                    chunksLoaded++;
                }
                reportsLoaded++;
            }

            if (reportsLoaded > 0) {
                log.info("Bootstrap documental CTI completado: reportes={}, fragmentos={}", reportsLoaded, chunksLoaded);
            }
        } catch (Exception ex) {
            log.warn("Omitido bootstrap documental CTI automático al iniciar: {}", ex.getMessage());
        }
    }

    private static Path resolveManifestPath() {
        List<Path> candidates = List.of(
                Path.of("/app/corpus_mvp/corpus_manifest.json"),
                Path.of("corpus_mvp/corpus_manifest.json"),
                Path.of("../corpus_mvp/corpus_manifest.json")
        );
        for (Path c : candidates) {
            if (Files.isRegularFile(c)) {
                return c;
            }
        }
        return null;
    }

    private static String computeSha256Hex(Path file) throws Exception {
        byte[] content = Files.readAllBytes(file);
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(content);
        return HexFormat.of().formatHex(digest);
    }

    private static String truncate(String s, int maxLen) {
        return s.length() <= maxLen ? s : s.substring(0, maxLen);
    }
}
