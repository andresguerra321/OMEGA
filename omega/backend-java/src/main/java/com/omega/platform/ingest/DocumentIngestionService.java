package com.omega.platform.ingest;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.ExpedienteEntity;
import com.omega.platform.ingest.AsyncDocumentProcessor.DocumentIngestCommand;
import com.omega.platform.ingest.PdfSecuritySanitizer.PdfInspectionResult;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.ResourceNotFoundException;
import com.omega.platform.web.dto.ExpedienteDtos.DocumentMetadataResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * Orquestador síncrono en frontera para ingesta Zero-Retention:
 * valida magic bytes (`%PDF-`), tamaño máximo, calcula SHA-256 en streaming RAM,
 * inspecciona el AST PDF con PDFBox antes de persistir metadatos y delega la extracción al pool @Async.
 */
@Service
public class DocumentIngestionService {

    private static final Logger log = LoggerFactory.getLogger(DocumentIngestionService.class);
    private static final byte[] PDF_MAGIC = "%PDF-".getBytes(StandardCharsets.US_ASCII);

    private final OmegaProperties properties;
    private final ExpedienteAuthorizationService authorizationService;
    private final PdfSecuritySanitizer pdfSecuritySanitizer;
    private final EmbeddingProvider embeddingProvider;
    private final DocumentRepository documentRepository;
    private final AuditLogService auditLogService;
    private final AsyncDocumentProcessor asyncDocumentProcessor;
    private final TransactionTemplate transactionTemplate;

    public DocumentIngestionService(
            OmegaProperties properties,
            ExpedienteAuthorizationService authorizationService,
            PdfSecuritySanitizer pdfSecuritySanitizer,
            EmbeddingProvider embeddingProvider,
            DocumentRepository documentRepository,
            AuditLogService auditLogService,
            AsyncDocumentProcessor asyncDocumentProcessor,
            TransactionTemplate transactionTemplate
    ) {
        this.properties = properties;
        this.authorizationService = authorizationService;
        this.pdfSecuritySanitizer = pdfSecuritySanitizer;
        this.embeddingProvider = embeddingProvider;
        this.documentRepository = documentRepository;
        this.auditLogService = auditLogService;
        this.asyncDocumentProcessor = asyncDocumentProcessor;
        this.transactionTemplate = transactionTemplate;
    }

    public IngestAcceptedResult ingestPdf(
            OmegaPrincipal principal,
            UUID expedienteId,
            MultipartFile file
    ) {
        ExpedienteEntity expediente = authorizationService.requireWriteAccess(principal, expedienteId);
        if (file == null || file.isEmpty()) {
            throw new InvalidDocumentException("Debe adjuntar un archivo PDF no vacío.");
        }

        long maxBytes = properties.ingest().maxPdfBytes();
        if (file.getSize() > maxBytes) {
            throw new InvalidDocumentException("El PDF excede el tamaño máximo permitido de " + maxBytes + " bytes.");
        }

        String sanitizedFilename = sanitizeFilename(file.getOriginalFilename());
        Path tempDir = Path.of(properties.ingest().tempDir());
        try {
            Files.createDirectories(tempDir);
        } catch (IOException ex) {
            throw new IllegalStateException("No se pudo preparar el almacenamiento temporal volátil: " + tempDir, ex);
        }

        Path tempPdfPath = tempDir.resolve(UUID.randomUUID() + ".pdf");
        boolean handedOffToAsync = false;

        try {
            String sha256Hash = streamValidateMagicBytesAndHash(file, tempPdfPath, maxBytes);
            PdfInspectionResult inspection;
            try {
                inspection = pdfSecuritySanitizer.validateCleanPdf(tempPdfPath);
            } catch (UnsafeDocumentException unsafeEx) {
                auditRejectedPdf(principal, expediente.getId(), sanitizedFilename, sha256Hash, unsafeEx.getMessage());
                throw unsafeEx;
            }

            // Confirmar fila PROCESSING + auditoría antes de lanzar el hilo @Async
            DocumentEntity savedDoc = transactionTemplate.execute(tx -> {
                DocumentEntity entity = documentRepository.saveAndFlush(new DocumentEntity(
                        principal.tenantId(),
                        expediente.getId(),
                        principal.userId(),
                        sanitizedFilename,
                        sha256Hash,
                        inspection.totalPages(),
                        embeddingProvider.modelName(),
                        false,
                        DocumentStatus.PROCESSING
                ));

                auditLogService.record(
                        principal.tenantId(),
                        principal.userId(),
                        "DOCUMENT_INGEST_QUEUED",
                        "DOCUMENT",
                        entity.getId().toString(),
                        Map.of(
                                "expedienteId", expediente.getId().toString(),
                                "originalFilename", sanitizedFilename,
                                "sha256Hash", sha256Hash,
                                "totalPages", inspection.totalPages()
                        )
                );
                return entity;
            });

            if (savedDoc == null) {
                throw new IllegalStateException("No se pudo registrar el documento en PostgreSQL.");
            }

            DocumentIngestCommand cmd = new DocumentIngestCommand(
                    savedDoc.getId(),
                    principal.tenantId(),
                    expediente.getId(),
                    principal.userId(),
                    sanitizedFilename,
                    sha256Hash,
                    tempPdfPath
            );

            CompletableFuture<DocumentStatus> future;
            try {
                future = asyncDocumentProcessor.processAsync(cmd);
                handedOffToAsync = true;
            } catch (TaskRejectedException ex) {
                transactionTemplate.executeWithoutResult(tx -> documentRepository.findByIdAndTenantId(savedDoc.getId(), principal.tenantId())
                        .ifPresent(doc -> {
                            doc.setStatus(DocumentStatus.FAILED);
                            documentRepository.saveAndFlush(doc);
                        }));
                throw new IllegalStateException("Cola de ingestión asíncrona saturada; intente nuevamente.", ex);
            }

            return new IngestAcceptedResult(toMetadataResponse(savedDoc), future);
        } finally {
            if (!handedOffToAsync) {
                try {
                    Files.deleteIfExists(tempPdfPath);
                } catch (IOException ex) {
                    log.error("No se pudo eliminar archivo temporal rechazado {}: {}", tempPdfPath, ex.getMessage());
                }
            }
        }
    }

    @Transactional(readOnly = true)
    public List<DocumentMetadataResponse> listDocuments(OmegaPrincipal principal, UUID expedienteId) {
        authorizationService.requireReadAccess(principal, expedienteId);
        return documentRepository.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(principal.tenantId(), expedienteId)
                .stream()
                .map(DocumentIngestionService::toMetadataResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public DocumentMetadataResponse getDocumentStatus(OmegaPrincipal principal, UUID expedienteId, UUID documentId) {
        authorizationService.requireReadAccess(principal, expedienteId);
        DocumentEntity doc = documentRepository.findByIdAndTenantId(documentId, principal.tenantId())
                .filter(d -> d.getExpedienteId().equals(expedienteId))
                .orElseThrow(() -> new ResourceNotFoundException("Documento no encontrado en el expediente actual"));
        return toMetadataResponse(doc);
    }

    private String streamValidateMagicBytesAndHash(MultipartFile file, Path tempPdfPath, long maxBytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] header = new byte[PDF_MAGIC.length];
            int headerRead = 0;
            long totalRead = 0;

            try (InputStream in = file.getInputStream();
                 OutputStream out = Files.newOutputStream(tempPdfPath)) {
                byte[] buffer = new byte[16 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    totalRead += n;
                    if (totalRead > maxBytes) {
                        throw new InvalidDocumentException("El stream PDF excede el límite máximo permitido.");
                    }
                    if (headerRead < PDF_MAGIC.length) {
                        int toCopy = Math.min(n, PDF_MAGIC.length - headerRead);
                        System.arraycopy(buffer, 0, header, headerRead, toCopy);
                        headerRead += toCopy;
                    }
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                }
            }

            if (headerRead < PDF_MAGIC.length || !Arrays.equals(header, PDF_MAGIC)) {
                throw new InvalidDocumentException("El archivo no presenta la firma binaria mágica '%PDF-'.");
            }

            return HexFormat.of().formatHex(digest.digest());
        } catch (InvalidDocumentException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new InvalidDocumentException("Error leyendo el archivo PDF cargado.", ex);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible", ex);
        }
    }

    private void auditRejectedPdf(
            OmegaPrincipal principal,
            UUID expedienteId,
            String filename,
            String sha256Hash,
            String reason
    ) {
        transactionTemplate.executeWithoutResult(tx -> auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DOCUMENT_REJECTED_UNSAFE_PDF",
                "EXPEDIENTE",
                expedienteId.toString(),
                Map.of(
                        "originalFilename", filename,
                        "sha256Hash", sha256Hash,
                        "reason", reason
                )
        ));
    }

    private static String sanitizeFilename(String raw) {
        if (raw == null || raw.isBlank()) {
            return "documento.pdf";
        }
        String base = raw.replace('\\', '/');
        int idx = base.lastIndexOf('/');
        if (idx >= 0) {
            base = base.substring(idx + 1);
        }
        base = base.replaceAll("[\\x00-\\x1f]", "").trim();
        if (base.isBlank()) {
            base = "documento.pdf";
        }
        return base.length() <= 255 ? base : base.substring(base.length() - 255);
    }

    public static DocumentMetadataResponse toMetadataResponse(DocumentEntity doc) {
        return new DocumentMetadataResponse(
                doc.getId(),
                doc.getTenantId(),
                doc.getExpedienteId(),
                doc.getOriginalFilename(),
                doc.getSha256Hash(),
                doc.getTotalPages(),
                doc.getEmbeddingModel(),
                doc.isOcrApplied(),
                doc.getStatus(),
                doc.getCreatedAt(),
                doc.getTempDeletedAt()
        );
    }

    public record IngestAcceptedResult(
            DocumentMetadataResponse document,
            CompletableFuture<DocumentStatus> processingFuture
    ) {
    }
}
