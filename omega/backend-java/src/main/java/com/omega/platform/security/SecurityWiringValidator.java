package com.omega.platform.security;

import com.omega.platform.billing.AccountSeatService;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.AuthService;
import com.omega.platform.service.TwoFactorService;
import java.util.Objects;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Validación de arranque (fail-fast) para garantizar que la cadena de MFA,
 * control de intentos persistente y guard de perfil LEGAL nunca queden desactivados en silencio.
 */
@Component
public class SecurityWiringValidator implements SmartInitializingSingleton {

    private final ApplicationContext context;

    public SecurityWiringValidator(ApplicationContext context) {
        this.context = Objects.requireNonNull(context, "ApplicationContext requerido");
    }

    @Override
    public void afterSingletonsInstantiated() {
        requireBean(WorkspaceMfaPolicyService.class);
        requireBean(TwoFactorService.class);
        requireBean(AuthService.class);
        requireBean(AuditLogService.class);
        requireBean(AccountSeatService.class);
        requireBean(TenantRepository.class);
        requireBean(JdbcTemplate.class);
        requireBean(PlatformTransactionManager.class);
        LoginRateLimiter limiter = requireBean(LoginRateLimiter.class);
        if (!limiter.isPersistentBacked()) {
            throw new IllegalStateException(
                    "SECURITY_WIRING_MISSING: LoginRateLimiter debe contar con respaldo persistente en base de datos.");
        }
        requireBean(LegalProfileAccessConfiguration.class);
    }

    private <T> T requireBean(Class<T> beanType) {
        T bean = context.getBeanProvider(beanType).getIfAvailable();
        if (bean == null) {
            throw new IllegalStateException(
                    "SECURITY_WIRING_MISSING: Falta el bean obligatorio de seguridad " + beanType.getName());
        }
        return bean;
    }
}
