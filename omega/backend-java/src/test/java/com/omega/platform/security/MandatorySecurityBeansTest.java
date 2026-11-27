package com.omega.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.omega.platform.billing.AccountIdentityController;
import com.omega.platform.billing.AccountSeatService;
import com.omega.platform.billing.CreditService;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.cti.ForensicDossierExportService;
import com.omega.platform.repository.ExpedienteRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.AuthService;
import com.omega.platform.service.ExpedienteService;
import com.omega.platform.service.PilotOpsService;
import com.omega.platform.service.ProfessionalReportService;
import com.omega.platform.service.TwoFactorService;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.UnsatisfiedDependencyException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * C4: ningún bean de MFA/seguridad puede ser opcional; si falta alguno en el contexto Spring,
 * el arranque debe fallar de forma inmediata (fail-fast).
 */
class MandatorySecurityBeansTest {

    private static final List<Class<?>> SECURITY_TYPES = List.of(
            WorkspaceMfaPolicyService.class,
            TwoFactorService.class,
            LoginRateLimiter.class,
            PlatformTransactionManager.class,
            AuditLogService.class,
            JdbcTemplate.class,
            TenantRepository.class
    );

    @Test
    void securityCriticalDependenciesAreNeverOptional() {
        List<String> offenders = new ArrayList<>();
        for (Class<?> owner : List.of(
                AuthService.class,
                TwoFactorService.class,
                WorkspaceMfaPolicyService.class,
                ForensicDossierExportService.class,
                ExpedienteService.class,
                LoginRateLimiter.class,
                PilotOpsService.class,
                ProfessionalReportService.class,
                AccountIdentityController.class
        )) {
            for (Field f : owner.getDeclaredFields()) {
                Autowired a = f.getAnnotation(Autowired.class);
                if (a != null && !a.required() && SECURITY_TYPES.contains(f.getType())) {
                    offenders.add(owner.getSimpleName() + "." + f.getName());
                }
            }
            for (Constructor<?> c : owner.getDeclaredConstructors()) {
                for (var p : c.getParameters()) {
                    Autowired a = p.getAnnotation(Autowired.class);
                    if (a != null && !a.required() && SECURITY_TYPES.contains(p.getType())) {
                        offenders.add(owner.getSimpleName() + "(" + p.getName() + ")");
                    }
                }
            }
        }
        assertThat(offenders).isEmpty();
    }

    @Test
    void springContextFailsFastWhenWorkspaceMfaPolicyServiceIsMissing() {
        new ApplicationContextRunner()
                .withBean(AuthService.class)
                .withBean(TenantRepository.class, () -> mock(TenantRepository.class))
                .withBean(UserRepository.class, () -> mock(UserRepository.class))
                .withBean(ExpedienteRepository.class, () -> mock(ExpedienteRepository.class))
                .withBean(PasswordEncoder.class, () -> mock(PasswordEncoder.class))
                .withBean(JwtService.class, () -> mock(JwtService.class))
                .withBean(OmegaProperties.class, () -> mock(OmegaProperties.class))
                .withBean(LoginRateLimiter.class, () -> mock(LoginRateLimiter.class))
                .withBean(TwoFactorService.class, () -> mock(TwoFactorService.class))
                .withBean(AccountSeatService.class, () -> mock(AccountSeatService.class))
                .withBean(CreditService.class, () -> mock(CreditService.class))
                .withBean(AuditLogService.class, () -> mock(AuditLogService.class))
                // WorkspaceMfaPolicyService deliberadamente omitido
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .isInstanceOf(UnsatisfiedDependencyException.class)
                            .hasMessageContaining("WorkspaceMfaPolicyService");
                });
    }

    @Test
    void springContextFailsFastWhenTwoFactorServiceIsMissing() {
        new ApplicationContextRunner()
                .withBean(AuthService.class)
                .withBean(TenantRepository.class, () -> mock(TenantRepository.class))
                .withBean(UserRepository.class, () -> mock(UserRepository.class))
                .withBean(ExpedienteRepository.class, () -> mock(ExpedienteRepository.class))
                .withBean(PasswordEncoder.class, () -> mock(PasswordEncoder.class))
                .withBean(JwtService.class, () -> mock(JwtService.class))
                .withBean(OmegaProperties.class, () -> mock(OmegaProperties.class))
                .withBean(LoginRateLimiter.class, () -> mock(LoginRateLimiter.class))
                .withBean(WorkspaceMfaPolicyService.class, () -> mock(WorkspaceMfaPolicyService.class))
                .withBean(AccountSeatService.class, () -> mock(AccountSeatService.class))
                .withBean(CreditService.class, () -> mock(CreditService.class))
                .withBean(AuditLogService.class, () -> mock(AuditLogService.class))
                // TwoFactorService deliberadamente omitido
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .isInstanceOf(UnsatisfiedDependencyException.class)
                            .hasMessageContaining("TwoFactorService");
                });
    }

    @Test
    void securityWiringValidatorRejectsContextWithoutLegalProfileGuard() {
        LoginRateLimiter persistentLimiter = mock(LoginRateLimiter.class);
        when(persistentLimiter.isPersistentBacked()).thenReturn(true);
        new ApplicationContextRunner()
                .withBean(SecurityWiringValidator.class)
                .withBean(WorkspaceMfaPolicyService.class, () -> mock(WorkspaceMfaPolicyService.class))
                .withBean(TwoFactorService.class, () -> mock(TwoFactorService.class))
                .withBean(PlatformTransactionManager.class, () -> mock(PlatformTransactionManager.class))
                .withBean(JdbcTemplate.class, () -> mock(JdbcTemplate.class))
                .withBean(TenantRepository.class, () -> mock(TenantRepository.class))
                .withBean(AuthService.class, () -> mock(AuthService.class))
                .withBean(AccountSeatService.class, () -> mock(AccountSeatService.class))
                .withBean(CreditService.class, () -> mock(CreditService.class))
                .withBean(AuditLogService.class, () -> mock(AuditLogService.class))
                .withBean(LoginRateLimiter.class, () -> persistentLimiter)
                // LegalProfileAccessConfiguration deliberadamente omitido
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasMessageContaining("SECURITY_WIRING_MISSING")
                            .hasMessageContaining(LegalProfileAccessConfiguration.class.getName());
                });
    }

    @Test
    void securityWiringValidatorRejectsInMemoryOnlyLoginRateLimiter() {
        LoginRateLimiter inMemoryLimiter = new LoginRateLimiter();
        new ApplicationContextRunner()
                .withBean(SecurityWiringValidator.class)
                .withBean(WorkspaceMfaPolicyService.class, () -> mock(WorkspaceMfaPolicyService.class))
                .withBean(TwoFactorService.class, () -> mock(TwoFactorService.class))
                .withBean(PlatformTransactionManager.class, () -> mock(PlatformTransactionManager.class))
                .withBean(JdbcTemplate.class, () -> mock(JdbcTemplate.class))
                .withBean(TenantRepository.class, () -> mock(TenantRepository.class))
                .withBean(AuthService.class, () -> mock(AuthService.class))
                .withBean(AccountSeatService.class, () -> mock(AccountSeatService.class))
                .withBean(CreditService.class, () -> mock(CreditService.class))
                .withBean(AuditLogService.class, () -> mock(AuditLogService.class))
                .withBean(LoginRateLimiter.class, () -> inMemoryLimiter)
                .withBean(LegalProfileAccessConfiguration.class, () -> mock(LegalProfileAccessConfiguration.class))
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasMessageContaining("LoginRateLimiter debe contar con respaldo persistente");
                });
    }
}
