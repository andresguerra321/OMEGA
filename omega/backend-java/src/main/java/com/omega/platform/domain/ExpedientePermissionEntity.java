package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "expediente_permissions",
        schema = "omega_rag",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uq_exp_perm_unique",
                        columnNames = {"tenant_id", "expediente_id", "user_id"}
                )
        }
)
public class ExpedientePermissionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "expediente_id", nullable = false, updatable = false)
    private UUID expedienteId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "permission", nullable = false, length = 16)
    private ExpedientePermissionLevel permission;

    @Column(name = "granted_at", nullable = false, updatable = false)
    private Instant grantedAt = Instant.now();

    protected ExpedientePermissionEntity() {
    }

    public ExpedientePermissionEntity(
            UUID tenantId,
            UUID expedienteId,
            UUID userId,
            ExpedientePermissionLevel permission
    ) {
        this.tenantId = tenantId;
        this.expedienteId = expedienteId;
        this.userId = userId;
        this.permission = permission;
        this.grantedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getExpedienteId() {
        return expedienteId;
    }

    public UUID getUserId() {
        return userId;
    }

    public ExpedientePermissionLevel getPermission() {
        return permission;
    }

    public void setPermission(ExpedientePermissionLevel permission) {
        this.permission = permission;
    }

    public Instant getGrantedAt() {
        return grantedAt;
    }
}
