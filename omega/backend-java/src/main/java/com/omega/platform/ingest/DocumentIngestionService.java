package com.omega.platform.ingest;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.ExpedienteEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.ingest.AsyncDocumentProcessor.DocumentIngestCommand;
import com.omega.platform.ingest.PdfSecuritySanitizer.PdfInspectionResult;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.ResourceNotFoundException;
import com.omega.platform.storage.ObjectStoragePort;
import com.omega.platform.storage.StorageKeyGenerator;
import com.omega.platform.storage.StorageProperties;
import com.omega.platform.web.dto.ExpedienteDtos.DocumentMetadataResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
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
 * valida magic bytes (`%PDF-`), tamaño máximo, calcula SHA-256 en streaming
 * RAM,
 * inspecciona el AST PDF con PDFBox antes de persistir metadatos y delega la
 * extracción al pool @Async.
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
    private final TenantRepository tenantRepository;
    private final IngestTemporaryFiles temporaryFiles;
    private final OfficeImageExtractor officeImageExtractor;
    private final com.omega.platform.service.LegalDocumentAiService legalAi;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.service.LegalQuotaService legalQuotaService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private ObjectStoragePort objectStoragePort;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private StorageProperties storageProperties;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private StorageKeyGenerator storageKeyGenerator;

    public DocumentIngestionService(
            OmegaProperties properties,
            ExpedienteAuthorizationService authorizationService,
            PdfSecuritySanitizer pdfSecuritySanitizer,
            EmbeddingProvider embeddingProvider,
            DocumentRepository documentRepository,
            AuditLogService auditLogService,
            AsyncDocumentProcessor asyncDocumentProcessor,
            TransactionTemplate transactionTemplate,
            TenantRepository tenantRepository,
            IngestTemporaryFiles temporaryFiles,
            OfficeImageExtractor officeImageExtractor,
            com.omega.platform.service.LegalDocumentAiService legalAi) {
        this.properties = properties;
        this.authorizationService = authorizationService;
        this.pdfSecuritySanitizer = pdfSecuritySanitizer;
        this.embeddingProvider = embeddingProvider;
        this.documentRepository = documentRepository;
        this.auditLogService = auditLogService;
        this.asyncDocumentProcessor = asyncDocumentProcessor;
        this.transactionTemplate = transactionTemplate;
        this.tenantRepository = tenantRepository;
        this.temporaryFiles = temporaryFiles;
        this.officeImageExtractor = officeImageExtractor;
        this.legalAi = legalAi;
    }

    public IngestAcceptedResult ingestPdf(
            OmegaPrincipal principal,
            UUID expedienteId,
            MultipartFile file) {
        ExpedienteEntity expediente = authorizationService.requireWriteAccess(principal, expedienteId);
        legalAi.requireConsent(principal);
        if (file == null || file.isEmpty()) {
            throw new InvalidDocumentException("Debe adjuntar un archivo PDF no vacío.");
        }

        long maxBytes = properties.ingest().maxPdfBytes();
        if (file.getSize() > maxBytes) {
            throw new InvalidDocumentException("El PDF excede el tamaño máximo permitido de " + maxBytes + " bytes.");
        }

        var quotaReservation = legalQuotaService != null
                ? legalQuotaService.reserveUploadSlot(principal, expedienteId)
                : null;
        String sanitizedFilename = sanitizeFilename(file.getOriginalFilename());
        boolean allowExtraFormats = tenantRepository.findByIdAndActiveTrue(principal.tenantId())
                .map(tenant -> tenant.getProfile() == TenantProfile.LEGAL).orElse(false);
        Path tempDir = Path.of(properties.ingest().tempDir());
        try {
            Files.createDirectories(tempDir);
        } catch (IOException ex) {
            throw new IllegalStateException("INGEST_TEMP_UNAVAILABLE");
        }

        Path tempPdfPath = tempDir.resolve(UUID.randomUUID() + ".pdf");
        temporaryFiles.register(tempPdfPath);
        boolean handedOffToAsync = false;

        try {
            String sha256Hash = streamValidateMagicBytesAndHash(file, tempPdfPath, maxBytes, allowExtraFormats);
            PdfInspectionResult inspection;
            String format;
            boolean isPdf;
            try (var header = Files.newInputStream(tempPdfPath)) {
                isPdf = Arrays.equals(header.readNBytes(5), PDF_MAGIC);
            } catch (IOException ex) {
                throw new InvalidDocumentException("No se pudo inspeccionar el documento.");
            }
            try {
                if (isPdf) {
                    format = "PDF";
                    inspection = pdfSecuritySanitizer.validateCleanPdf(tempPdfPath);
                } else {
                    var extra = officeImageExtractor.inspect(tempPdfPath);
                    format = extra.format();
                    inspection = new PdfInspectionResult(extra.pages());
                }
            } catch (UnsafeDocumentException | InvalidDocumentException unsafeEx) {
                recordRejectedDocument(principal, expediente.getId(), sanitizedFilename, sha256Hash,
                        unsafeEx instanceof UnsafeDocumentException ? "UNSAFE_PDF" : "INVALID_FORMAT", tempPdfPath);
                throw unsafeEx;
            }

            // Confirmar fila PROCESSING + auditoría antes de lanzar el hilo @Async
            DocumentEntity savedDoc = transactionTemplate.execute(tx -> {
                DocumentEntity entity = new DocumentEntity(
                        principal.tenantId(),
                        expediente.getId(),
                        principal.userId(),
                        sanitizedFilename,
                        sha256Hash,
                        inspection.totalPages(),
                        embeddingProvider.modelName(),
                        false,
                        DocumentStatus.PROCESSING);
                var tenant = tenantRepository.findActiveForUpdate(principal.tenantId())
                        .orElseThrow(() -> new ResourceNotFoundException("Tenant activo no encontrado"));
                legalAi.requireConsent(principal);
                if (!"PDF".equals(format) && tenant.getProfile() != TenantProfile.LEGAL)
                    throw new InvalidDocumentException("Este perfil solo admite PDF.");
                if (tenant.getProfile() == TenantProfile.LEGAL
                        && documentRepository.existsByTenantIdAndExpedienteIdAndSha256HashAndStatusIn(
                                principal.tenantId(),
                                expediente.getId(),
                                sha256Hash,
                                List.of(DocumentStatus.PROCESSING, DocumentStatus.INDEXED,
                                        DocumentStatus.REINDEX_REQUIRED))) {
                    throw new com.omega.platform.service.ConflictException(
                            "Este documento ya fue cargado en este expediente (mismo hash SHA-256).");
                }
                entity.setDocumentFormat(format);
                if (tenant.getProfile() != null) {
                    entity.setCorpusScope(tenant.getProfile());
                }
                documentRepository.saveAndFlush(entity);

                auditLogService.record(
                        principal.tenantId(),
                        principal.userId(),
                        "DOCUMENT_INGEST_QUEUED",
                        "DOCUMENT",
                        entity.getId().toString(),
                        Map.of(
                                "expedienteId", expediente.getId().toString(),
                                "sha256Hash", sha256Hash,
                                "totalPages", inspection.totalPages()));
                return entity;
            });

            if (savedDoc == null) {
                throw new IllegalStateException("No se pudo registrar el documento en PostgreSQL.");
            }

            // Almacenamiento opcional S3-compatible (MinIO): solo si la retención está explícitamente habilitada.
            // En modo zero-retention (por defecto) se omite por completo y el flujo queda intacto.
            if (storageProperties != null && storageProperties.isRetentionEnabled()
                    && objectStoragePort != null && storageKeyGenerator != null) {
                String vaultBucket = storageProperties.getMinio().getVaultBucket();
                String objectKey = storageKeyGenerator.generateDocumentKey(expediente.getId(), savedDoc.getId());
                String contentType = resolveContentTypeForFormat(format);
                try (InputStream in = Files.newInputStream(tempPdfPath)) {
                    long sanitizedSize = Files.size(tempPdfPath);
                    objectStoragePort.putObject(vaultBucket, objectKey, in, sanitizedSize, contentType);
                } catch (IOException ex) {
                    throw new com.omega.platform.storage.ObjectStorageException("Error leyendo el documento sanitizado para almacenamiento.", ex);
                }
                Instant retentionUntil = Instant.now().plus(Duration.ofDays(storageProperties.getDefaultRetentionDays()));
                transactionTemplate.executeWithoutResult(tx -> documentRepository
                        .findByIdAndTenantId(savedDoc.getId(), principal.tenantId())
                        .ifPresent(doc -> {
                            doc.setStorageBucket(vaultBucket);
                            doc.setStorageObjectKey(objectKey);
                            doc.setContentSha256(sha256Hash);
                            doc.setRetentionUntil(retentionUntil);
                            documentRepository.saveAndFlush(doc);
                            auditLogService.record(
                                    principal.tenantId(),
                                    principal.userId(),
                                    "DOCUMENT_OBJECT_STORED",
                                    "DOCUMENT",
                                    doc.getId().toString(),
                                    Map.of(
                                            "expedienteId", expediente.getId().toString(),
                                            "bucket", vaultBucket,
                                            "sha256Hash", sha256Hash
                                    )
                            );
                        }));
            }

            DocumentIngestCommand cmd = new DocumentIngestCommand(
                    savedDoc.getId(),
                    principal.tenantId(),
                    expediente.getId(),
                    principal.userId(),
                    sanitizedFilename,
                    sha256Hash,
                    tempPdfPath,
                    format);

            CompletableFuture<DocumentStatus> future;
            try {
                future = asyncDocumentProcessor.processAsync(cmd);
                handedOffToAsync = true;
            } catch (TaskRejectedException ex) {
                transactionTemplate.executeWithoutResult(
                        tx -> documentRepository.findByIdAndTenantId(savedDoc.getId(), principal.tenantId())
                                .ifPresent(doc -> {
                                    doc.setStatus(DocumentStatus.FAILED);
                                    documentRepository.saveAndFlush(doc);
                                }));
                throw new IllegalStateException("Cola de ingestión asíncrona saturada; intente nuevamente.", ex);
            }

            return new IngestAcceptedResult(toMetadataResponse(savedDoc), future);
        } finally {
            if (!handedOffToAsync) {
                temporaryFiles.purge(tempPdfPath);
                if (legalQuotaService != null) {
                    legalQuotaService.releaseUploadReservation(quotaReservation);
                }
            } else if (legalQuotaService != null) {
                legalQuotaService.commitUploadReservation(quotaReservation);
            }
        }
    }

    @Transactional(readOnly = true)
    public List<DocumentMetadataResponse> listDocuments(OmegaPrincipal principal, UUID expedienteId) {
        authorizationService.requireReadAccess(principal, expedienteId);
        return documentRepository
                .findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(principal.tenantId(), expedienteId)
                .stream()
                .map(DocumentIngestionService::toMetadataResponse)
                .toList();
    }

    @Transactional
    public List<DocumentMetadataResponse> markReindexRequired(OmegaPrincipal principal, UUID expedienteId) {
        authorizationService.requireWriteAccess(principal, expedienteId);
        var documents = documentRepository.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(principal.tenantId(),
                expedienteId);
        int changed = 0;
        for (var document : documents) {
            if (document.getStatus() == DocumentStatus.INDEXED
                    && !embeddingProvider.modelName().equals(document.getEmbeddingModel())
                    && !AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL.equals(document.getEmbeddingModel())) {
                document.setStatus(DocumentStatus.REINDEX_REQUIRED);
                changed++;
            }
        }
        documentRepository.saveAll(documents);
        auditLogService.record(principal.tenantId(), principal.userId(), "DOCUMENT_REINDEX_MARKED", "EXPEDIENTE",
                expedienteId.toString(), Map.of("documentCount", changed));
        return documents.stream().map(DocumentIngestionService::toMetadataResponse).toList();
    }

    @Transactional
    public void deleteDocument(OmegaPrincipal principal, UUID expedienteId, UUID documentId) {
        authorizationService.requireWriteAccess(principal, expedienteId);
        DocumentEntity document = documentRepository.findByIdAndTenantId(documentId, principal.tenantId())
                .filter(doc -> doc.getExpedienteId().equals(expedienteId))
                .orElseThrow(() -> new ResourceNotFoundException("Documento no encontrado"));
        String bucket = document.getStorageBucket();
        String objectKey = document.getStorageObjectKey();
        documentRepository.delete(document);
        documentRepository.flush();
        boolean objectPurged = false;
        if (bucket != null && !bucket.isBlank() && objectKey != null && !objectKey.isBlank() && objectStoragePort != null) {
            objectStoragePort.deleteObject(bucket, objectKey);
            objectPurged = true;
        }
        auditLogService.record(principal.tenantId(), principal.userId(), "DOCUMENT_DELETED", "EXPEDIENTE",
                expedienteId.toString(), Map.of(
                        "documentId", documentId.toString(),
                        "sha256Hash", document.getSha256Hash(),
                        "objectPurged", objectPurged
                ));
    }

    @Transactional
    public DocumentDownloadStream downloadDocument(OmegaPrincipal principal, UUID expedienteId, UUID documentId) {
        authorizationService.requireReadAccess(principal, expedienteId);
        DocumentEntity doc = documentRepository.findByIdAndTenantId(documentId, principal.tenantId())
                .filter(d -> d.getExpedienteId().equals(expedienteId))
                .orElseThrow(() -> new ResourceNotFoundException("Documento no encontrado en el expediente actual"));
        if (doc.getStorageBucket() == null || doc.getStorageBucket().isBlank()
                || doc.getStorageObjectKey() == null || doc.getStorageObjectKey().isBlank()
                || objectStoragePort == null) {
            throw new ResourceNotFoundException("El documento no tiene binario almacenado (modo zero-retention).");
        }
        InputStream stream = objectStoragePort.getObjectStream(doc.getStorageBucket(), doc.getStorageObjectKey());
        String contentType = resolveContentTypeForFormat(doc.getDocumentFormat());
        String ext = resolveExtensionForFormat(doc.getDocumentFormat());
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DOCUMENT_DOWNLOADED",
                "DOCUMENT",
                doc.getId().toString(),
                Map.of(
                        "expedienteId", expedienteId.toString(),
                        "sha256Hash", doc.getContentSha256() != null ? doc.getContentSha256() : doc.getSha256Hash()
                )
        );
        return new DocumentDownloadStream(stream, contentType, doc.getId() + "." + ext);
    }

    private static String resolveContentTypeForFormat(String format) {
        if (format == null) return "application/octet-stream";
        return switch (format.toUpperCase()) {
            case "PDF" -> "application/pdf";
            case "PNG" -> "image/png";
            case "JPEG", "JPG" -> "image/jpeg";
            case "DOCX" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            default -> "application/octet-stream";
        };
    }

    private static String resolveExtensionForFormat(String format) {
        if (format == null) return "bin";
        return switch (format.toUpperCase()) {
            case "PDF" -> "pdf";
            case "PNG" -> "png";
            case "JPEG", "JPG" -> "jpg";
            case "DOCX" -> "docx";
            default -> "bin";
        };
    }

    public record DocumentDownloadStream(InputStream stream, String contentType, String safeDownloadFilename) {}

    @Transactional(readOnly = true)
    public DocumentMetadataResponse getDocumentStatus(OmegaPrincipal principal, UUID expedienteId, UUID documentId) {
        authorizationService.requireReadAccess(principal, expedienteId);
        DocumentEntity doc = documentRepository.findByIdAndTenantId(documentId, principal.tenantId())
                .filter(d -> d.getExpedienteId().equals(expedienteId))
                .orElseThrow(() -> new ResourceNotFoundException("Documento no encontrado en el expediente actual"));
        return toMetadataResponse(doc);
    }

    private String streamValidateMagicBytesAndHash(MultipartFile file, Path tempPdfPath, long maxBytes,
            boolean allowExtraFormats) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] header = new byte[8];
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
                    if (headerRead < header.length) {
                        int toCopy = Math.min(n, header.length - headerRead);
                        System.arraycopy(buffer, 0, header, headerRead, toCopy);
                        headerRead += toCopy;
                    }
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                }
            }

            boolean validPdf = headerRead >= 5 && Arrays.equals(Arrays.copyOf(header, 5), PDF_MAGIC);
            boolean extra = headerRead >= 4
                    && ((header[0] == 'P' && header[1] == 'K' && header[2] == 3 && header[3] == 4)
                            || (header[0] == (byte) 0x89 && header[1] == 'P' && header[2] == 'N' && header[3] == 'G')
                            || (header[0] == (byte) 0xff && header[1] == (byte) 0xd8 && header[2] == (byte) 0xff));
            if (!validPdf && !(allowExtraFormats && extra)) {
                throw new InvalidDocumentException(allowExtraFormats
                        ? "El archivo no presenta una firma binaria válida (PDF, DOCX, PNG o JPEG)."
                        : "El archivo no presenta la firma binaria mágica '%PDF-'.");
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

    private void recordRejectedDocument(OmegaPrincipal principal, UUID expedienteId, String filename,
            String sha256Hash, String code, Path path) {
        var deletedAt = temporaryFiles.purge(path);
        transactionTemplate.executeWithoutResult(tx -> {
            var tenant = tenantRepository.findActiveForUpdate(principal.tenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant activo no encontrado"));
            if (tenant.getProfile() != TenantProfile.LEGAL) {
                auditLogService.record(principal.tenantId(), principal.userId(), "DOCUMENT_REJECTED_UNSAFE_PDF",
                        "EXPEDIENTE",
                        expedienteId.toString(), Map.of("sha256Hash", sha256Hash, "reasonCode", code));
                return;
            }
            var document = new DocumentEntity(principal.tenantId(), expedienteId, principal.userId(), filename,
                    sha256Hash, 0, embeddingProvider.modelName(), false, DocumentStatus.REJECTED);
            if (tenant.getProfile() == TenantProfile.LEGAL)
                document.setCorpusScope(TenantProfile.LEGAL);
            document.setFailureCode(code);
            document.setTempDeletedAt(deletedAt);
            documentRepository.saveAndFlush(document);
            auditLogService.record(principal.tenantId(), principal.userId(), "DOCUMENT_REJECTED_UNSAFE_PDF", "DOCUMENT",
                    document.getId().toString(),
                    Map.of("expedienteId", expedienteId.toString(), "sha256Hash", sha256Hash, "reasonCode", code));
        });
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
                doc.getTempDeletedAt());
    }

    private String resolveTenantCorpusScope(UUID tenantId) {
        if (tenantRepository == null || tenantId == null) {
            return TenantProfile.GENERAL.name();
        }
        return tenantRepository.findByIdAndActiveTrue(tenantId)
                .map(t -> t.getProfile() != null ? t.getProfile().name() : TenantProfile.GENERAL.name())
                .orElse(TenantProfile.GENERAL.name());
    }

    public record IngestAcceptedResult(
            DocumentMetadataResponse document,
            CompletableFuture<DocumentStatus> processingFuture) {
    }
}
