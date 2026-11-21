package com.omega.platform.ingest;

import com.omega.platform.domain.DocumentChunkEntity;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.ingest.PdfChunkExtractor.ExtractedChunk;
import com.omega.platform.ingest.PdfChunkExtractor.ExtractionResult;
import com.omega.platform.rag.EmbeddingException;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.repository.DocumentChunkRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.service.AuditLogService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Procesador asíncrono Zero-Retention.
 * Garantiza en un bloque `finally` el borrado físico definitivo del PDF temporal y el registro
 * de `temp_deleted_at` + auditoría encadenada SHA-256 sin importar el desenlace.
 */
@Service
public class AsyncDocumentProcessor {

    /**
     * Modelo centinela cuando no existe proveedor de embeddings disponible (p. ej. despliegue sin OPENAI_API_KEY);
     * los fragmentos se persisten con índice léxico GIN `tsvector` y vector neutro compatible con el esquema pgvector.
     */
    public static final String LEXICAL_FALLBACK_MODEL = "lexical-only-tsvector";

    private static final Logger log = LoggerFactory.getLogger(AsyncDocumentProcessor.class);

    private final PdfChunkExtractor pdfChunkExtractor;
    private final EmbeddingProvider embeddingProvider;
    private final DocumentRepository documentRepository;
    private final DocumentChunkRepository documentChunkRepository;
    private final AuditLogService auditLogService;
    private final TransactionTemplate transactionTemplate;
    private final IngestTemporaryFiles temporaryFiles;
    private final OfficeImageExtractor officeImageExtractor;

    public AsyncDocumentProcessor(
            PdfChunkExtractor pdfChunkExtractor,
            EmbeddingProvider embeddingProvider,
            DocumentRepository documentRepository,
            DocumentChunkRepository documentChunkRepository,
            AuditLogService auditLogService,
            TransactionTemplate transactionTemplate,
            IngestTemporaryFiles temporaryFiles,
            OfficeImageExtractor officeImageExtractor
    ) {
        this.pdfChunkExtractor = pdfChunkExtractor;
        this.embeddingProvider = embeddingProvider;
        this.documentRepository = documentRepository;
        this.documentChunkRepository = documentChunkRepository;
        this.auditLogService = auditLogService;
        this.transactionTemplate = transactionTemplate;
        this.temporaryFiles = temporaryFiles;
        this.officeImageExtractor = officeImageExtractor;
    }

    @Async("omegaIngestExecutor")
    public CompletableFuture<DocumentStatus> processAsync(DocumentIngestCommand cmd) {
        DocumentStatus finalStatus = DocumentStatus.FAILED;
        int totalPages = 0;
        boolean ocrApplied = false;
        int persistedChunks = 0;
        String effectiveModel = null;
        boolean lexicalFallbackUsed = false;
        String failureReason = null;

        try {
            ExtractionResult extraction = "PDF".equals(cmd.format())
                    ? pdfChunkExtractor.extractAndChunk(cmd.tempPdfPath()) : officeImageExtractor.extract(cmd.tempPdfPath(), cmd.format());
            totalPages = extraction.totalPages();
            ocrApplied = extraction.ocrApplied();
            List<ExtractedChunk> chunks = extraction.chunks();
            if (chunks.isEmpty()) {
                throw new InvalidDocumentException("No se encontró texto extraíble ni legible por OCR en el PDF.");
            }

            EmbeddingBatchResult embeddingResult = resolveEmbeddingsOrFallback(cmd, chunks);
            List<float[]> vectors = embeddingResult.vectors();
            effectiveModel = embeddingResult.modelName();
            lexicalFallbackUsed = embeddingResult.lexicalFallbackUsed();

            final String modelName = effectiveModel;
            final int pagesCount = totalPages;
            final boolean usedOcr = ocrApplied;

            Integer savedChunks = transactionTemplate.execute(status -> {
                DocumentEntity doc = documentRepository.findByIdAndTenantId(cmd.documentId(), cmd.tenantId())
                        .orElseThrow(() -> new IllegalStateException("Documento no encontrado en transacción async"));

                List<DocumentChunkEntity> entities = new ArrayList<>(chunks.size());
                for (int i = 0; i < chunks.size(); i++) {
                    ExtractedChunk c = chunks.get(i);
                    entities.add(new DocumentChunkEntity(
                            cmd.tenantId(),
                            cmd.documentId(),
                            cmd.expedienteId(),
                            c.content(),
                            vectors.get(i),
                            c.pageNumber(),
                            c.sectionTitle(),
                            c.chunkOrder(),
                            c.tokenCount(),
                            modelName
                    ));
                }

                documentChunkRepository.saveAllAndFlush(entities);
                long verified = documentChunkRepository.countByTenantIdAndDocumentId(cmd.tenantId(), cmd.documentId());
                if (verified != entities.size()) {
                    throw new IllegalStateException("Verificación de chunks persistidos falló: " + verified);
                }

                doc.setEmbeddingModel(modelName);
                doc.setTotalPages(pagesCount);
                doc.setOcrApplied(usedOcr);
                // Publish INDEXED only with the final purge stamp and audit transaction below.
                documentRepository.saveAndFlush(doc);
                return entities.size();
            });
            persistedChunks = savedChunks != null ? savedChunks : 0;

            finalStatus = DocumentStatus.INDEXED;
        } catch (Exception ex) {
            failureReason = ex instanceof InvalidDocumentException ? "TEXT_UNAVAILABLE"
                    : (ex instanceof org.springframework.web.client.RestClientException ? "INDEXER_UNAVAILABLE" : "DOCUMENT_PROCESSING_FAILED");
            log.error("DOCUMENT_PROCESSING_FAILED document={} tenant={}", cmd.documentId(), cmd.tenantId());
        } finally {
            Instant deletedAt = forceDeleteTempFile(cmd.tempPdfPath());
            persistFinalAuditAndDeletionStamp(
                    cmd, finalStatus, totalPages, ocrApplied, persistedChunks,
                    effectiveModel, lexicalFallbackUsed, deletedAt, failureReason
            );
        }

        return CompletableFuture.completedFuture(finalStatus);
    }

    /**
     * Genera embeddings vectoriales o degrada de forma determinista a vector neutro + modelo léxico `tsvector`
     * cuando no hay proveedor remoto disponible (p. ej. despliegue sin `OPENAI_API_KEY`), preservando Zero-Retention.
     */
    private EmbeddingBatchResult resolveEmbeddingsOrFallback(DocumentIngestCommand cmd, List<ExtractedChunk> chunks) {
        List<String> contents = chunks.stream().map(ExtractedChunk::content).toList();
        try {
            List<float[]> vectors = embeddingProvider.embedBatch(contents);
            if (vectors.size() != chunks.size()) {
                throw new IllegalStateException("Cantidad de embeddings distinta al número de fragmentos.");
            }
            return new EmbeddingBatchResult(embeddingProvider.modelName(), vectors, false);
        } catch (EmbeddingException ex) {
            log.warn(
                    "Proveedor de embeddings no disponible para documento {} (tenant={}); indexando en modo léxico tsvector ({})",
                    cmd.documentId(),
                    cmd.tenantId(),
                    "EMBEDDING_UNAVAILABLE"
            );
            int dims = Math.max(1536, embeddingProvider.dimensions());
            float[] zeroVector = new float[dims];
            List<float[]> neutralVectors = new ArrayList<>(chunks.size());
            for (int i = 0; i < chunks.size(); i++) {
                neutralVectors.add(zeroVector);
            }
            return new EmbeddingBatchResult(LEXICAL_FALLBACK_MODEL, neutralVectors, true);
        }
    }

    private Instant forceDeleteTempFile(Path tempPath) { return temporaryFiles.purge(tempPath); }

    private void persistFinalAuditAndDeletionStamp(
            DocumentIngestCommand cmd,
            DocumentStatus finalStatus,
            int totalPages,
            boolean ocrApplied,
            int persistedChunks,
            String effectiveModel,
            boolean lexicalFallbackUsed,
            Instant deletedAt,
            String failureReason
    ) {
        final DocumentStatus resolvedStatus = finalStatus == DocumentStatus.INDEXED && deletedAt != null
                ? DocumentStatus.INDEXED
                : DocumentStatus.FAILED;

        try {
            transactionTemplate.executeWithoutResult(tx -> {
                documentRepository.findByIdAndTenantId(cmd.documentId(), cmd.tenantId()).ifPresent(doc -> {
                    if (doc.getStatus() == DocumentStatus.PROCESSING || resolvedStatus == DocumentStatus.FAILED) {
                        doc.setStatus(resolvedStatus);
                    }
                    if (totalPages > 0) {
                        doc.setTotalPages(totalPages);
                    }
                    doc.setOcrApplied(ocrApplied);
                    doc.setFailureCode(resolvedStatus == DocumentStatus.FAILED
                            ? (deletedAt == null ? "TEMP_DELETE_FAILED" : (failureReason == null ? "DOCUMENT_PROCESSING_FAILED" : failureReason)) : null);
                    if (deletedAt != null) {
                        doc.setTempDeletedAt(deletedAt);
                    }
                    documentRepository.saveAndFlush(doc);
                });

                Map<String, Object> meta = new LinkedHashMap<>();
                meta.put("expedienteId", cmd.expedienteId().toString());
                meta.put("sha256Hash", cmd.sha256Hash());
                meta.put("finalStatus", resolvedStatus.name());
                meta.put("persistedChunks", persistedChunks);
                meta.put("ocrApplied", ocrApplied);
                if (effectiveModel != null) {
                    meta.put("embeddingModel", effectiveModel);
                }
                meta.put("lexicalFallback", lexicalFallbackUsed);
                meta.put("tempDeletedAt", deletedAt != null ? deletedAt.toString() : "DELETE_FAILED");
                if (failureReason != null && !failureReason.isBlank()) {
                    meta.put("errorCode", "DOCUMENT_PROCESSING_FAILED");
                }

                auditLogService.record(
                        cmd.tenantId(),
                        cmd.actorUserId(),
                        resolvedStatus == DocumentStatus.INDEXED
                                ? "DOCUMENT_INDEXED_AND_PURGED"
                                : "DOCUMENT_INGEST_FAILED_AND_PURGED",
                        "DOCUMENT",
                        cmd.documentId().toString(),
                        meta
                );
            });
        } catch (Exception ex) {
            log.error("DOCUMENT_FINAL_AUDIT_FAILED document={}", cmd.documentId());
        }
    }

    private record EmbeddingBatchResult(
            String modelName,
            List<float[]> vectors,
            boolean lexicalFallbackUsed
    ) {
    }

    public record DocumentIngestCommand(
            UUID documentId,
            UUID tenantId,
            UUID expedienteId,
            UUID actorUserId,
            String originalFilename,
            String sha256Hash,
            Path tempPdfPath,
            String format
    ) {
    }
}
