package com.omega.platform.security;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.service.TwoFactorService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

class ContainmentAuthorizationTest {
    @Test void mfaEnabledAccountMustVerifyFreshChallengeAndPassword() {
        var users = mock(UserRepository.class);
        var passwords = mock(PasswordEncoder.class);
        var twoFactor = mock(TwoFactorService.class);
        var limiter = new LoginRateLimiter();
        var principal = new OmegaPrincipal(UUID.randomUUID(), UUID.randomUUID(), "admin@example.org", Role.ADMIN, true);
        UserEntity user = mock(UserEntity.class);
        when(users.findByIdAndTenantId(principal.userId(), principal.tenantId())).thenReturn(Optional.of(user));
        when(user.isActive()).thenReturn(true); when(user.getRole()).thenReturn(Role.ADMIN);
        when(user.getId()).thenReturn(principal.userId()); when(user.getPasswordHash()).thenReturn("stored");
        when(user.isMfaEnabled()).thenReturn(true); when(passwords.matches("password", "stored")).thenReturn(true);
        var guard = new ContainmentAuthorizationService(users, passwords, twoFactor, limiter);
        assertThatThrownBy(() -> guard.authorize(principal, "wrong", "token", "123456"))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        verifyNoInteractions(twoFactor);
        guard.authorize(principal, "password", "token", "123456");
        verify(twoFactor).verifyContainmentChallenge(principal.userId(), "token", "123456");
    }
}
