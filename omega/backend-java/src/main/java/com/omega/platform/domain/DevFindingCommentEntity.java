package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "dev_finding_comments", schema = "omega_rag")
public class DevFindingCommentEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "finding_id", nullable = false, updatable = false)
    private UUID findingId;

    @Column(name = "author_user_id", nullable = false, updatable = false)
    private UUID authorUserId;

    @Column(name = "body", nullable = false, columnDefinition = "TEXT")
    private String body;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected DevFindingCommentEntity() {
    }

    public DevFindingCommentEntity(UUID tenantId, UUID findingId, UUID authorUserId, String body) {
        this.tenantId = tenantId;
        this.findingId = findingId;
        this.authorUserId = authorUserId;
        this.body = body;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getFindingId() { return findingId; }
    public UUID getAuthorUserId() { return authorUserId; }
    public String getBody() { return body; }
    public Instant getCreatedAt() { return createdAt; }
}
