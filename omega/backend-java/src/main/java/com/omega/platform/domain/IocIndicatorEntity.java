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

@Entity
@Table(
        name = "ioc_indicators",
        schema = "omega_rag",
        uniqueConstraints = {
                @UniqueConstraint(name = "uq_rag_ioc_type_normalized", columnNames = {"ioc_type", "normalized_value"})
        }
)
public class IocIndicatorEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "campaign_id")
    private UUID campaignId;

    @Column(name = "external_stix_id", length = 255)
    private String externalStixId;

    @Column(name = "ioc_type", nullable = false, length = 40)
    private String iocType;

    @Column(name = "ioc_value", nullable = false, columnDefinition = "TEXT")
    private String iocValue;

    @Column(name = "normalized_value", nullable = false, columnDefinition = "TEXT")
    private String normalizedValue;

    @Column(name = "stix_pattern", columnDefinition = "TEXT")
    private String stixPattern;

    @Column(name = "context", columnDefinition = "TEXT")
    private String context;

    @Column(name = "source_report", length = 255)
    private String sourceReport;

    @Column(name = "organization", length = 160)
    private String organization;

    @Column(name = "source_url", columnDefinition = "TEXT")
    private String sourceUrl;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected IocIndicatorEntity() {
    }

    public UUID getId() {
        return id;
    }

    public UUID getCampaignId() {
        return campaignId;
    }

    public String getExternalStixId() {
        return externalStixId;
    }

    public String getIocType() {
        return iocType;
    }

    public String getIocValue() {
        return iocValue;
    }

    public String getNormalizedValue() {
        return normalizedValue;
    }

    public String getStixPattern() {
        return stixPattern;
    }

    public String getContext() {
        return context;
    }

    public String getSourceReport() {
        return sourceReport;
    }

    public String getOrganization() {
        return organization;
    }

    public String getSourceUrl() {
        return sourceUrl;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
