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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    @Value("${OMEGA_SUPPORT_EMAIL:}") private String supportEmail;
    private final byte[] totpAtRestKey;

    @Autowired
    private com.omega.platform.security.LoginRateLimiter loginRateLimiter;

    @Autowired
    private com.omega.platform.security.WorkspaceMfaPolicyService mfaPolicy;

    @Autowired
    private org.springframework.transaction.PlatformTransactionManager transactionManager;

    public record LoginChallengeResult(String challengeToken, String method, String maskedEmail) {
    }

    public record VerifiedLoginChallenge(UserEntity user, UUID targetTenantId) {
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
            @Value("${OMEGA_SMTP_FROM:${spring.mail.username:}}") String smtpFrom) {
        this.userRepository = userRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
        this.auditLogService = auditLogService;
        this.objectMapper = objectMapper;
        this.mailSender = mailSender;
        this.smtpHost = smtpHost == null ? "" : smtpHost.trim();
        this.smtpFrom = smtpFrom == null ? "" : smtpFrom.trim();
        this.totpAtRestKey = TotpUtil.deriveAes256Key(omegaProperties.security().jwtSecret());
    }

    public boolean isSmtpConfigured() {
        return mailSender != null && !smtpHost.isBlank() && !smtpFrom.isBlank();
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

    @Transactional(noRollbackFor = BadCredentialsException.class)
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
                FOR UPDATE
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
        if (mfaPolicy != null && mfaPolicy.hasMandatoryMfaObligation(userId)) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN,
                    "MFA_REQUIRED: No puedes desactivar la verificación en dos pasos mientras pertenezcas a múltiples espacios o administres una organización."
            );
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
        return createLoginChallenge(user, user.getTenantId());
    }

    @Transactional
    public LoginChallengeResult createLoginChallenge(UserEntity user, UUID targetTenantId) {
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
                INSERT INTO omega_rag.mfa_challenges (id, user_id, target_tenant_id, purpose, method, email_code_hash, attempts, resend_count, last_sent_at, expires_at, created_at)
                VALUES (?, ?, ?, 'LOGIN', ?, ?, 0, 0, ?, ?, NOW())
                """,
                challengeId,
                user.getId(),
                targetTenantId != null ? targetTenantId : user.getTenantId(),
                method,
                emailHash,
                "EMAIL".equals(method) ? Timestamp.from(Instant.now()) : null,
                Timestamp.from(Instant.now().plus(CHALLENGE_TTL_MINUTES, ChronoUnit.MINUTES)));

        return new LoginChallengeResult(challengeId.toString(), method, maskEmail(user.getEmail()));
    }

    public static final int MAX_EMAIL_RESENDS = 3;
    public static final long EMAIL_RESEND_COOLDOWN_SECONDS = 60L;

    @Transactional(noRollbackFor = {BadCredentialsException.class, com.omega.platform.security.TooManyLoginAttemptsException.class})
    public MfaEmailSetupResponse resendEmailLoginChallenge(String rawChallengeToken) {
        UUID challengeId = parseChallengeUuid(rawChallengeToken);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                """
                SELECT id, user_id, method, attempts, resend_count, last_sent_at
                FROM omega_rag.mfa_challenges
                WHERE id = ? AND purpose = 'LOGIN' AND consumed_at IS NULL AND expires_at > NOW()
                FOR UPDATE
                """,
                challengeId);
        if (rows.isEmpty()) {
            throw new BadCredentialsException("La sesión de verificación expiró. Vuelve a iniciar sesión.");
        }
        Map<String, Object> row = rows.get(0);
        if (!"EMAIL".equals(row.get("method"))) {
            throw new BadCredentialsException("Esta cuenta usa aplicación autenticadora (TOTP).");
        }
        int attempts = ((Number) row.get("attempts")).intValue();
        if (attempts >= MAX_ATTEMPTS) {
            jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE id = ?", challengeId);
            throw new BadCredentialsException("Demasiados intentos fallidos. Vuelve a iniciar sesión.");
        }
        int resendCount = row.get("resend_count") != null ? ((Number) row.get("resend_count")).intValue() : 0;
        if (resendCount >= MAX_EMAIL_RESENDS) {
            throw new com.omega.platform.security.TooManyLoginAttemptsException(
                    "Alcanzaste el máximo de reenvíos para esta verificación. Inicia sesión nuevamente.",
                    EMAIL_RESEND_COOLDOWN_SECONDS
            );
        }
        Object rawLastSent = row.get("last_sent_at");
        if (rawLastSent instanceof Timestamp ts) {
            long elapsedSeconds = java.time.Duration.between(ts.toInstant(), Instant.now()).getSeconds();
            if (elapsedSeconds < EMAIL_RESEND_COOLDOWN_SECONDS) {
                long remaining = Math.max(1L, EMAIL_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
                throw new com.omega.platform.security.TooManyLoginAttemptsException(
                        "Espera " + remaining + " segundos antes de solicitar un nuevo código.",
                        remaining
                );
            }
        }
        if (!isSmtpConfigured()) {
            throw new IllegalStateException("SMTP no configurado.");
        }
        UserEntity user = loadActiveUser((UUID) row.get("user_id"));
        String code = TotpUtil.generateNumericOtp6();
        // B-01: Nunca reiniciar attempts = 0 ni extender indefinidamente expires_at al reenviar.
        jdbcTemplate.update(
                "UPDATE omega_rag.mfa_challenges SET email_code_hash = ?, resend_count = resend_count + 1, last_sent_at = NOW() WHERE id = ?",
                TotpUtil.sha256Hex(code),
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
        return verifyLoginChallengeWithContext(rawChallengeToken, rawCode).user();
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public VerifiedLoginChallenge verifyLoginChallengeWithContext(String rawChallengeToken, String rawCode) {
        UUID challengeId = parseChallengeUuid(rawChallengeToken);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                """
                SELECT id, user_id, target_tenant_id, method, email_code_hash, attempts
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
        UUID targetTenantId = (UUID) row.get("target_tenant_id");
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
                java.util.OptionalLong matchedBucket = TotpUtil.findMatchingTotpBucket(decryptedSecret, code, Instant.now());
                if (matchedBucket.isPresent() && tryConsumeTotpBucketAtomically(userId, matchedBucket.getAsLong(), code)) {
                    verified = true;
                }
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

        UUID effectiveTenantId = targetTenantId != null ? targetTenantId : user.getTenantId();
        jdbcTemplate.update("UPDATE omega_rag.mfa_challenges SET consumed_at = NOW() WHERE id = ?", challengeId);
        auditLogService.record(
                effectiveTenantId,
                user.getId(),
                "MFA_LOGIN_VERIFIED",
                "USER",
                user.getId().toString(),
                Map.of("method", usedBackup ? "BACKUP_CODE" : method));
        return new VerifiedLoginChallenge(user, effectiveTenantId);
    }

    /**
     * Valida y consume de forma atómica un código TOTP de 6 dígitos de un solo uso para step-up MFA
     * (p. ej. {@code switch-workspace} o elevación hacia espacios {@code LEGAL} de organización),
     * impidiendo replay dentro de la ventana temporal RFC 6238 y aplicando límite estricto en {@code auth_rate_limits}.
     */
    @Transactional(noRollbackFor = {org.springframework.web.server.ResponseStatusException.class, BadCredentialsException.class})
    public void verifySingleUseTotpStepUp(UUID userId, String rawCode, String clientIp) {
        String userKey = userId.toString();
        String ipKey = (clientIp == null || clientIp.isBlank()) ? "unknown" : clientIp.trim();
        if (loginRateLimiter != null) {
            loginRateLimiter.assertScopedAllowed("mfa-stepup-user", userKey, MAX_ATTEMPTS);
            loginRateLimiter.assertScopedAllowed("mfa-stepup-ip", ipKey, 20);
        }

        UserEntity user = loadActiveUser(userId);
        if (!user.isMfaEnabled() || user.getMfaTotpSecret() == null || user.getMfaTotpSecret().isBlank()) {
            if (loginRateLimiter != null) {
                loginRateLimiter.recordScopedFailure("mfa-stepup-user", userKey, MAX_ATTEMPTS);
                loginRateLimiter.recordScopedFailure("mfa-stepup-ip", ipKey, 20);
            }
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN,
                    "MFA_REQUIRED: Debes activar un autenticador TOTP para verificar el cambio de espacio."
            );
        }

        String code = rawCode == null ? "" : rawCode.trim();
        String decryptedSecret = TotpUtil.decryptAtRest(user.getMfaTotpSecret(), totpAtRestKey);
        java.util.OptionalLong matchedBucket = TotpUtil.findMatchingTotpBucket(decryptedSecret, code, Instant.now());
        if (matchedBucket.isEmpty()) {
            if (loginRateLimiter != null) {
                loginRateLimiter.recordScopedFailure("mfa-stepup-user", userKey, MAX_ATTEMPTS);
                loginRateLimiter.recordScopedFailure("mfa-stepup-ip", ipKey, 20);
            }
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN,
                    "MFA_STEP_UP_INVALID: El código TOTP ingresado no es válido."
            );
        }

        if (!tryConsumeTotpBucketAtomically(userId, matchedBucket.getAsLong(), code)) {
            if (loginRateLimiter != null) {
                loginRateLimiter.recordScopedFailure("mfa-stepup-user", userKey, MAX_ATTEMPTS);
                loginRateLimiter.recordScopedFailure("mfa-stepup-ip", ipKey, 20);
            }
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN,
                    "MFA_TOTP_REPLAYED: Este código TOTP ya fue utilizado. Espera al siguiente código."
            );
        }

        if (loginRateLimiter != null) {
            loginRateLimiter.resetScoped("mfa-stepup-user", userKey);
        }
    }

    /** Limpieza de desafíos MFA vencidos/consumidos y de marcas anti-replay TOTP expiradas. */
    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 600000, initialDelay = 120000)
    public void purgeExpiredMfaState() {
        jdbcTemplate.update("DELETE FROM omega_rag.mfa_challenges WHERE expires_at < NOW() - INTERVAL '1 day'");
        jdbcTemplate.update("DELETE FROM omega_rag.auth_rate_limits WHERE bucket_key LIKE 'totp-replay:%' AND window_expires_at <= NOW()");
    }

    private boolean tryConsumeTotpBucketAtomically(UUID userId, long matchedBucket, String code) {
        String bucketKey = "totp-replay:" + userId + ":" + TotpUtil.sha256Hex(matchedBucket + ":" + code);
        Instant expiresAt = Instant.ofEpochSecond((matchedBucket + 2L) * 30L + 30L);
        java.util.function.Supplier<Boolean> op = () -> {
            jdbcTemplate.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> {}, "totp:" + userId);
            jdbcTemplate.update(
                    "DELETE FROM omega_rag.auth_rate_limits WHERE bucket_key LIKE ? AND window_expires_at <= NOW()",
                    "totp-replay:" + userId + ":%"
            );
            int inserted = jdbcTemplate.update("""
                    INSERT INTO omega_rag.auth_rate_limits (bucket_key, attempt_count, window_expires_at, updated_at)
                    VALUES (?, 1, ?, NOW())
                    ON CONFLICT (bucket_key) DO NOTHING
                    """,
                    bucketKey,
                    Timestamp.from(expiresAt)
            );
            return inserted == 1;
        };
        if (transactionManager != null) {
            var tt = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
            tt.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            return Boolean.TRUE.equals(tt.execute(status -> op.get()));
        }
        return op.get();
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

            String greetingName = user.getFullName() == null || user.getFullName().isBlank()
                    ? "Analista"
                    : user.getFullName().trim().split("\\s+")[0];

            String plainText = "Hola " + greetingName + ",\n\n"
                    + title + "\n"
                    + "Tu código de verificación (válido por 5 minutos) es: " + code + "\n";

            String html = OmegaEmailTemplate.Spec.builder(title)
                    .preheader("Tu código de verificación de OMEGA caduca en 5 minutos.")
                    .addParagraph("Hola " + greetingName + ", usa el siguiente código de verificación para confirmar tu acceso a OMEGA.")
                    .verificationCode(code, "Válido por 5 minutos · Uso único")
                    .addParagraph("Si no intentaste iniciar sesión ni configurar la verificación en dos pasos, cambia tu contraseña de inmediato.")
                    .recipientEmail(user.getEmail())
                    .supportEmail(supportEmail==null || supportEmail.isBlank()?smtpFrom:supportEmail)
                    .render();

            helper.setText(plainText, html);
            OmegaEmailTemplate.attachMark(helper);
            mailSender.send(mimeMessage);
        } catch (Exception ex) {
            log.warn("Error enviando correo 2FA a {}: {}", maskEmail(user.getEmail()), ex.getMessage());
            throw new IllegalStateException("No se pudo enviar el correo de verificación 2FA.", ex);
        }
    }


    private static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
