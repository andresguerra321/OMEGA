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
@Table(name = "dev_policies", schema = "omega_rag")
public class DevPolicyEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "project_id")
    private UUID projectId;

    @Column(name = "fail_on_severity", nullable = false, length = 16)
    private String failOnSeverity = "HIGH";

    @Column(name = "action_on_violation", nullable = false, length = 24)
    private String actionOnViolation = "FAIL_PIPELINE";

    @Column(name = "allowed_packages_json", nullable = false, columnDefinition = "TEXT")
    private String allowedPackagesJson = "[]";

    @Column(name = "blocked_packages_json", nullable = false, columnDefinition = "TEXT")
    private String blockedPackagesJson = "[]";

    @Column(name = "updated_by")
    private UUID updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected DevPolicyEntity() {
    }

    public DevPolicyEntity(
            UUID tenantId,
            UUID projectId,
            String failOnSeverity,
            String actionOnViolation,
            String allowedPackagesJson,
            String blockedPackagesJson,
            UUID updatedBy
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.failOnSeverity = failOnSeverity == null ? "HIGH" : failOnSeverity;
        this.actionOnViolation = actionOnViolation == null ? "FAIL_PIPELINE" : actionOnViolation;
        this.allowedPackagesJson = allowedPackagesJson == null ? "[]" : allowedPackagesJson;
        this.blockedPackagesJson = blockedPackagesJson == null ? "[]" : blockedPackagesJson;
        this.updatedBy = updatedBy;
        this.updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getProjectId() { return projectId; }
    public String getFailOnSeverity() { return failOnSeverity; }
    public void setFailOnSeverity(String failOnSeverity) { this.failOnSeverity = failOnSeverity; }
    public String getActionOnViolation() { return actionOnViolation; }
    public void setActionOnViolation(String actionOnViolation) { this.actionOnViolation = actionOnViolation; }
    public String getAllowedPackagesJson() { return allowedPackagesJson; }
    public void setAllowedPackagesJson(String allowedPackagesJson) { this.allowedPackagesJson = allowedPackagesJson; }
    public String getBlockedPackagesJson() { return blockedPackagesJson; }
    public void setBlockedPackagesJson(String blockedPackagesJson) { this.blockedPackagesJson = blockedPackagesJson; }
    public UUID getUpdatedBy() { return updatedBy; }
    public void setUpdatedBy(UUID updatedBy) { this.updatedBy = updatedBy; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void touch(UUID updatedBy) {
        this.updatedBy = updatedBy;
        this.updatedAt = Instant.now();
    }
}
