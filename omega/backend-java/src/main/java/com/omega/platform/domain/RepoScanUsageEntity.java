package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "repo_scan_usage", schema = "omega_rag")
public class RepoScanUsageEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "period_ym", nullable = false, length = 7)
    private String periodYm;

    @Column(name = "scans_used", nullable = false)
    private int scansUsed;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected RepoScanUsageEntity() {
    }

    public RepoScanUsageEntity(UUID id, UUID tenantId, String periodYm, int scansUsed, Instant updatedAt) {
        this.id = id;
        this.tenantId = tenantId;
        this.periodYm = periodYm;
        this.scansUsed = scansUsed;
        this.updatedAt = updatedAt;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public String getPeriodYm() {
        return periodYm;
    }

    public int getScansUsed() {
        return scansUsed;
    }

    public void setScansUsed(int scansUsed) {
        this.scansUsed = scansUsed;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
