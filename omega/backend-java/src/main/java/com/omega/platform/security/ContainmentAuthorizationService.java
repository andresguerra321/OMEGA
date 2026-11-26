package com.omega.platform.security;

import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.service.TwoFactorService;
import java.util.Map;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class ContainmentAuthorizationService {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.AccountAccessService accountAccess;
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final TwoFactorService twoFactor;
    private final LoginRateLimiter limiter;

    public ContainmentAuthorizationService(UserRepository users, PasswordEncoder passwords,
            TwoFactorService twoFactor, LoginRateLimiter limiter) {
        this.users = users;
        this.passwords = passwords;
        this.twoFactor = twoFactor;
        this.limiter = limiter;
    }

    private UserEntity passwordCheck(OmegaPrincipal principal, String password) {
        String key = "containment-auth:" + principal.userId();
        limiter.assertAllowed(key, principal.email());
        Role effectiveRole = users.findActiveWorkspaceRole(principal.userId(), principal.tenantId())
                .orElseThrow(() -> new AccessDeniedException("Administrador activo requerido"));
        UserEntity user = users.findById(principal.userId())
                .filter(u -> u.isActive() && (effectiveRole == Role.ADMIN || accountAccess != null
                        && accountAccess.canManage(principal.tenantId(), u.getId(), effectiveRole)))
                .orElseThrow(() -> new AccessDeniedException("Administrador activo requerido"));
        if (password == null || !passwords.matches(password, user.getPasswordHash())) {
            limiter.recordFailure(key, principal.email());
            throw new AccessDeniedException("Confirma tu contraseña actual para esta acción.");
        }
        return user;
    }

    public Map<String, Object> challenge(OmegaPrincipal principal, String password) {
        UserEntity user = passwordCheck(principal, password);
        String key = "containment-challenge:" + principal.userId();
        limiter.assertAllowed(key, principal.email());
        limiter.recordFailure(key, principal.email()); // Bound repeated email challenge creation as well.
        if (!user.isMfaEnabled()) return Map.of("mfaRequired", false);
        var challenge = twoFactor.createLoginChallenge(user);
        return Map.of("mfaRequired", true, "challengeToken", challenge.challengeToken(), "method", challenge.method());
    }

    public void authorize(OmegaPrincipal principal, String password, String challengeToken, String code) {
        UserEntity user = passwordCheck(principal, password);
        if (user.isMfaEnabled()) {
            try {
                twoFactor.verifyContainmentChallenge(user.getId(), challengeToken, code);
            } catch (BadCredentialsException ex) {
                limiter.recordFailure("containment-auth:" + principal.userId(), principal.email());
                throw new AccessDeniedException("La verificación 2FA no es válida o expiró.");
            }
        }
        limiter.reset("containment-auth:" + principal.userId(), principal.email());
    }
}
