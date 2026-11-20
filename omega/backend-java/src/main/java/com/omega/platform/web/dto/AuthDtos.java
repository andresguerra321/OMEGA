package com.omega.platform.web.dto;

import com.omega.platform.domain.TenantProfile;
import com.omega.platform.security.Role;
import com.omega.platform.web.ValidationPatterns;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterTenantRequest(
            @NotBlank(message = "El identificador de organización es obligatorio")
            @Pattern(regexp = ValidationPatterns.TENANT_SLUG_REGEX, message = "Slug inválido: solo minúsculas, dígitos y guiones (3 a 80 caracteres)")
            String tenantSlug,
            @NotBlank(message = "El nombre de la organización es obligatorio")
            @Size(min = 2, max = 200, message = "La organización debe tener entre 2 y 200 caracteres")
            @Pattern(regexp = ValidationPatterns.ORGANIZATION_NAME_REGEX, message = "Ingresa un nombre de organización válido (al menos 2 letras, sin símbolos especiales)")
            String tenantName,
            @NotBlank(message = "El correo electrónico es obligatorio")
            @Size(max = 255, message = "El correo no puede superar 255 caracteres")
            @Pattern(regexp = ValidationPatterns.STRICT_EMAIL_REGEX, message = "Ingresa un correo electrónico válido (ej. nombre@organizacion.org)")
            String adminEmail,
            @NotBlank(message = "La contraseña es obligatoria")
            @Size(min = 12, max = 128, message = "La contraseña debe tener entre 12 y 128 caracteres")
            @Pattern(regexp = ValidationPatterns.STRONG_PASSWORD_REGEX, message = "La contraseña debe incluir letras y números o símbolos, sin espacios al inicio ni al final")
            String adminPassword,
            @NotBlank(message = "El nombre completo es obligatorio")
            @Size(min = 2, max = 200, message = "El nombre debe tener entre 2 y 200 caracteres")
            @Pattern(regexp = ValidationPatterns.PERSON_NAME_REGEX, message = "Ingresa un nombre completo válido (solo letras, espacios, apóstrofo o guion; sin números ni símbolos)")
            String adminFullName,
            TenantProfile profile
    ) {
        public RegisterTenantRequest(
                String tenantSlug,
                String tenantName,
                String adminEmail,
                String adminPassword,
                String adminFullName
        ) {
            this(tenantSlug, tenantName, adminEmail, adminPassword, adminFullName, TenantProfile.GENERAL);
        }
    }

    public record RegisterAccountRequest(
            @NotBlank(message = "El nombre completo es obligatorio")
            @Size(min = 2, max = 200, message = "El nombre debe tener entre 2 y 200 caracteres")
            @Pattern(regexp = ValidationPatterns.PERSON_NAME_REGEX, message = "Ingresa un nombre completo válido (solo letras, espacios, apóstrofo o guion; sin números ni símbolos)")
            String fullName,
            @NotBlank(message = "El correo electrónico es obligatorio")
            @Size(max = 255, message = "El correo no puede superar 255 caracteres")
            @Pattern(regexp = ValidationPatterns.STRICT_EMAIL_REGEX, message = "Ingresa un correo electrónico válido (ej. nombre@organizacion.org)")
            String email,
            @NotBlank(message = "La contraseña es obligatoria")
            @Size(min = 12, max = 128, message = "La contraseña debe tener entre 12 y 128 caracteres")
            @Pattern(regexp = ValidationPatterns.STRONG_PASSWORD_REGEX, message = "La contraseña debe incluir letras y números o símbolos, sin espacios al inicio ni al final")
            String password,
            @Size(max = 200, message = "La organización no puede superar 200 caracteres")
            @Pattern(regexp = ValidationPatterns.OPTIONAL_ORGANIZATION_NAME_REGEX, message = "Ingresa un nombre de organización válido (al menos 2 letras, sin símbolos especiales)")
            String organizationName,
            TenantProfile profile
    ) {
        public RegisterAccountRequest(String fullName, String email, String password, String organizationName) {
            this(fullName, email, password, organizationName, TenantProfile.GENERAL);
        }
    }

    public record LoginRequest(
            @Size(max = 80, message = "El identificador de organización no puede superar 80 caracteres")
            @Pattern(regexp = ValidationPatterns.OPTIONAL_TENANT_SLUG_REGEX, message = "Identificador de organización inválido: solo minúsculas, dígitos y guiones")
            String tenantSlug,
            @NotBlank(message = "El correo electrónico es obligatorio")
            @Size(max = 255, message = "El correo no puede superar 255 caracteres")
            @Pattern(regexp = ValidationPatterns.STRICT_EMAIL_REGEX, message = "Ingresa un correo electrónico válido (ej. nombre@organizacion.org)")
            String email,
            @NotBlank(message = "La contraseña es obligatoria")
            @Size(min = 1, max = 128, message = "La contraseña debe tener entre 1 y 128 caracteres")
            String password
    ) {
    }

    public record CreateTenantUserRequest(
            @NotBlank(message = "El correo electrónico es obligatorio")
            @Size(max = 255, message = "El correo no puede superar 255 caracteres")
            @Pattern(regexp = ValidationPatterns.STRICT_EMAIL_REGEX, message = "Ingresa un correo electrónico válido (ej. usuario@organizacion.org)")
            String email,
            @NotBlank(message = "La contraseña es obligatoria")
            @Size(min = 12, max = 128, message = "La contraseña debe tener entre 12 y 128 caracteres")
            @Pattern(regexp = ValidationPatterns.STRONG_PASSWORD_REGEX, message = "La contraseña debe incluir letras y números o símbolos, sin espacios al inicio ni al final")
            String password,
            @NotBlank(message = "El nombre completo es obligatorio")
            @Size(min = 2, max = 200, message = "El nombre debe tener entre 2 y 200 caracteres")
            @Pattern(regexp = ValidationPatterns.PERSON_NAME_REGEX, message = "Ingresa un nombre completo válido (solo letras, espacios, apóstrofo o guion; sin números ni símbolos)")
            String fullName,
            @NotNull(message = "El rol del usuario es obligatorio")
            Role role
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
            Role role,
            boolean mfaRequired,
            String mfaChallengeToken,
            String mfaMethod,
            String maskedEmail,
            String recoveryKey
    ) {
        public AuthTokenResponse(String accessToken, String tokenType, long expiresInSeconds, UUID userId,
                UUID tenantId, String tenantSlug, String email, Role role, boolean mfaRequired,
                String mfaChallengeToken, String mfaMethod, String maskedEmail) {
            this(accessToken, tokenType, expiresInSeconds, userId, tenantId, tenantSlug, email, role,
                    mfaRequired, mfaChallengeToken, mfaMethod, maskedEmail, null);
        }

        public AuthTokenResponse withRecoveryKey(String key) {
            return new AuthTokenResponse(accessToken, tokenType, expiresInSeconds, userId, tenantId,
                    tenantSlug, email, role, mfaRequired, mfaChallengeToken, mfaMethod, maskedEmail, key);
        }

        public AuthTokenResponse(
                String accessToken,
                String tokenType,
                long expiresInSeconds,
                UUID userId,
                UUID tenantId,
                String tenantSlug,
                String email,
                Role role) {
            this(accessToken, tokenType, expiresInSeconds, userId, tenantId, tenantSlug, email, role,
                    false, null, null, null);
        }

        public static AuthTokenResponse mfaChallenge(
                UUID userId,
                UUID tenantId,
                String tenantSlug,
                String email,
                Role role,
                String challengeToken,
                String mfaMethod,
                String maskedEmail) {
            return new AuthTokenResponse(
                    null,
                    "MfaChallenge",
                    300L,
                    userId,
                    tenantId,
                    tenantSlug,
                    email,
                    role,
                    true,
                    challengeToken,
                    mfaMethod,
                    maskedEmail);
        }
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
            String tenantSlug,
            String email,
            Role role
    ) {
        public PrincipalMeResponse(UUID userId, UUID tenantId, String email, Role role) {
            this(userId, tenantId, null, email, role);
        }
    }

    public record PasswordResetRequest(
            @NotBlank(message = "El correo electrónico es obligatorio")
            @Size(max = 255, message = "El correo no puede superar 255 caracteres")
            @Pattern(regexp = ValidationPatterns.STRICT_EMAIL_REGEX, message = "Ingresa un correo electrónico válido (ej. nombre@organizacion.org)")
            String email,
            @Size(max = 80, message = "El identificador de organización no puede superar 80 caracteres")
            @Pattern(regexp = ValidationPatterns.OPTIONAL_TENANT_SLUG_REGEX, message = "Identificador de organización inválido")
            String tenantSlug
    ) {
    }

    public record PasswordResetConfirmRequest(
            @NotBlank(message = "El correo electrónico es obligatorio")
            @Size(max = 255, message = "El correo no puede superar 255 caracteres")
            @Pattern(regexp = ValidationPatterns.STRICT_EMAIL_REGEX, message = "Ingresa un correo electrónico válido")
            String email,
            @NotBlank(message = "El código de recuperación es obligatorio")
            @Pattern(regexp = "^(?:\\d{6}|[a-f0-9]{48})$", message = "Ingresa un código de 6 dígitos o tu clave de recuperación")
            String code,
            @NotBlank(message = "La nueva contraseña es obligatoria")
            @Size(min = 12, max = 128, message = "La contraseña debe tener entre 12 y 128 caracteres")
            @Pattern(regexp = ValidationPatterns.STRONG_PASSWORD_REGEX, message = "La contraseña debe incluir letras y números o símbolos, sin espacios al inicio ni al final")
            String newPassword,
            @Size(max = 80, message = "El identificador de organización no puede superar 80 caracteres")
            @Pattern(regexp = ValidationPatterns.OPTIONAL_TENANT_SLUG_REGEX, message = "Identificador de organización inválido")
            String tenantSlug
    ) {
    }

    public record PasswordResetResponse(
            boolean ok,
            String deliveryMode,
            String message
    ) {
    }

    public record MfaVerifyLoginRequest(
            @NotBlank(message = "El token de verificación es obligatorio")
            String challengeToken,
            @NotBlank(message = "El código de verificación es obligatorio")
            @Size(min = 6, max = 16, message = "El código de verificación no es válido")
            String code
    ) {
    }

    public record MfaChallengeActionRequest(
            @NotBlank(message = "El token de verificación es obligatorio")
            String challengeToken
    ) {
    }

    public record MfaCodeRequest(
            @NotBlank(message = "El código de verificación es obligatorio")
            @Pattern(regexp = "^\\d{6}$", message = "Ingresa un código de 6 dígitos")
            String code
    ) {
    }

    public record MfaDisableRequest(
            @NotBlank(message = "Debes confirmar tu contraseña actual")
            @Size(min = 1, max = 128, message = "Contraseña inválida")
            String password
    ) {
    }

    public record MfaStatusResponse(
            boolean mfaEnabled,
            String method,
            int backupCodesRemaining,
            boolean smtpConfigured
    ) {
    }

    public record MfaTotpSetupResponse(
            String secret,
            String otpauthUri,
            String issuer,
            String accountName
    ) {
    }

    public record MfaEmailSetupResponse(
            boolean sent,
            String deliveryMode,
            String maskedEmail,
            String message
    ) {
    }

    public record MfaActivationResponse(
            boolean mfaEnabled,
            String method,
            List<String> backupCodes,
            String message
    ) {
    }
}
