package com.omega.platform.ingest;

import com.omega.platform.domain.DocumentChunkEntity;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.ingest.PdfChunkExtractor.ExtractedChunk;
import com.omega.platform.ingest.PdfChunkExtractor.ExtractionResult;
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

    private static final Logger log = LoggerFactory.getLogger(AsyncDocumentProcessor.class);

    private final PdfChunkExtractor pdfChunkExtractor;
    private final EmbeddingProvider embeddingProvider;
    private final DocumentRepository documentRepository;
    private final DocumentChunkRepository documentChunkRepository;
    private final AuditLogService auditLogService;
    private final TransactionTemplate transactionTemplate;

    public AsyncDocumentProcessor(
            PdfChunkExtractor pdfChunkExtractor,
            EmbeddingProvider embeddingProvider,
            DocumentRepository documentRepository,
            DocumentChunkRepository documentChunkRepository,
            AuditLogService auditLogService,
            TransactionTemplate transactionTemplate
    ) {
        this.pdfChunkExtractor = pdfChunkExtractor;
        this.embeddingProvider = embeddingProvider;
        this.documentRepository = documentRepository;
        this.documentChunkRepository = documentChunkRepository;
        this.auditLogService = auditLogService;
        this.transactionTemplate = transactionTemplate;
    }

    @Async("omegaIngestExecutor")
    public CompletableFuture<DocumentStatus> processAsync(DocumentIngestCommand cmd) {
        DocumentStatus finalStatus = DocumentStatus.FAILED;
        int totalPages = 0;
        boolean ocrApplied = false;
        int persistedChunks = 0;
        String failureReason = null;

        try {
            ExtractionResult extraction = pdfChunkExtractor.extractAndChunk(cmd.tempPdfPath());
            totalPages = extraction.totalPages();
            ocrApplied = extraction.ocrApplied();
            List<ExtractedChunk> chunks = extraction.chunks();
            if (chunks.isEmpty()) {
                throw new InvalidDocumentException("No se encontró texto extraíble ni legible por OCR en el PDF.");
            }

            List<String> contents = chunks.stream().map(ExtractedChunk::content).toList();
            List<float[]> vectors = embeddingProvider.embedBatch(contents);
            if (vectors.size() != chunks.size()) {
                throw new IllegalStateException("Cantidad de embeddings distinta al número de fragmentos.");
            }

            final String modelName = embeddingProvider.modelName();
            final int pagesCount = totalPages;
            final boolean usedOcr = ocrApplied;

            persistedChunks = Boolean.TRUE.equals(transactionTemplate.execute(status -> {
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

                doc.setTotalPages(pagesCount);
                doc.setOcrApplied(usedOcr);
                doc.setStatus(DocumentStatus.INDEXED);
                documentRepository.saveAndFlush(doc);
                return entities.size();
            })) ? chunks.size() : 0;

            finalStatus = DocumentStatus.INDEXED;
        } catch (Exception ex) {
            failureReason = ex.getMessage();
            log.error("Fallo procesando documento {} (tenant={}): {}", cmd.documentId(), cmd.tenantId(), failureReason, ex);
        } finally {
            Instant deletedAt = forceDeleteTempFile(cmd.tempPdfPath());
            persistFinalAuditAndDeletionStamp(cmd, finalStatus, totalPages, ocrApplied, persistedChunks, deletedAt, failureReason);
        }

        return CompletableFuture.completedFuture(finalStatus);
    }

    private Instant forceDeleteTempFile(Path tempPath) {
        try {
            Files.deleteIfExists(tempPath);
        } catch (Exception ex) {
            log.error("ALERTA CRÍTICA Zero-Retention: no se pudo borrar archivo temporal {}", tempPath, ex);
            return null;
        }
        return Files.exists(tempPath) ? null : Instant.now();
    }

    private void persistFinalAuditAndDeletionStamp(
            DocumentIngestCommand cmd,
            DocumentStatus finalStatus,
            int totalPages,
            boolean ocrApplied,
            int persistedChunks,
            Instant deletedAt,
            String failureReason
    ) {
        final DocumentStatus resolvedStatus = finalStatus == DocumentStatus.INDEXED
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
                    if (deletedAt != null) {
                        doc.setTempDeletedAt(deletedAt);
                    }
                    documentRepository.saveAndFlush(doc);
                });

                Map<String, Object> meta = new LinkedHashMap<>();
                meta.put("expedienteId", cmd.expedienteId().toString());
                meta.put("originalFilename", cmd.originalFilename());
                meta.put("sha256Hash", cmd.sha256Hash());
                meta.put("finalStatus", resolvedStatus.name());
                meta.put("persistedChunks", persistedChunks);
                meta.put("ocrApplied", ocrApplied);
                meta.put("tempDeletedAt", deletedAt != null ? deletedAt.toString() : "DELETE_FAILED");
                if (failureReason != null && !failureReason.isBlank()) {
                    meta.put("error", failureReason.length() > 300 ? failureReason.substring(0, 300) : failureReason);
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
            log.error("Error persistiendo auditoría/temp_deleted_at para documento {}", cmd.documentId(), ex);
        }
    }

    public record DocumentIngestCommand(
            UUID documentId,
            UUID tenantId,
            UUID expedienteId,
            UUID actorUserId,
            String originalFilename,
            String sha256Hash,
            Path tempPdfPath
    ) {
    }
}
