package com.omega.platform.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.web.ValidationPatterns;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import com.omega.platform.web.dto.AuthDtos.RegisterAccountRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class GoogleAuthFlow {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final AuthService auth;
    private final GoogleOidcClient google;
    private final CommercialDocuments documents;
    private final PasswordResetService recovery;
    private final AuditLogService audit;
    private final TransactionTemplate tx;
    private final SecureRandom random = new SecureRandom();

    public GoogleAuthFlow(JdbcTemplate jdbc, ObjectMapper json, AuthService auth, GoogleOidcClient google,
                          CommercialDocuments documents, PasswordResetService recovery, AuditLogService audit,
                          PlatformTransactionManager transactions) {
        this.jdbc = jdbc;
        this.json = json;
        this.auth = auth;
        this.google = google;
        this.documents = documents;
        this.recovery = recovery;
        this.audit = audit;
        this.tx = new TransactionTemplate(transactions);
    }

    public Start begin(Action action, Registration registration, String terms, OmegaPrincipal actor, String password) {
        return begin(action, registration, terms, actor, password, false);
    }

    public Start begin(Action action, Registration registration, String terms, OmegaPrincipal actor, String password, boolean desktop) {
        if (action == Action.REGISTER) {
            if (!auth.googleRegistrationAllowed()) throw new AccessDeniedException("El registro con Google no está habilitado.");
            if (registration == null || (registration.organizationName() != null && !registration.organizationName().isBlank()
                    && !registration.organizationAdminConfirmed())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Completa los datos y confirma el tipo de cuenta.");
            }
            documents.requireRegistration(terms);
        }
        if (action == Action.LINK) {
            if (actor == null) throw new AccessDeniedException("Inicia sesión en OMEGA para vincular Google.");
            auth.verifyPasswordForGoogleLink(actor, password);
        }

        String state = (desktop ? "D_" : "W_") + randomValue().substring(2);
        String browser = randomValue();
        jdbc.update("""
                INSERT INTO omega_rag.google_auth_attempts(state,browser_hash,action,user_id,tenant_id,registration,commercial_version,desktop,expires_at)
                VALUES (?,?,?,?,?,CAST(? AS jsonb),?,?,now()+interval '8 minutes')
                """, state, digest(browser), action.name(), action == Action.LINK ? actor.userId() : null,
                action == Action.LINK ? actor.tenantId() : null,
                action == Action.REGISTER ? encode(registration) : null, action == Action.REGISTER ? terms : null, desktop);
        return new Start(google.authorize(state, nonce(state, browser), digest(verifier(state, browser))), browser);
    }

    public Result finish(String state, String code, String browser, OmegaPrincipal actor) {
        return finish(state, code, browser, actor, false);
    }

    public void relayDesktopCallback(String state, String code) {
        if (jdbc.update("""
                UPDATE omega_rag.google_auth_attempts SET callback_code=?,callback_canceled=?
                WHERE state=? AND desktop AND expires_at>now() AND callback_code IS NULL AND NOT callback_canceled
                """, code, code == null, state) != 1) throw invalidAttempt();
    }

    public Result finishDesktop(String state, String proof, OmegaPrincipal actor) {
        return finish(state, null, proof, actor, true);
    }

    private Result finish(String state, String code, String browser, OmegaPrincipal actor, boolean desktop) {
        if (browser == null || !browser.matches("[A-Za-z0-9_-]{43}")) throw invalidAttempt();
        Attempt attempt = jdbc.query("""
                DELETE FROM omega_rag.google_auth_attempts
                WHERE state=? AND browser_hash=? AND expires_at>now() AND desktop=?
                  AND (action<>'LINK' OR (user_id=? AND tenant_id=?))
                  AND (NOT desktop OR callback_code IS NOT NULL OR callback_canceled)
                RETURNING action,registration::text,commercial_version,callback_code,callback_canceled
                """, (rs, row) -> new Attempt(Action.valueOf(rs.getString(1)), rs.getString(2), rs.getString(3), rs.getString(4), rs.getBoolean(5)),
                state, digest(browser), desktop, actor == null ? null : actor.userId(), actor == null ? null : actor.tenantId())
                .stream().findFirst().orElse(null);

        if (attempt == null) {
            if (desktop && Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT EXISTS(SELECT 1 FROM omega_rag.google_auth_attempts
                    WHERE state=? AND browser_hash=? AND desktop AND expires_at>now()
                      AND (action<>'LINK' OR (user_id=? AND tenant_id=?)))
                    """, Boolean.class, state, digest(browser), actor == null ? null : actor.userId(),
                    actor == null ? null : actor.tenantId()))) return null;
            throw invalidAttempt();
        }
        if (attempt.canceled()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Google no completó la autorización. Inténtalo de nuevo.");

        var identity = google.exchange(desktop ? attempt.code() : code, verifier(state, browser), nonce(state, browser));
        String subjectHash = digest("omega:google:" + identity.subject());
        if (attempt.action() == Action.LOGIN) {
            UUID user = jdbc.query("SELECT user_id FROM omega_rag.google_identities WHERE subject_hash=?",
                    (rs, row) -> rs.getObject(1, UUID.class), subjectHash).stream().findFirst()
                    .orElseThrow(() -> new BadCredentialsException("Inicia sesión con tu cuenta de OMEGA para vincular Google, o regístrate."));
            return new Result(Action.LOGIN, auth.loginWithGoogle(user));
        }

        if (!identity.authoritativeEmail() || !identity.email().matches(ValidationPatterns.STRICT_EMAIL_REGEX)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Usa una dirección de Gmail o Google Workspace verificada por Google.");
        }
        if (attempt.action() == Action.LINK) {
            if (!identity.email().equalsIgnoreCase(actor.email())) {
                throw new AccessDeniedException("El correo de Google debe coincidir con el de tu cuenta de OMEGA.");
            }
            return tx.execute(status -> {
                bind(subjectHash, actor.userId());
                audit.record(actor.tenantId(), actor.userId(), "AUTH_GOOGLE_LINKED", "USER", actor.userId().toString(), java.util.Map.of());
                return new Result(Action.LINK, null);
            });
        }

        Registration registration = decode(attempt.registration());
        return tx.execute(status -> {
            documents.requireRegistration(attempt.terms());
            String recoveryPassword = randomValue() + "-Aa1";
            var request = new RegisterAccountRequest(registration.fullName(), identity.email(), recoveryPassword,
                    registration.organizationName(), registration.profile(), registration.organizationAdminConfirmed());
            AuthTokenResponse session = auth.registerGoogleAccount(request);
            bind(subjectHash, session.userId());
            documents.recordRegistration(session, attempt.terms());
            String key = recovery.createRecoveryKey(session.userId(), recoveryPassword).get("recoveryKey");
            return new Result(Action.REGISTER, session.withRecoveryKey(key));
        });
    }

    public boolean linked(UUID user) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM omega_rag.google_identities WHERE user_id=?)", Boolean.class, user));
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void clearExpiredAttempts() {
        jdbc.update("DELETE FROM omega_rag.google_auth_attempts WHERE expires_at<=now()");
    }

    private void bind(String subjectHash, UUID user) {
        if (jdbc.update("INSERT INTO omega_rag.google_identities(subject_hash,user_id) VALUES (?,?) ON CONFLICT DO NOTHING",
                subjectHash, user) != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya existe una vinculación con Google para esta identidad o cuenta.");
        }
    }

    private String encode(Registration registration) {
        try { return json.writeValueAsString(registration); }
        catch (JsonProcessingException e) { throw new IllegalStateException("No se pudo preparar el registro."); }
    }

    private Registration decode(String registration) {
        try { return json.readValue(registration, Registration.class); }
        catch (JsonProcessingException e) { throw invalidAttempt(); }
    }

    private static BadCredentialsException invalidAttempt() {
        return new BadCredentialsException("El intento de Google venció o no corresponde a este navegador. Inténtalo de nuevo.");
    }

    private String randomValue() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String verifier(String state, String browser) { return digest("verifier:" + state + ":" + browser); }
    private static String nonce(String state, String browser) { return digest("nonce:" + state + ":" + browser); }

    private static String digest(String data) {
        try {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(
                    MessageDigest.getInstance("SHA-256").digest(data.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public enum Action { LOGIN, REGISTER, LINK }
    public record Start(URI url, String browser) {}
    public record Result(Action action, AuthTokenResponse session) {}
    private record Attempt(Action action, String registration, String terms, String code, boolean canceled) {}
    public record Registration(
            @NotBlank @Size(min = 2, max = 200) @Pattern(regexp = ValidationPatterns.PERSON_NAME_REGEX) String fullName,
            @Size(max = 200) @Pattern(regexp = ValidationPatterns.OPTIONAL_ORGANIZATION_NAME_REGEX) String organizationName,
            @NotNull TenantProfile profile, boolean organizationAdminConfirmed) {}
}
