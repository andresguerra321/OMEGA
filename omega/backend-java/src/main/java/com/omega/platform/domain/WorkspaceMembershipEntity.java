package com.omega.platform.domain;

import com.omega.platform.security.Role;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workspace_memberships", schema = "omega_rag")
@IdClass(WorkspaceMembershipId.class)
public class WorkspaceMembershipEntity {

    @Id
    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, length = 24)
    private Role role;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Column(name = "granted_by_user_id")
    private UUID grantedByUserId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected WorkspaceMembershipEntity() {
    }

    public WorkspaceMembershipEntity(UUID tenantId, UUID userId, Role role, boolean active, UUID grantedByUserId) {
        this.tenantId = tenantId;
        this.userId = userId;
        this.role = role;
        this.active = active;
        this.grantedByUserId = grantedByUserId;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getUserId() {
        return userId;
    }

    public Role getRole() {
        return role;
    }

    public void setRole(Role role) {
        this.role = role;
        this.updatedAt = Instant.now();
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
        this.updatedAt = Instant.now();
    }

    public UUID getGrantedByUserId() {
        return grantedByUserId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
