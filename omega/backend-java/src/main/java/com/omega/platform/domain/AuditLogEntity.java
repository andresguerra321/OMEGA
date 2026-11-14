package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Entrada inmutable del libro de auditoría probatoria encadenado con SHA-256 por tenant.
 */
@Entity
@Table(name = "audit_logs", schema = "omega_rag")
public class AuditLogEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "chain_seq", insertable = false, updatable = false)
    private Long chainSeq;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "actor_user_id", updatable = false)
    private UUID actorUserId;

    @Column(name = "action", nullable = false, updatable = false, length = 80)
    private String action;

    @Column(name = "resource_type", nullable = false, updatable = false, length = 60)
    private String resourceType;

    @Column(name = "resource_id", updatable = false, length = 120)
    private String resourceId;

    @Column(name = "metadata_json", nullable = false, updatable = false, columnDefinition = "TEXT")
    private String metadataJson;

    @Column(name = "previous_hash", nullable = false, updatable = false, length = 64)
    private String previousHash;

    @Column(name = "current_hash", nullable = false, updatable = false, length = 64)
    private String currentHash;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected AuditLogEntity() {
    }

    public AuditLogEntity(
            UUID tenantId,
            UUID actorUserId,
            String action,
            String resourceType,
            String resourceId,
            String metadataJson,
            String previousHash,
            String currentHash,
            Instant createdAt
    ) {
        this.tenantId = tenantId;
        this.actorUserId = actorUserId;
        this.action = action;
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        this.metadataJson = metadataJson;
        this.previousHash = previousHash;
        this.currentHash = currentHash;
        this.createdAt = createdAt;
    }

    public UUID getId() {
        return id;
    }

    public Long getChainSeq() {
        return chainSeq;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getActorUserId() {
        return actorUserId;
    }

    public String getAction() {
        return action;
    }

    public String getResourceType() {
        return resourceType;
    }

    public String getResourceId() {
        return resourceId;
    }

    public String getMetadataJson() {
        return metadataJson;
    }

    public String getPreviousHash() {
        return previousHash;
    }

    public String getCurrentHash() {
        return currentHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
