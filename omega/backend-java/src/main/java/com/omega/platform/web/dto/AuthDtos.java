package com.omega.platform.web.dto;

import com.omega.platform.security.Role;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterTenantRequest(
            @NotBlank
            @Pattern(regexp = "^[a-z0-9-]{3,80}$", message = "Slug inválido: solo minúsculas, dígitos y guiones")
            String tenantSlug,
            @NotBlank @Size(min = 2, max = 200) String tenantName,
            @NotBlank @Email @Size(max = 255) String adminEmail,
            @NotBlank @Size(min = 12, max = 128) String adminPassword,
            @NotBlank @Size(min = 2, max = 200) String adminFullName
    ) {
    }

    public record LoginRequest(
            @NotBlank @Size(min = 3, max = 80) String tenantSlug,
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(min = 1, max = 128) String password
    ) {
    }

    public record CreateTenantUserRequest(
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(min = 12, max = 128) String password,
            @NotBlank @Size(min = 2, max = 200) String fullName,
            @NotNull Role role
    ) {
    }

    public record AuthTokenResponse(
            String accessToken,
            String tokenType,
            long expiresInSeconds,
            UUID userId,
            UUID tenantId,
            String tenantSlug,
            String email,
            Role role
    ) {
    }

    public record UserSummaryResponse(
            UUID id,
            UUID tenantId,
            String email,
            String fullName,
            Role role,
            boolean active,
            Instant createdAt
    ) {
    }

    public record PrincipalMeResponse(
            UUID userId,
            UUID tenantId,
            String email,
            Role role
    ) {
    }
}
