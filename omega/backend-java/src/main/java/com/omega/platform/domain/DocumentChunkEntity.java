package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.Array;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Fragmento indexado en PostgreSQL con vector pgvector(1536) y tsvector autogenerado.
 */
@Entity
@Table(
        name = "document_chunks",
        schema = "omega_rag",
        uniqueConstraints = {
                @UniqueConstraint(name = "uq_chunk_doc_order", columnNames = {"document_id", "chunk_order"})
        }
)
public class DocumentChunkEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "document_id", nullable = false, updatable = false)
    private UUID documentId;

    @Column(name = "expediente_id", nullable = false, updatable = false)
    private UUID expedienteId;

    @Column(name = "content", nullable = false, columnDefinition = "TEXT")
    private String content;

    @JdbcTypeCode(SqlTypes.VECTOR)
    @Array(length = 1536)
    @Column(name = "embedding", nullable = false, columnDefinition = "vector(1536)")
    private float[] embedding;

    @Column(name = "page_number", nullable = false)
    private int pageNumber;

    @Column(name = "section_title", length = 255)
    private String sectionTitle;

    @Column(name = "chunk_order", nullable = false)
    private int chunkOrder;

    @Column(name = "token_count", nullable = false)
    private int tokenCount;

    @Column(name = "embedding_model", nullable = false, length = 120)
    private String embeddingModel;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected DocumentChunkEntity() {
    }

    public DocumentChunkEntity(
            UUID tenantId,
            UUID documentId,
            UUID expedienteId,
            String content,
            float[] embedding,
            int pageNumber,
            String sectionTitle,
            int chunkOrder,
            int tokenCount,
            String embeddingModel
    ) {
        this.tenantId = tenantId;
        this.documentId = documentId;
        this.expedienteId = expedienteId;
        this.content = content;
        this.embedding = embedding;
        this.pageNumber = pageNumber;
        this.sectionTitle = sectionTitle;
        this.chunkOrder = chunkOrder;
        this.tokenCount = tokenCount;
        this.embeddingModel = embeddingModel;
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getDocumentId() {
        return documentId;
    }

    public UUID getExpedienteId() {
        return expedienteId;
    }

    public String getContent() {
        return content;
    }

    public float[] getEmbedding() {
        return embedding;
    }

    public int getPageNumber() {
        return pageNumber;
    }

    public String getSectionTitle() {
        return sectionTitle;
    }

    public int getChunkOrder() {
        return chunkOrder;
    }

    public int getTokenCount() {
        return tokenCount;
    }

    public String getEmbeddingModel() {
        return embeddingModel;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
