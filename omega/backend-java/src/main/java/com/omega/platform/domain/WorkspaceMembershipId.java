package com.omega.platform.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class WorkspaceMembershipId implements Serializable {

    private UUID tenantId;
    private UUID userId;

    public WorkspaceMembershipId() {
    }

    public WorkspaceMembershipId(UUID tenantId, UUID userId) {
        this.tenantId = tenantId;
        this.userId = userId;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getUserId() {
        return userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof WorkspaceMembershipId that)) return false;
        return Objects.equals(tenantId, that.tenantId) && Objects.equals(userId, that.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tenantId, userId);
    }
}
