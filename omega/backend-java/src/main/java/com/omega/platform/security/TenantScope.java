package com.omega.platform.security;

import java.util.UUID;

public record TenantScope(
        UUID tenantId,
        UUID userId,
        Role role
) {
}
