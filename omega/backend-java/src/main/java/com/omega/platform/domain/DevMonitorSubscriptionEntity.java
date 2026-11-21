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
@Table(name = "dev_monitor_subscriptions", schema = "omega_rag")
public class DevMonitorSubscriptionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "enabled", nullable = false)
    private boolean enabled = true;

    @Column(name = "channel", nullable = false, length = 24)
    private String channel = "WEBHOOK";

    @Column(name = "min_severity", nullable = false, length = 16)
    private String minSeverity = "HIGH";

    @Column(name = "last_evaluated_at")
    private Instant lastEvaluatedAt;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected DevMonitorSubscriptionEntity() {
    }

    public DevMonitorSubscriptionEntity(
            UUID tenantId,
            UUID projectId,
            String channel,
            String minSeverity,
            UUID createdBy
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.enabled = true;
        this.channel = (channel == null || channel.isBlank()) ? "WEBHOOK" : channel;
        this.minSeverity = (minSeverity == null || minSeverity.isBlank()) ? "HIGH" : minSeverity;
        this.createdBy = createdBy;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getProjectId() { return projectId; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getChannel() { return channel; }
    public String getMinSeverity() { return minSeverity; }
    public void setMinSeverity(String minSeverity) { this.minSeverity = minSeverity; }
    public Instant getLastEvaluatedAt() { return lastEvaluatedAt; }
    public void setLastEvaluatedAt(Instant lastEvaluatedAt) { this.lastEvaluatedAt = lastEvaluatedAt; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
}
