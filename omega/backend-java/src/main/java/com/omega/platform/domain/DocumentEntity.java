package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Metadatos probatorios Zero-Retention del PDF indexado.
 * El binario PDF original permanece bajo custodia exclusiva del cliente; el VPS solo conserva SHA-256 y estado.
 */
@Entity
@Table(name = "documents", schema = "omega_rag")
public class DocumentEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "expediente_id", nullable = false, updatable = false)
    private UUID expedienteId;

    @Column(name = "uploaded_by", nullable = false, updatable = false)
    private UUID uploadedBy;

    @Column(name = "original_filename", nullable = false, length = 255)
    private String originalFilename;

    @Column(name = "sha256_hash", nullable = false, length = 64)
    private String sha256Hash;

    @Column(name = "total_pages", nullable = false)
    private int totalPages;

    @Column(name = "embedding_model", nullable = false, length = 120)
    private String embeddingModel;

    @Column(name = "ocr_applied", nullable = false)
    private boolean ocrApplied;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private DocumentStatus status = DocumentStatus.PROCESSING;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "temp_deleted_at")
    private Instant tempDeletedAt;

    protected DocumentEntity() {
    }

    public DocumentEntity(
            UUID tenantId,
            UUID expedienteId,
            UUID uploadedBy,
            String originalFilename,
            String sha256Hash,
            int totalPages,
            String embeddingModel,
            boolean ocrApplied,
            DocumentStatus status
    ) {
        this.tenantId = tenantId;
        this.expedienteId = expedienteId;
        this.uploadedBy = uploadedBy;
        this.originalFilename = originalFilename;
        this.sha256Hash = sha256Hash;
        this.totalPages = totalPages;
        this.embeddingModel = embeddingModel;
        this.ocrApplied = ocrApplied;
        this.status = status == null ? DocumentStatus.PROCESSING : status;
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getExpedienteId() {
        return expedienteId;
    }

    public UUID getUploadedBy() {
        return uploadedBy;
    }

    public String getOriginalFilename() {
        return originalFilename;
    }

    public String getSha256Hash() {
        return sha256Hash;
    }

    public int getTotalPages() {
        return totalPages;
    }

    public void setTotalPages(int totalPages) {
        this.totalPages = totalPages;
    }

    public String getEmbeddingModel() {
        return embeddingModel;
    }

    public boolean isOcrApplied() {
        return ocrApplied;
    }

    public void setOcrApplied(boolean ocrApplied) {
        this.ocrApplied = ocrApplied;
    }

    public DocumentStatus getStatus() {
        return status;
    }

    public void setStatus(DocumentStatus status) {
        this.status = status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getTempDeletedAt() {
        return tempDeletedAt;
    }

    public void setTempDeletedAt(Instant tempDeletedAt) {
        this.tempDeletedAt = tempDeletedAt;
    }
}
