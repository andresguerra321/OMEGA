package com.omega.platform.service;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.web.dto.AuthDtos.PasswordResetConfirmRequest;
import com.omega.platform.web.dto.AuthDtos.PasswordResetRequest;
import com.omega.platform.web.dto.AuthDtos.PasswordResetResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final long TOKEN_TTL_MINUTES = 15L;

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbcTemplate;
    private final AuditLogService auditLogService;
    private final JavaMailSender mailSender;
    private final String smtpHost;
    private final String smtpFrom;

    @Autowired
    public PasswordResetService(
            UserRepository userRepository,
            TenantRepository tenantRepository,
            PasswordEncoder passwordEncoder,
            JdbcTemplate jdbcTemplate,
            AuditLogService auditLogService,
            @Autowired(required = false) JavaMailSender mailSender,
            @Value("${spring.mail.host:}") String smtpHost,
            @Value("${OMEGA_SMTP_FROM:}") String smtpFrom,
            @Value("${spring.mail.username:}") String smtpUsername
    ) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.passwordEncoder = passwordEncoder;
        this.jdbcTemplate = jdbcTemplate;
        this.auditLogService = auditLogService;
        this.mailSender = mailSender;
        this.smtpHost = smtpHost == null ? "" : smtpHost.trim();
        String effectiveFrom = (smtpFrom != null && !smtpFrom.isBlank()) ? smtpFrom.trim() : (smtpUsername == null ? "" : smtpUsername.trim());
        this.smtpFrom = effectiveFrom.isBlank() ? "no-reply@omega.local" : effectiveFrom;
    }

    @Transactional
    public PasswordResetResponse requestReset(PasswordResetRequest request) {
        String email = normalizeEmail(request.email());
        boolean smtpConfigured = !smtpHost.isBlank() && mailSender != null;
        String deliveryMode = smtpConfigured ? "smtp" : "local_log";

        Optional<UserEntity> userOpt = resolveTargetUser(email, request.tenantSlug());
        if (userOpt.isPresent()) {
            UserEntity user = userOpt.get();
            String code = generateSixDigitCode();
            String hash = sha256Hex(code);
            Instant expiresAt = Instant.now().plus(TOKEN_TTL_MINUTES, ChronoUnit.MINUTES);

            jdbcTemplate.update(
                    "UPDATE omega_rag.password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
                    user.getId()
            );
            jdbcTemplate.update(
                    """
                    INSERT INTO omega_rag.password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
                    VALUES (?, ?, ?, ?, NOW())
                    """,
                    UUID.randomUUID(),
                    user.getId(),
                    hash,
                    Timestamp.from(expiresAt)
            );

            if (smtpConfigured) {
                try {
                    SimpleMailMessage message = new SimpleMailMessage();
                    message.setFrom(smtpFrom);
                    message.setTo(user.getEmail());
                    message.setSubject("OMEGA — Código de recuperación de contraseña");
                    message.setText(
                            "Hola " + user.getFullName() + ",\n\n"
                                    + "Recibimos una solicitud para restablecer tu contraseña en OMEGA.\n"
                                    + "Tu código de verificación (válido por 15 minutos) es:\n\n"
                                    + "    " + code + "\n\n"
                                    + "Si no solicitaste este cambio, ignora este mensaje.\n"
                    );
                    mailSender.send(message);
                } catch (Exception ex) {
                    log.warn("No se pudo enviar correo SMTP de recuperación a {}: {}", maskEmail(email), ex.getMessage());
                    log.info("[OMEGA-AUTH-RECOVERY] Código de recuperación para {}: {} (válido {} min)", maskEmail(email), code, TOKEN_TTL_MINUTES);
                }
            } else {
                log.info("[OMEGA-AUTH-RECOVERY] SMTP no configurado. Código de recuperación para {}: {} (válido {} min)", maskEmail(email), code, TOKEN_TTL_MINUTES);
            }
        }

        String msg = smtpConfigured
                ? "Si el correo está registrado en OMEGA, enviamos un código de 6 dígitos válido por 15 minutos."
                : "Si el correo está registrado, se generó un código de 6 dígitos (válido 15 min). Como no hay SMTP configurado en este nodo local, consúltalo en los logs de omega_backend_java.";
        return new PasswordResetResponse(true, deliveryMode, msg);
    }

    @Transactional
    public PasswordResetResponse confirmReset(PasswordResetConfirmRequest request) {
        String email = normalizeEmail(request.email());
        String code = request.code() == null ? "" : request.code().trim();
        if (!code.matches("^\\d{6}$")) {
            throw new BadCredentialsException("El código de verificación debe tener 6 dígitos.");
        }

        UserEntity user = resolveTargetUser(email, request.tenantSlug())
                .orElseThrow(() -> new BadCredentialsException("Código inválido o expirado."));

        String hash = sha256Hex(code);
        List<UUID> tokenIds = jdbcTemplate.query(
                """
                SELECT id
                FROM omega_rag.password_reset_tokens
                WHERE user_id = ?
                  AND token_hash = ?
                  AND used_at IS NULL
                  AND expires_at > NOW()
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (rs, rowNum) -> UUID.fromString(rs.getString("id")),
                user.getId(),
                hash
        );

        if (tokenIds.isEmpty()) {
            throw new BadCredentialsException("El código de recuperación es inválido o ya expiró.");
        }

        jdbcTemplate.update(
                "UPDATE omega_rag.password_reset_tokens SET used_at = NOW() WHERE id = ?",
                tokenIds.get(0)
        );
        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        userRepository.save(user);

        auditLogService.record(
                user.getTenantId(),
                user.getId(),
                "PASSWORD_RESET_COMPLETED",
                "USER",
                user.getId().toString(),
                Map.of("method", "recovery_code")
        );

        return new PasswordResetResponse(
                true,
                "completed",
                "Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva clave."
        );
    }

    private Optional<UserEntity> resolveTargetUser(String email, String tenantSlug) {
        if (tenantSlug != null && !tenantSlug.isBlank()) {
            Optional<TenantEntity> tenant = tenantRepository.findBySlugAndActiveTrue(tenantSlug.trim().toLowerCase(Locale.ROOT));
            if (tenant.isEmpty()) {
                return Optional.empty();
            }
            return userRepository.findByTenantIdAndEmailIgnoreCase(tenant.get().getId(), email)
                    .filter(UserEntity::isActive);
        }
        List<UserEntity> matches = userRepository.findAllActiveByEmailIgnoreCase(email);
        return matches.isEmpty() ? Optional.empty() : Optional.of(matches.get(0));
    }

    private static String generateSixDigitCode() {
        int num = RANDOM.nextInt(1_000_000);
        return String.format(Locale.ROOT, "%06d", num);
    }

    private static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) return "***";
        return email.charAt(0) + "***" + email.substring(at);
    }

    private static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible", ex);
        }
    }
}
