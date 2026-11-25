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
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.HtmlUtils;

@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final long TOKEN_TTL_MINUTES = 15L;
    public static final int MAX_TOKEN_ATTEMPTS = 5;

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
        this.smtpFrom = effectiveFrom;
    }

    @Transactional
    public PasswordResetResponse requestReset(PasswordResetRequest request) {
        if (!isSmtpConfigured()) {
            return new PasswordResetResponse(true, "recovery_key",
                    "Usa la clave de recuperación que guardaste al crear tu cuenta. No necesitas correo ni conexión a Internet.");
        }
        String email = normalizeEmail(request.email());

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

            try {
                sendStyledRecoveryEmail(user, code);
            } catch (Exception ex) {
                log.warn("No se pudo enviar correo SMTP de recuperación a {}", maskEmail(email));
                throw new IllegalStateException("No se pudo enviar el correo. Inténtalo de nuevo o usa tu clave de recuperación.");
            }
        }

        String msg = "Si el correo está registrado en OMEGA, enviamos un código de 6 dígitos válido por 15 minutos.";
        return new PasswordResetResponse(true, "smtp", msg);
    }

    public boolean isSmtpConfigured() {
        return !smtpHost.isBlank() && mailSender != null && !smtpFrom.isBlank();
    }

    @Transactional
    public Map<String, String> createRecoveryKey(UUID userId, String password) {
        UserEntity user = userRepository.findById(userId)
                .filter(UserEntity::isActive)
                .orElseThrow(() -> new BadCredentialsException("Cuenta no disponible."));
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new BadCredentialsException("Contraseña incorrecta.");
        }
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        String key = HexFormat.of().formatHex(bytes);
        userRepository.flush();
        jdbcTemplate.update("""
                INSERT INTO omega_rag.account_recovery_keys (user_id, key_hash)
                VALUES (?, ?)
                ON CONFLICT (user_id) DO UPDATE SET key_hash = EXCLUDED.key_hash, created_at = NOW()
                """, userId, sha256Hex(key));
        auditLogService.record(user.getTenantId(), userId, "RECOVERY_KEY_CREATED", "USER",
                userId.toString(), Map.of());
        return Map.of("recoveryKey", key);
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public PasswordResetResponse confirmReset(PasswordResetConfirmRequest request) {
        String email = normalizeEmail(request.email());
        String code = request.code() == null ? "" : request.code().trim();
        if (!code.matches("^(?:\\d{6}|[a-f0-9]{48})$")) {
            throw new BadCredentialsException("Ingresa un código de 6 dígitos o tu clave de recuperación.");
        }

        UserEntity user = resolveTargetUser(email, request.tenantSlug())
                .orElseThrow(() -> new BadCredentialsException("Código inválido o expirado."));

        String hash = sha256Hex(code);
        boolean validOtp = false;
        boolean recoveryKey = false;

        if (code.length() == 48) {
            recoveryKey = jdbcTemplate.update("""
                    DELETE FROM omega_rag.account_recovery_keys WHERE user_id = ? AND key_hash = ?
                    """, user.getId(), hash) == 1;
        } else {
            // B-02: Bloquear fila con FOR UPDATE y limitar intentos fallidos por token (MAX_TOKEN_ATTEMPTS = 5)
            List<Map<String, Object>> activeTokens = jdbcTemplate.queryForList(
                    """
                    SELECT id, token_hash, attempts
                    FROM omega_rag.password_reset_tokens
                    WHERE user_id = ?
                      AND used_at IS NULL
                      AND expires_at > NOW()
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    user.getId()
            );
            if (!activeTokens.isEmpty()) {
                Map<String, Object> tokenRow = activeTokens.get(0);
                UUID tokenId = (UUID) tokenRow.get("id");
                String expectedHash = (String) tokenRow.get("token_hash");
                int attempts = tokenRow.get("attempts") != null ? ((Number) tokenRow.get("attempts")).intValue() : 0;
                if (attempts >= MAX_TOKEN_ATTEMPTS) {
                    jdbcTemplate.update("UPDATE omega_rag.password_reset_tokens SET used_at = NOW() WHERE id = ?", tokenId);
                    throw new BadCredentialsException("El código de recuperación fue invalidado por demasiados intentos fallidos.");
                }
                if (expectedHash != null && MessageDigest.isEqual(
                        expectedHash.getBytes(StandardCharsets.UTF_8),
                        hash.getBytes(StandardCharsets.UTF_8))) {
                    validOtp = true;
                } else {
                    int nextAttempts = attempts + 1;
                    if (nextAttempts >= MAX_TOKEN_ATTEMPTS) {
                        jdbcTemplate.update(
                                "UPDATE omega_rag.password_reset_tokens SET attempts = ?, used_at = NOW() WHERE id = ?",
                                nextAttempts, tokenId);
                    } else {
                        jdbcTemplate.update(
                                "UPDATE omega_rag.password_reset_tokens SET attempts = ? WHERE id = ?",
                                nextAttempts, tokenId);
                    }
                    throw new BadCredentialsException("El código de recuperación es inválido o ya expiró.");
                }
            }
        }

        if (!validOtp && !recoveryKey) {
            throw new BadCredentialsException("El código de recuperación es inválido o ya expiró.");
        }

        jdbcTemplate.update("UPDATE omega_rag.password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
                user.getId());
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

    private void sendStyledRecoveryEmail(UserEntity user, String code) throws Exception {
        MimeMessage mimeMessage = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(mimeMessage, true, StandardCharsets.UTF_8.name());
        helper.setFrom(smtpFrom, "OMEGA Security");
        helper.setTo(user.getEmail());
        helper.setSubject("OMEGA — Código de recuperación de contraseña");

        String greetingName = user.getFullName() == null || user.getFullName().isBlank()
                ? "Analista"
                : user.getFullName().trim().split("\\s+")[0];

        String plainText = "Hola " + greetingName + ",\n\n"
                + "Recibimos una solicitud para restablecer tu contraseña en OMEGA.\n"
                + "Tu código de verificación (válido por 15 minutos) es: " + code + "\n\n"
                + "Si no solicitaste este cambio, ignora este mensaje.\n";

        String html = OmegaEmailTemplate.Spec.builder("Restablecer contraseña")
                .preheader("Tu código de recuperación de OMEGA es " + code + " (válido por 15 minutos).")
                .addParagraph("Hola " + greetingName + ", recibimos una solicitud para restablecer la contraseña de tu cuenta en OMEGA.")
                .verificationCode(code, "Válido por 15 minutos · Uso único")
                .addParagraph("Si no solicitaste este cambio, puedes ignorar este correo de forma segura; tu contraseña actual seguirá intacta.")
                .recipientEmail(user.getEmail())
                .render();

        helper.setText(plainText, html);
        mailSender.send(mimeMessage);
    }

    private static String buildOtpCellsHtml(String code) {
        StringBuilder cells = new StringBuilder();
        for (int i = 0; i < code.length(); i++) {
            cells.append("<td style=\"padding:0 4px;user-select:none;-webkit-user-select:none;\">")
                    .append("<div style=\"width:44px;height:54px;line-height:54px;text-align:center;")
                    .append("background-color:#141418;border:1px solid rgba(47,111,237,0.55);border-radius:12px;")
                    .append("font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;")
                    .append("font-size:26px;font-weight:700;color:#F2F2F4;user-select:none;-webkit-user-select:none;\">")
                    .append(code.charAt(i))
                    .append("</div></td>");
        }
        return cells.toString();
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
