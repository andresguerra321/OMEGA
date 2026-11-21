package com.omega.platform.config;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Guardas fail-closed para despliegues con perfil {@code prod} (NV-A1, NV-A2, NV-B1).
 * No se activa en perfiles {@code dev} ni {@code test}.
 */
@Component
@Profile("prod")
public class ProductionSecurityStartupValidator implements InitializingBean {

    static final String DEV_DEFAULT_JWT_SECRET =
            "omega-dev-local-only-hmac-sha256-secret-key-2026-change-in-prod";
    private static final int MIN_JWT_SECRET_BYTES = 32;

    private final String jwtSecret;
    private final boolean cookieSecure;

    public ProductionSecurityStartupValidator(
            OmegaProperties properties,
            @Value("${omega.security.session-cookie-secure:false}") boolean cookieSecure
    ) {
        this.jwtSecret = properties != null && properties.security() != null
                ? properties.security().jwtSecret()
                : "";
        this.cookieSecure = cookieSecure;
    }

    @Override
    public void afterPropertiesSet() {
        validate();
    }

    public void validate() {
        String trimmedSecret = jwtSecret == null ? "" : jwtSecret.trim();
        if (trimmedSecret.isEmpty()
                || trimmedSecret.getBytes(StandardCharsets.UTF_8).length < MIN_JWT_SECRET_BYTES
                || DEV_DEFAULT_JWT_SECRET.equals(trimmedSecret)
                || trimmedSecret.toLowerCase(Locale.ROOT).contains("change-in-prod")) {
            throw new IllegalStateException(
                    "Arranque bloqueado en perfil prod (NV-A1): OMEGA_JWT_SECRET debe ser un secreto aleatorio de al menos 32 bytes distinto al valor por defecto.");
        }
        if (!cookieSecure) {
            throw new IllegalStateException(
                    "Arranque bloqueado en perfil prod (NV-A2): OMEGA_COOKIE_SECURE debe ser true en producción.");
        }
    }
}
