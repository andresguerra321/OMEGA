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
@Table(name = "dev_suppressions", schema = "omega_rag")
public class DevSuppressionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "rule_id", nullable = false, length = 80)
    private String ruleId;

    @Column(name = "fingerprint", length = 64)
    private String fingerprint;

    @Column(name = "reason", nullable = false, length = 400)
    private String reason;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected DevSuppressionEntity() {
    }

    public DevSuppressionEntity(
            UUID tenantId,
            UUID projectId,
            String ruleId,
            String fingerprint,
            String reason,
            UUID createdBy,
            Instant expiresAt
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.ruleId = ruleId;
        this.fingerprint = (fingerprint == null || fingerprint.isBlank()) ? null : fingerprint.trim();
        this.reason = reason;
        this.createdBy = createdBy;
        this.expiresAt = expiresAt;
        this.createdAt = Instant.now();
    }

    public boolean isActiveAt(Instant now) {
        if (revokedAt != null) return false;
        return expiresAt == null || expiresAt.isAfter(now);
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getProjectId() { return projectId; }
    public String getRuleId() { return ruleId; }
    public String getFingerprint() { return fingerprint; }
    public String getReason() { return reason; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public void revoke() { this.revokedAt = Instant.now(); }
    public Instant getCreatedAt() { return createdAt; }
}
