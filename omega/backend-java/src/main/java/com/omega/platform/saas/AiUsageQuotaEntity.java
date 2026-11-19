package com.omega.platform.saas;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "ai_usage_quotas", schema = "omega_rag")
public class AiUsageQuotaEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "period_ym", nullable = false, length = 7)
    private String periodYm;

    @Column(name = "cloud_queries_used", nullable = false)
    private int cloudQueriesUsed;

    @Column(name = "vision_queries_used", nullable = false)
    private int visionQueriesUsed;

    @Column(name = "sovereign_queries_used", nullable = false)
    private int sovereignQueriesUsed;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public UUID getTenantId() { return tenantId; }
    public void setTenantId(UUID tenantId) { this.tenantId = tenantId; }

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }

    public String getPeriodYm() { return periodYm; }
    public void setPeriodYm(String periodYm) { this.periodYm = periodYm; }

    public int getCloudQueriesUsed() { return cloudQueriesUsed; }
    public void setCloudQueriesUsed(int cloudQueriesUsed) { this.cloudQueriesUsed = cloudQueriesUsed; }

    public int getVisionQueriesUsed() { return visionQueriesUsed; }
    public void setVisionQueriesUsed(int visionQueriesUsed) { this.visionQueriesUsed = visionQueriesUsed; }

    public int getSovereignQueriesUsed() { return sovereignQueriesUsed; }
    public void setSovereignQueriesUsed(int sovereignQueriesUsed) { this.sovereignQueriesUsed = sovereignQueriesUsed; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
