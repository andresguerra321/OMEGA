package com.omega.platform.saas;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "subscriptions", schema = "omega_rag")
public class SubscriptionEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, unique = true)
    private UUID tenantId;

    @Column(name = "plan_code", nullable = false, length = 24)
    private String planCode;

    @Column(name = "status", nullable = false, length = 24)
    private String status;

    @Column(name = "max_devices", nullable = false)
    private int maxDevices;

    @Column(name = "monthly_ai_quota", nullable = false)
    private int monthlyAiQuota;

    @Column(name = "current_period_start", nullable = false)
    private OffsetDateTime currentPeriodStart;

    @Column(name = "current_period_end", nullable = false)
    private OffsetDateTime currentPeriodEnd;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public UUID getTenantId() { return tenantId; }
    public void setTenantId(UUID tenantId) { this.tenantId = tenantId; }

    public String getPlanCode() { return planCode; }
    public void setPlanCode(String planCode) { this.planCode = planCode; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public int getMaxDevices() { return maxDevices; }
    public void setMaxDevices(int maxDevices) { this.maxDevices = maxDevices; }

    public int getMonthlyAiQuota() { return monthlyAiQuota; }
    public void setMonthlyAiQuota(int monthlyAiQuota) { this.monthlyAiQuota = monthlyAiQuota; }

    public OffsetDateTime getCurrentPeriodStart() { return currentPeriodStart; }
    public void setCurrentPeriodStart(OffsetDateTime currentPeriodStart) { this.currentPeriodStart = currentPeriodStart; }

    public OffsetDateTime getCurrentPeriodEnd() { return currentPeriodEnd; }
    public void setCurrentPeriodEnd(OffsetDateTime currentPeriodEnd) { this.currentPeriodEnd = currentPeriodEnd; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
