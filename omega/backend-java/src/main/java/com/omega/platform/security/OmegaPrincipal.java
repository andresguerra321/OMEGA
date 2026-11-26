package com.omega.platform.security;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

public record OmegaPrincipal(
        UUID userId,
        UUID tenantId,
        String email,
        Role role,
        boolean active,
        Instant mfaAt
) implements UserDetails {

    public OmegaPrincipal(UUID userId, UUID tenantId, String email, Role role, boolean active) {
        this(userId, tenantId, email, role, active, null);
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override
    public String getPassword() {
        return "";
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }
}
