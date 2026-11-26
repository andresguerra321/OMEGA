package com.omega.platform.security;

import java.time.Instant;
import java.util.UUID;

public record TenantScope(
        UUID tenantId,
        UUID userId,
        Role role,
        Instant mfaAt
) {
    public TenantScope(UUID tenantId, UUID userId, Role role) {
        this(tenantId, userId, role, null);
    }
}
