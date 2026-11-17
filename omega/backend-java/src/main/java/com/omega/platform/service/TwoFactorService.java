package com.omega.platform.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.TotpUtil;
import com.omega.platform.web.dto.AuthDtos.MfaActivationResponse;
import com.omega.platform.web.dto.AuthDtos.MfaEmailSetupResponse;
import com.omega.platform.web.dto.AuthDtos.MfaStatusResponse;
import com.omega.platform.web.dto.AuthDtos.MfaTotpSetupResponse;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
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
public class TwoFactorService {

    private static final Logger log = LoggerFactory.getLogger(TwoFactorService.class);
    private static final int CHALLENGE_TTL_MINUTES = 5;
    private static final int MAX_ATTEMPTS = 5;
    private static final int BACKUP_CODE_COUNT = 6;

    private final UserRepository userRepository;
    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;
    private final AuditLogService auditLogService;
    private final ObjectMapper objectMapper;
    private final JavaMailSender mailSender;
    private final String smtpHost;
    private final String smtpFrom;
    private final byte[] totpAtRestKey;

    public record LoginChallengeResult(String challengeToken, String method, String maskedEmail) {
    }

    @Autowired
    public TwoFactorService(
            UserRepository userRepository,
            JdbcTemplate jdbcTemplate,
            PasswordEncoder passwordEncoder,
            AuditLogService auditLogService,
            ObjectMapper objectMapper,
            OmegaProperties omegaProperties,
            @Autowired(required = false) JavaMailSender mailSender,
            @Value("${spring.mail.host:}") String smtpHost,
            @Value("${omega.mail.from:no-reply@omega.local}") String smtpFrom) {
        this.userRepository = userRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
        this.auditLogService = auditLogService;
        this.objectMapper = objectMapper;
        this.mailSender = mailSender;
        this.smtpHost = smtpHost == null ? "" : smtpHost.trim();
        this.smtpFrom = smtpFrom == null || smtpFrom.isBlank() ? "no-reply@omega.local" : smtpFrom.trim();
        this.totpAtRestKey = TotpUtil.deriveAes256Key(omegaProperties.security().jwtSecret());
    }

    public boolean isSmtpConfigured() {
        return mailSender != null && !smtpHost.isBlank();
    }

    @Transactional(readOnly = true)
    public MfaStatusResponse getStatus(UUID userId) {
        UserEntity user = loadActiveUser(userId);
        List<String> hashes = parseBackupHashes(user.getMfaBackupCodesJson());
        return new MfaStatusResponse(
                user.isMfaEnabled(),
                user.isMfaEnabled() ? user.getMfaMethod() : "NONE",
                hashes.size(),
                isSmtpConfigured());
    }

    @Transactional
    public MfaTotpSetupResponse beginTotpSetup(UUID userId) {
        UserEntity user = loadActiveUser(userId);
        String secret = TotpUtil.generateSecret();
        user.setMfaTotpPendingSecret(TotpUtil.encryptAtRest(secret, totpAtRestKey));
        userRepository.save(user);
        String uri = TotpUtil.buildOtpAuthUri("OMEGA", user.getEmail(), secret);
        return new MfaTotpSetupResponse(secret, uri, "OMEGA", user.getEmail());
    }

    @Transactional
    public MfaActivationResponse confirmTotpSetup(UUID userId, String code) {
        UserEntity user = loadActiveUser(userId);
        String pending = TotpUtil.decryptAtRest(user.getMfaTotpPendingSecret(), totpAtRestKey);
        if (pending == null || pending.isBlank()) {
            throw new BadCredentialsException("Primero genera el código QR de configuración.");
        }
        if (!TotpUtil.verifyTotpCode(pending, code)) {
            throw new BadCredentialsException("Código TOTP inválido. Verifica la hora de tu dispositivo e intenta de nuevo.");
        }
        List<String> backupCodes = TotpUtil.generateBackupCodes(BACKUP_CODE_COUNT);
        user.setMfaTotpSecret(TotpUtil.encryptAtRest(pending, totpAtRestKey));
        user.setMfaTotpPendingSecret(null);
        user.setMfaEnabled(true);
        user.setMfaMethod("TOTP");
        user.setMfaBackupCodesJson(serializeBackupHashes(backupCodes));
        userRepository.save(user);

        auditLogService.record(
                user.getTenantId(),
                user.getId(),
                "MFA_TOTP_ENABLED",
                "USER",
                user.getId().toString(),
                Map.of("method", "TOTP"));

        return new MfaActivationResponse(
                true,
                "TOTP",
                backupCodes,
                "Autenticador (TOTP) activado. Guarda estos códigos de respaldo en un lugar seguro.");
    }

    @Transactional
    public MfaEmailSetupResponse beginEmailSetup(UUID userId) {
        UserEntity user = loadActiveUser(userId);
        if (!isSmtpConfigured()) {
            throw new IllegalStateException("El servidor SMTP no está configurado para enviar códigos por correo.");
        }
        String code = TotpUtil.generateNumericOtp6();
        jdbcTemplate.update(
                "UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE user_id = ? AND purpose = 'SETUP_EMAIL' AND consumed_at IS NULL",
                user.getId());
        jdbcTemplate.update(
                """
                INSERT INTO omega_rag.mfa_challenges (id, user_id, purpose, method, email_code_hash, attempts, expires_at, created_at)
                VALUES (?, ?, 'SETUP_EMAIL', 'EMAIL', ?, 0, ?, NOW())
                """,
                UUID.randomUUID(),
                user.getId(),
                TotpUtil.sha256Hex(code),
                Timestamp.from(Instant.now().plus(CHALLENGE_TTL_MINUTES, ChronoUnit.MINUTES)));

        sendTwoFactorEmail(user, code, "Activar verificación en dos pasos");
        return new MfaEmailSetupResponse(
                true,
                "smtp",
                maskEmail(user.getEmail()),
                "Enviamos un código de 6 dígitos a " + maskEmail(user.getEmail()) + " para confirmar.");
    }

    @Transactional
    public MfaActivationResponse confirmEmailSetup(UUID userId, String code) {
        UserEntity user = loadActiveUser(userId);
        String trimmed = code == null ? "" : code.trim();
        if (!trimmed.matches("^\\d{6}$")) {
            throw new BadCredentialsException("Ingresa un código de 6 dígitos.");
        }
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                """
                SELECT id, email_code_hash, attempts
                FROM omega_rag.mfa_challenges
                WHERE user_id = ? AND purpose = 'SETUP_EMAIL' AND consumed_at IS NULL AND expires_at > NOW()
                ORDER BY created_at DESC
                LIMIT 1
                """,
                user.getId());
        if (rows.isEmpty()) {
            throw new BadCredentialsException("El código expiró o no existe. Solicita uno nuevo.");
        }
        Map<String, Object> row = rows.get(0);
        UUID challengeId = (UUID) row.get("id");
        String expectedHash = (String) row.get("email_code_hash");
        int attempts = ((Number) row.get("attempts")).intValue();
        if (attempts >= MAX_ATTEMPTS) {
            jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE id = ?", challengeId);
            throw new BadCredentialsException("Demasiados intentos fallidos. Solicita un nuevo código.");
        }
        String candidateHash = TotpUtil.sha256Hex(trimmed);
        if (!MessageDigest.isEqual(
                expectedHash.getBytes(StandardCharsets.UTF_8),
                candidateHash.getBytes(StandardCharsets.UTF_8))) {
            jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET attempts = attempts + 1 WHERE id = ?", challengeId);
            throw new BadCredentialsException("El código ingresado no es correcto.");
        }

        jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE id = ?", challengeId);
        List<String> backupCodes = TotpUtil.generateBackupCodes(BACKUP_CODE_COUNT);
        user.setMfaEnabled(true);
        user.setMfaMethod("EMAIL");
        user.setMfaTotpSecret(null);
        user.setMfaTotpPendingSecret(null);
        user.setMfaBackupCodesJson(serializeBackupHashes(backupCodes));
        userRepository.save(user);

        auditLogService.record(
                user.getTenantId(),
                user.getId(),
                "MFA_EMAIL_ENABLED",
                "USER",
                user.getId().toString(),
                Map.of("method", "EMAIL"));

        return new MfaActivationResponse(
                true,
                "EMAIL",
                backupCodes,
                "Verificación por correo activada. Guarda estos códigos de respaldo en un lugar seguro.");
    }

    @Transactional
    public MfaStatusResponse disableMfa(UUID userId, String currentPassword) {
        UserEntity user = loadActiveUser(userId);
        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new BadCredentialsException("La contraseña actual no es correcta.");
        }
        user.setMfaEnabled(false);
        user.setMfaMethod("NONE");
        user.setMfaTotpSecret(null);
        user.setMfaTotpPendingSecret(null);
        user.setMfaBackupCodesJson(null);
        userRepository.save(user);

        jdbcTemplate.update(
                "UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL",
                user.getId());

        auditLogService.record(
                user.getTenantId(),
                user.getId(),
                "MFA_DISABLED",
                "USER",
                user.getId().toString(),
                Map.of());

        return new MfaStatusResponse(false, "NONE", 0, isSmtpConfigured());
    }

    @Transactional
    public LoginChallengeResult createLoginChallenge(UserEntity user) {
        String method = "EMAIL".equalsIgnoreCase(user.getMfaMethod()) ? "EMAIL" : "TOTP";
        UUID challengeId = UUID.randomUUID();
        String emailHash = null;

        if ("EMAIL".equals(method)) {
            if (!isSmtpConfigured()) {
                throw new IllegalStateException("SMTP no configurado para enviar el código 2FA.");
            }
            String code = TotpUtil.generateNumericOtp6();
            emailHash = TotpUtil.sha256Hex(code);
            sendTwoFactorEmail(user, code, "Código de verificación para iniciar sesión");
        }

        jdbcTemplate.update(
                """
                INSERT INTO omega_rag.mfa_challenges (id, user_id, purpose, method, email_code_hash, attempts, expires_at, created_at)
                VALUES (?, ?, 'LOGIN', ?, ?, 0, ?, NOW())
                """,
                challengeId,
                user.getId(),
                method,
                emailHash,
                Timestamp.from(Instant.now().plus(CHALLENGE_TTL_MINUTES, ChronoUnit.MINUTES)));

        return new LoginChallengeResult(challengeId.toString(), method, maskEmail(user.getEmail()));
    }

    @Transactional
    public MfaEmailSetupResponse resendEmailLoginChallenge(String rawChallengeToken) {
        UUID challengeId = parseChallengeUuid(rawChallengeToken);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                """
                SELECT id, user_id, method
                FROM omega_rag.mfa_challenges
                WHERE id = ? AND purpose = 'LOGIN' AND consumed_at IS NULL AND expires_at > NOW()
                """,
                challengeId);
        if (rows.isEmpty()) {
            throw new BadCredentialsException("La sesión de verificación expiró. Vuelve a iniciar sesión.");
        }
        Map<String, Object> row = rows.get(0);
        if (!"EMAIL".equals(row.get("method"))) {
            throw new BadCredentialsException("Esta cuenta usa aplicación autenticadora (TOTP).");
        }
        if (!isSmtpConfigured()) {
            throw new IllegalStateException("SMTP no configurado.");
        }
        UserEntity user = loadActiveUser((UUID) row.get("user_id"));
        String code = TotpUtil.generateNumericOtp6();
        jdbcTemplate.update(
                "UPDATE omega_rag.mfa_challenges SET email_code_hash = ?, attempts = 0, expires_at = ? WHERE id = ?",
                TotpUtil.sha256Hex(code),
                Timestamp.from(Instant.now().plus(CHALLENGE_TTL_MINUTES, ChronoUnit.MINUTES)),
                challengeId);
        sendTwoFactorEmail(user, code, "Nuevo código de verificación para iniciar sesión");
        return new MfaEmailSetupResponse(
                true,
                "smtp",
                maskEmail(user.getEmail()),
                "Enviamos un nuevo código a " + maskEmail(user.getEmail()) + ".");
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public void verifyContainmentChallenge(UUID userId, String token, String code) {
        UUID id = parseChallengeUuid(token);
        Integer count = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM omega_rag.mfa_challenges WHERE id = ? AND user_id = ? AND purpose = 'LOGIN'", Integer.class, id, userId);
        if (count == null || count != 1) {
            throw new BadCredentialsException("Desafío 2FA ajeno o inválido");
        }
        UserEntity verified = verifyLoginChallenge(token, code);
        if (!verified.getId().equals(userId)) throw new BadCredentialsException("Usuario del desafío no válido");
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public UserEntity verifyLoginChallenge(String rawChallengeToken, String rawCode) {
        UUID challengeId = parseChallengeUuid(rawChallengeToken);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                """
                SELECT id, user_id, method, email_code_hash, attempts
                FROM omega_rag.mfa_challenges
                WHERE id = ? AND purpose = 'LOGIN' AND consumed_at IS NULL AND expires_at > NOW()
                FOR UPDATE
                """,
                challengeId);
        if (rows.isEmpty()) {
            throw new BadCredentialsException("El desafío 2FA expiró. Vuelve a iniciar sesión.");
        }

        Map<String, Object> row = rows.get(0);
        UUID userId = (UUID) row.get("user_id");
        String method = (String) row.get("method");
        String expectedEmailHash = (String) row.get("email_code_hash");
        int attempts = ((Number) row.get("attempts")).intValue();

        if (attempts >= MAX_ATTEMPTS) {
            jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE id = ?", challengeId);
            throw new BadCredentialsException("Demasiados intentos fallidos. Vuelve a iniciar sesión.");
        }

        UserEntity user = loadActiveUser(userId);
        String code = rawCode == null ? "" : rawCode.trim();
        boolean verified = false;
        boolean usedBackup = false;

        if (code.matches("^\\d{6}$")) {
            if ("TOTP".equals(method)) {
                String decryptedSecret = TotpUtil.decryptAtRest(user.getMfaTotpSecret(), totpAtRestKey);
                verified = TotpUtil.verifyTotpCode(decryptedSecret, code);
            } else if ("EMAIL".equals(method) && expectedEmailHash != null) {
                String candidate = TotpUtil.sha256Hex(code);
                verified = MessageDigest.isEqual(
                        expectedEmailHash.getBytes(StandardCharsets.UTF_8),
                        candidate.getBytes(StandardCharsets.UTF_8));
            }
        } else {
            usedBackup = consumeBackupCodeIfValid(user, code);
            verified = usedBackup;
        }

        if (!verified) {
            jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET attempts = attempts + 1 WHERE id = ?", challengeId);
            throw new BadCredentialsException("Código de verificación inválido.");
        }

        jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE id = ?", challengeId);
        auditLogService.record(
                user.getTenantId(),
                user.getId(),
                "MFA_LOGIN_VERIFIED",
                "USER",
                user.getId().toString(),
                Map.of("method", usedBackup ? "BACKUP_CODE" : method));
        return user;
    }

    private boolean consumeBackupCodeIfValid(UserEntity user, String rawCode) {
        String normalized = rawCode.trim().toUpperCase(Locale.ROOT);
        if (!normalized.matches("^[A-Z0-9]{4}-?[A-Z0-9]{4}$")) {
            return false;
        }
        if (!normalized.contains("-")) {
            normalized = normalized.substring(0, 4) + "-" + normalized.substring(4);
        }
        String candidateHash = TotpUtil.sha256Hex(normalized);
        List<String> hashes = parseBackupHashes(user.getMfaBackupCodesJson());
        int matchIdx = -1;
        for (int i = 0; i < hashes.size(); i++) {
            if (MessageDigest.isEqual(
                    hashes.get(i).getBytes(StandardCharsets.UTF_8),
                    candidateHash.getBytes(StandardCharsets.UTF_8))) {
                matchIdx = i;
                break;
            }
        }
        if (matchIdx < 0) {
            return false;
        }
        List<String> updated = new ArrayList<>(hashes);
        updated.remove(matchIdx);
        try {
            user.setMfaBackupCodesJson(objectMapper.writeValueAsString(updated));
            userRepository.save(user);
        } catch (Exception ex) {
            throw new IllegalStateException("No se pudo actualizar los códigos de respaldo", ex);
        }
        return true;
    }

    private UserEntity loadActiveUser(UUID userId) {
        return userRepository.findById(userId)
                .filter(UserEntity::isActive)
                .orElseThrow(() -> new BadCredentialsException("Usuario no disponible."));
    }

    private static UUID parseChallengeUuid(String raw) {
        try {
            return UUID.fromString(raw.trim());
        } catch (Exception ex) {
            throw new BadCredentialsException("Token de verificación inválido.");
        }
    }

    private List<String> parseBackupHashes(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {
            });
        } catch (Exception ex) {
            return List.of();
        }
    }

    private String serializeBackupHashes(List<String> plaintextCodes) {
        List<String> hashes = plaintextCodes.stream().map(TotpUtil::sha256Hex).toList();
        try {
            return objectMapper.writeValueAsString(hashes);
        } catch (Exception ex) {
            throw new IllegalStateException("No se pudo serializar códigos de respaldo", ex);
        }
    }

    private void sendTwoFactorEmail(UserEntity user, String code, String title) {
        try {
            MimeMessage mimeMessage = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(mimeMessage, true, StandardCharsets.UTF_8.name());
            helper.setFrom(smtpFrom, "OMEGA Security");
            helper.setTo(user.getEmail());
            helper.setSubject("OMEGA — " + title);

            ClassPathResource bannerResource = new ClassPathResource("mail/omega-banner.jpg");
            boolean hasBanner = bannerResource.exists();
            String safeName = HtmlUtils.htmlEscape(user.getFullName() == null ? "Analista" : user.getFullName());
            String safeTitle = HtmlUtils.htmlEscape(title);
            String bannerBlock = hasBanner
                    ? "<tr><td style=\"padding:0;line-height:0;\"><a href=\"#omega\" style=\"display:block;text-decoration:none;border:0;outline:none;cursor:default;\"><img src=\"cid:omegaBanner\" alt=\"OMEGA\" width=\"560\" border=\"0\" style=\"display:block;width:100%;max-width:560px;height:auto;border:0;border-top-left-radius:16px;border-top-right-radius:16px;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;\" /></a></td></tr>"
                    : "";

            String plainText = "Hola " + user.getFullName() + ",\n\n"
                    + title + "\n"
                    + "Tu código de verificación (válido por 5 minutos) es: " + code + "\n";

            String html = """
                    <!DOCTYPE html>
                    <html lang="es">
                    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
                    <body style="margin:0;padding:0;background-color:#0A0A0C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#F2F2F4;">
                      <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background-color:#0A0A0C;padding:32px 16px;">
                        <tr>
                          <td align="center">
                            <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%%;max-width:560px;background-color:#141418;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
                              %s
                              <tr>
                                <td style="padding:32px 32px 28px 32px;">
                                  <div style="display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid rgba(47,111,237,0.45);background-color:rgba(47,111,237,0.14);color:#8BB2FF;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">
                                    Verificación en Dos Pasos · Zero-Trust
                                  </div>
                                  <h1 style="margin:16px 0 8px 0;font-size:22px;line-height:1.3;font-weight:600;color:#F2F2F4;">
                                    %s
                                  </h1>
                                  <p style="margin:0 0 22px 0;font-size:14px;line-height:1.6;color:#C2C7D6;">
                                    Hola <strong style="color:#F2F2F4;">%s</strong>, usa el siguiente código de verificación dentro de los próximos <strong style="color:#F2F2F4;">5 minutos</strong> para confirmar tu acceso a <strong style="color:#F2F2F4;">OMEGA</strong>:
                                  </p>
                                  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="margin:0 0 22px 0;">
                                    <tr>
                                      <td align="center" style="padding:18px 12px;background-color:#0A0A0C;border:1px solid rgba(47,111,237,0.35);border-radius:14px;">
                                        <table role="presentation" cellspacing="0" cellpadding="0">
                                          <tr>
                                            %s
                                          </tr>
                                        </table>
                                      </td>
                                    </tr>
                                  </table>
                                  <p style="margin:0;font-size:12.5px;line-height:1.6;color:#9A9AA2;">
                                    Si no intentaste iniciar sesión o activar 2FA, cambia tu contraseña de inmediato.
                                  </p>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:16px 32px;background-color:#0E0E12;border-top:1px solid rgba(255,255,255,0.06);font-size:11.5px;color:#7C7D87;">
                                  OMEGA · Plataforma Defensiva de Cyber Threat Intelligence &amp; Forensics
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </body>
                    </html>
                    """.formatted(bannerBlock, safeTitle, safeName, buildOtpCellsHtml(code));

            helper.setText(plainText, html);
            if (hasBanner) {
                helper.addInline("omegaBanner", bannerResource, "image/jpeg");
            }
            mailSender.send(mimeMessage);
        } catch (Exception ex) {
            log.warn("Error enviando correo 2FA a {}: {}", maskEmail(user.getEmail()), ex.getMessage());
            throw new IllegalStateException("No se pudo enviar el correo de verificación 2FA.", ex);
        }
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

    private static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
