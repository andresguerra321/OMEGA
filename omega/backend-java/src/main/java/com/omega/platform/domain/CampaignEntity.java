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
@Table(name = "campaigns", schema = "omega_rag")
public class CampaignEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "external_stix_id", unique = true, length = 255)
    private String externalStixId;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "spyware_family", nullable = false, length = 120)
    private String spywareFamily;

    @Column(name = "suspected_actor", length = 255)
    private String suspectedActor;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "source_feed", length = 255)
    private String sourceFeed;

    @Column(name = "first_seen_at")
    private Instant firstSeenAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected CampaignEntity() {
    }

    public CampaignEntity(
            String externalStixId,
            String name,
            String spywareFamily,
            String suspectedActor,
            String description,
            String sourceFeed,
            Instant firstSeenAt
    ) {
        this.externalStixId = externalStixId;
        this.name = name;
        this.spywareFamily = spywareFamily;
        this.suspectedActor = suspectedActor;
        this.description = description;
        this.sourceFeed = sourceFeed;
        this.firstSeenAt = firstSeenAt;
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public String getExternalStixId() {
        return externalStixId;
    }

    public String getName() {
        return name;
    }

    public String getSpywareFamily() {
        return spywareFamily;
    }

    public String getSuspectedActor() {
        return suspectedActor;
    }

    public String getDescription() {
        return description;
    }

    public String getSourceFeed() {
        return sourceFeed;
    }

    public Instant getFirstSeenAt() {
        return firstSeenAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
