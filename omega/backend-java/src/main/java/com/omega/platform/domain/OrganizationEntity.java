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
@Table(name = "organizations", schema = "omega_rag")
public class OrganizationEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", nullable = false, length = 160)
    private String name;

    @Column(name = "slug", nullable = false, unique = true, length = 80)
    private String slug;

    @Column(name = "billing_tenant_id", nullable = false, unique = true)
    private UUID billingTenantId;

    @Column(name = "owner_user_id", nullable = false)
    private UUID ownerUserId;

    @Column(name = "legacy_legal_payer", nullable = false)
    private boolean legacyLegalPayer = false;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected OrganizationEntity() {
    }

    public OrganizationEntity(
            String name,
            String slug,
            UUID billingTenantId,
            UUID ownerUserId,
            boolean legacyLegalPayer
    ) {
        this.name = name;
        this.slug = slug;
        this.billingTenantId = billingTenantId;
        this.ownerUserId = ownerUserId;
        this.legacyLegalPayer = legacyLegalPayer;
        this.active = true;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
        this.updatedAt = Instant.now();
    }

    public String getSlug() {
        return slug;
    }

    public UUID getBillingTenantId() {
        return billingTenantId;
    }

    public UUID getOwnerUserId() {
        return ownerUserId;
    }

    public void setOwnerUserId(UUID ownerUserId) {
        this.ownerUserId = ownerUserId;
        this.updatedAt = Instant.now();
    }

    public boolean isLegacyLegalPayer() {
        return legacyLegalPayer;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
        this.updatedAt = Instant.now();
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
