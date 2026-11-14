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
 * Activo propio registrado con consentimiento explícito para auditoría OSINT pasiva multi-tenant.
 */
@Entity
@Table(name = "osint_monitored_assets", schema = "omega_rag")
public class OsintMonitoredAssetEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "asset_type", nullable = false, length = 50)
    private String assetType;

    @Column(name = "asset_value", nullable = false, length = 255)
    private String assetValue;

    @Column(name = "explicit_consent", nullable = false)
    private boolean explicitConsent;

    @Column(name = "consented_at", nullable = false, updatable = false)
    private Instant consentedAt;

    @Column(name = "last_checked_at")
    private Instant lastCheckedAt;

    protected OsintMonitoredAssetEntity() {
    }

    public OsintMonitoredAssetEntity(
            UUID tenantId,
            UUID userId,
            String assetType,
            String assetValue,
            boolean explicitConsent
    ) {
        this.tenantId = tenantId;
        this.userId = userId;
        this.assetType = assetType;
        this.assetValue = assetValue;
        this.explicitConsent = explicitConsent;
        this.consentedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getAssetType() {
        return assetType;
    }

    public String getAssetValue() {
        return assetValue;
    }

    public boolean isExplicitConsent() {
        return explicitConsent;
    }

    public Instant getConsentedAt() {
        return consentedAt;
    }

    public Instant getLastCheckedAt() {
        return lastCheckedAt;
    }

    public void markChecked(Instant checkedAt) {
        this.lastCheckedAt = checkedAt;
    }
}
