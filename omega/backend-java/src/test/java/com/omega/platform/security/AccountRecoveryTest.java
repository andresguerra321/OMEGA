package com.omega.platform.security;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.PasswordResetService;
import com.omega.platform.web.dto.AuthDtos.PasswordResetConfirmRequest;
import com.omega.platform.web.dto.AuthDtos.PasswordResetRequest;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;

class AccountRecoveryTest {
    @Test
    void smtpUsesTheRegisteredRecipientAndReportsSendFailures() {
        var sender = mock(org.springframework.mail.javamail.JavaMailSender.class);
        var message = new jakarta.mail.internet.MimeMessage(jakarta.mail.Session.getInstance(new java.util.Properties()));
        when(sender.createMimeMessage()).thenReturn(message);
        when(user.getEmail()).thenReturn("recipient@example.org");
        when(users.findAllActiveByEmailIgnoreCase("recipient@example.org")).thenReturn(List.of(user));
        var mailService = new PasswordResetService(users, tenants, encoder, jdbc, audit, sender,
                "smtp.example.org", "sender@example.org", "sender@example.org");
        assertTrue(mailService.isSmtpConfigured());
        var request = new PasswordResetRequest("recipient@example.org", null);
        assertEquals("smtp", mailService.requestReset(request).deliveryMode());
        verify(sender).send(message);
        assertDoesNotThrow(() -> assertEquals("recipient@example.org", message.getAllRecipients()[0].toString()));
        doThrow(new org.springframework.mail.MailAuthenticationException("provider rejected credentials"))
                .when(sender).send(message);
        assertThrows(IllegalStateException.class, () -> mailService.requestReset(request));
    }

    @Test
    void smtpRequiresAnExplicitSenderOrConfiguredUsername() {
        var sender = mock(org.springframework.mail.javamail.JavaMailSender.class);
        var mailService = new PasswordResetService(users, tenants, encoder, jdbc, audit, sender,
                "smtp.example.org", "", "");
        assertFalse(mailService.isSmtpConfigured());
    }

    private final UserRepository users = mock(UserRepository.class);
    private final TenantRepository tenants = mock(TenantRepository.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuditLogService audit = mock(AuditLogService.class);
    private final UUID id = UUID.randomUUID();
    private final UserEntity user = mock(UserEntity.class);
    private PasswordResetService service;

    @BeforeEach
    void setup() {
        service = new PasswordResetService(users, tenants, encoder, jdbc, audit, null, "", "", "");
        when(user.getId()).thenReturn(id);
        when(user.getTenantId()).thenReturn(UUID.randomUUID());
        when(user.isActive()).thenReturn(true);
        when(user.getPasswordHash()).thenReturn("stored-password-hash");
        when(users.findById(id)).thenReturn(Optional.of(user));
    }

    @Test
    void noMailUsesSavedKeyWithoutIssuingOrLoggingAnOtp() {
        var result = service.requestReset(new PasswordResetRequest("owner@example.org", null));
        assertTrue(result.ok());
        assertEquals("recovery_key", result.deliveryMode());
        verifyNoInteractions(jdbc, users, tenants);
    }

    @Test
    void generatingAKeyRequiresTheCurrentPassword() {
        assertThrows(BadCredentialsException.class, () -> service.createRecoveryKey(id, "wrong"));
        verifyNoInteractions(jdbc, audit);
    }

    @Test
    void onlyTheHashOfTheRandomKeyIsStored() {
        when(encoder.matches("correct-password", "stored-password-hash")).thenReturn(true);
        String key = service.createRecoveryKey(id, "correct-password").get("recoveryKey");
        assertTrue(key.matches("[a-f0-9]{48}"));
        verify(jdbc).update(contains("INSERT INTO omega_rag.account_recovery_keys"), eq(id),
                argThat((Object hash) -> hash instanceof String value && value.matches("[a-f0-9]{64}") && !value.equals(key)));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aRecoveryKeyCanBeConsumedOnlyOnce() {
        when(users.findAllActiveByEmailIgnoreCase("owner@example.org")).thenReturn(List.of(user));
        when(jdbc.query(anyString(), any(RowMapper.class), eq(id), anyString())).thenReturn(List.of());
        when(jdbc.update(contains("DELETE FROM omega_rag.account_recovery_keys"), eq(id), anyString()))
                .thenReturn(1, 0);
        when(encoder.encode("New-password-123")).thenReturn("new-hash");
        var request = new PasswordResetConfirmRequest("owner@example.org", "a".repeat(48), "New-password-123", null);
        assertTrue(service.confirmReset(request).ok());
        assertThrows(BadCredentialsException.class, () -> service.confirmReset(request));
        verify(users, times(1)).save(user);
        verify(user).setPasswordHash("new-hash");
    }
}
