package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tenants", schema = "omega_rag")
public class TenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "slug", nullable = false, unique = true, length = 80)
    private String slug;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Enumerated(EnumType.STRING)
    @Column(name = "profile", nullable = false, length = 20)
    private TenantProfile profile = TenantProfile.GENERAL;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected TenantEntity() {
    }

    public TenantEntity(String slug, String name) {
        this(slug, name, TenantProfile.GENERAL);
    }

    public TenantEntity(String slug, String name, TenantProfile profile) {
        this.slug = slug;
        this.name = name;
        this.active = true;
        this.profile = profile != null ? profile : TenantProfile.GENERAL;
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public String getSlug() {
        return slug;
    }

    public String getName() {
        return name;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public TenantProfile getProfile() {
        return profile;
    }

    public void setProfile(TenantProfile profile) {
        this.profile = profile != null ? profile : TenantProfile.GENERAL;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
