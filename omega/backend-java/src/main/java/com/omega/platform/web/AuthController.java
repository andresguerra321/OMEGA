package com.omega.platform.web;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.SessionCookieHelper;
import org.springframework.security.web.csrf.CsrfToken;
import com.omega.platform.service.AuthService;
import com.omega.platform.service.PasswordResetService;
import com.omega.platform.service.TwoFactorService;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import com.omega.platform.web.dto.AuthDtos.CreateTenantUserRequest;
import com.omega.platform.web.dto.AuthDtos.LoginRequest;
import com.omega.platform.web.dto.AuthDtos.MfaActivationResponse;
import com.omega.platform.web.dto.AuthDtos.MfaChallengeActionRequest;
import com.omega.platform.web.dto.AuthDtos.MfaCodeRequest;
import com.omega.platform.web.dto.AuthDtos.MfaDisableRequest;
import com.omega.platform.web.dto.AuthDtos.MfaEmailSetupResponse;
import com.omega.platform.web.dto.AuthDtos.MfaStatusResponse;
import com.omega.platform.web.dto.AuthDtos.MfaTotpSetupResponse;
import com.omega.platform.web.dto.AuthDtos.MfaVerifyLoginRequest;
import com.omega.platform.web.dto.AuthDtos.PasswordResetConfirmRequest;
import com.omega.platform.web.dto.AuthDtos.PasswordResetRequest;
import com.omega.platform.web.dto.AuthDtos.PasswordResetResponse;
import com.omega.platform.web.dto.AuthDtos.PrincipalMeResponse;
import com.omega.platform.web.dto.AuthDtos.RegisterAccountRequest;
import com.omega.platform.web.dto.AuthDtos.RegisterTenantRequest;
import com.omega.platform.web.dto.AuthDtos.UserSummaryResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final String PASSKEYS_ROADMAP_NOTE =
            "WebAuthn/FIDO2 Passkeys planificados en hoja de ruta para administradores de tenant y operadores de alto riesgo";

    private final AuthService authService;
    private final OmegaProperties properties;
    private final SessionCookieHelper sessionCookieHelper;
    private final PasswordResetService passwordResetService;
    private final TwoFactorService twoFactorService;
    private final com.omega.platform.security.LoginRateLimiter recoveryLimiter = new com.omega.platform.security.LoginRateLimiter();
    private final boolean smtpConfigured;

    public AuthController(AuthService authService, OmegaProperties properties) {
        this(authService, properties, null, null, null, "");
    }

    public AuthController(
            AuthService authService,
            OmegaProperties properties,
            SessionCookieHelper sessionCookieHelper) {
        this(authService, properties, sessionCookieHelper, null, null, "");
    }

    public AuthController(
            AuthService authService,
            OmegaProperties properties,
            SessionCookieHelper sessionCookieHelper,
            PasswordResetService passwordResetService,
            TwoFactorService twoFactorService) {
        this(authService, properties, sessionCookieHelper, passwordResetService, twoFactorService, "");
    }

    @Autowired
    public AuthController(
            AuthService authService,
            OmegaProperties properties,
            SessionCookieHelper sessionCookieHelper,
            @Autowired(required = false) PasswordResetService passwordResetService,
            @Autowired(required = false) TwoFactorService twoFactorService,
            @Value("${spring.mail.host:}") String smtpHost) {
        this.authService = authService;
        this.properties = properties;
        this.sessionCookieHelper = sessionCookieHelper;
        this.passwordResetService = passwordResetService;
        this.twoFactorService = twoFactorService;
        this.smtpConfigured = passwordResetService != null && passwordResetService.isSmtpConfigured();
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
    }

    @GetMapping("/config")
    public AuthConfigResponse config() {
        String bootstrap = properties.security().bootstrapSecret();
        boolean bootstrapRequired = bootstrap != null && !bootstrap.isBlank();
        return new AuthConfigResponse(
                properties.security().allowTenantSelfRegistration(),
                bootstrapRequired,
                true,
                false,
                PASSKEYS_ROADMAP_NOTE,
                smtpConfigured,
                false);
    }

    public record AuthConfigResponse(
            boolean tenantSelfRegistrationEnabled,
            boolean bootstrapSecretRequired,
            boolean cookieAuthEnabled,
            boolean passkeysSupported,
            String passkeysRoadmap,
            boolean smtpConfigured,
            boolean localAccessEnabled) {
        public AuthConfigResponse(boolean tenantSelfRegistrationEnabled, boolean bootstrapSecretRequired) {
            this(tenantSelfRegistrationEnabled, bootstrapSecretRequired, true, false, PASSKEYS_ROADMAP_NOTE, false, false);
        }

        public AuthConfigResponse(
                boolean tenantSelfRegistrationEnabled,
                boolean bootstrapSecretRequired,
                boolean cookieAuthEnabled,
                boolean passkeysSupported,
                String passkeysRoadmap) {
            this(tenantSelfRegistrationEnabled, bootstrapSecretRequired, cookieAuthEnabled, passkeysSupported, passkeysRoadmap, false, false);
        }

        public AuthConfigResponse(
                boolean tenantSelfRegistrationEnabled,
                boolean bootstrapSecretRequired,
                boolean cookieAuthEnabled,
                boolean passkeysSupported,
                String passkeysRoadmap,
                boolean smtpConfigured) {
            this(tenantSelfRegistrationEnabled, bootstrapSecretRequired, cookieAuthEnabled, passkeysSupported, passkeysRoadmap, smtpConfigured, false);
        }
    }

    @PostMapping("/register")
    @org.springframework.transaction.annotation.Transactional
    @ResponseStatus(HttpStatus.CREATED)
    public AuthTokenResponse registerAccount(
            @Valid @RequestBody RegisterAccountRequest request,
            @RequestHeader(value = "X-Omega-Bootstrap-Secret", required = false) String bootstrapSecret,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        AuthTokenResponse response = authService.registerAccount(request, bootstrapSecret);
        if (passwordResetService != null) {
            response = response.withRecoveryKey(passwordResetService.createRecoveryKey(response.userId(), request.password()).get("recoveryKey"));
        }
        attachSessionCookieIfAvailable(httpServletRequest, httpServletResponse, response);
        return response;
    }

    @PostMapping("/tenants/register")
    @org.springframework.transaction.annotation.Transactional
    @ResponseStatus(HttpStatus.CREATED)
    public AuthTokenResponse registerTenant(
            @Valid @RequestBody RegisterTenantRequest request,
            @RequestHeader(value = "X-Omega-Bootstrap-Secret", required = false) String bootstrapSecret,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        AuthTokenResponse response = authService.registerTenant(request, bootstrapSecret);
        if (passwordResetService != null) {
            response = response.withRecoveryKey(passwordResetService.createRecoveryKey(response.userId(), request.adminPassword()).get("recoveryKey"));
        }
        attachSessionCookieIfAvailable(httpServletRequest, httpServletResponse, response);
        return response;
    }

    private static final long TRUSTED_DEVICE_TTL_SECONDS = 30L * 24L * 3600L;

    @PostMapping("/login")
    public AuthTokenResponse login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        String trustedDeviceToken = sessionCookieHelper != null
                ? sessionCookieHelper.extractTrustedDeviceToken(httpServletRequest)
                : null;
        AuthTokenResponse response = (trustedDeviceToken != null && !trustedDeviceToken.isBlank())
                ? authService.login(request, httpServletRequest.getRemoteAddr(), trustedDeviceToken)
                : authService.login(request, httpServletRequest.getRemoteAddr());
        attachSessionCookieIfAvailable(httpServletRequest, httpServletResponse, response);
        if (sessionCookieHelper != null && response != null && !response.mfaRequired() && response.userId() != null) {
            if (Boolean.FALSE.equals(request.rememberMe())) {
                sessionCookieHelper.clearTrustedDeviceCookie(httpServletRequest, httpServletResponse);
            } else {
                String renewed = authService.issueTrustedDeviceToken(response.userId(), TRUSTED_DEVICE_TTL_SECONDS);
                sessionCookieHelper.attachTrustedDeviceCookie(
                        httpServletRequest, httpServletResponse, renewed, TRUSTED_DEVICE_TTL_SECONDS);
            }
        }
        return response;
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(
            @AuthenticationPrincipal OmegaPrincipal principal,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        if (sessionCookieHelper != null) {
            sessionCookieHelper.clearSessionCookie(httpServletRequest, httpServletResponse);
        }
        authService.recordLogout(principal);
        return Map.of(
                "loggedOut", true,
                "cookieCleared", true);
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    public UserSummaryResponse createUserInTenant(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody CreateTenantUserRequest request) {
        return authService.createUserInCurrentTenant(principal, request);
    }

    @GetMapping("/me")
    public PrincipalMeResponse me(@AuthenticationPrincipal OmegaPrincipal principal) {
        return authService.resolveCurrentPrincipal(principal);
    }

    @PostMapping("/password-reset/request")
    public PasswordResetResponse requestPasswordReset(@Valid @RequestBody PasswordResetRequest request, HttpServletRequest httpRequest) {
        recoveryLimiter.assertAllowed(httpRequest.getRemoteAddr(), request.email());
        recoveryLimiter.recordFailure(httpRequest.getRemoteAddr(), request.email());
        if (passwordResetService == null) {
            throw new IllegalStateException("Servicio de recuperación no inicializado.");
        }
        return passwordResetService.requestReset(request);
    }

    @PostMapping("/recovery-key")
    public Map<String, String> createRecoveryKey(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody MfaDisableRequest request) {
        return passwordResetService.createRecoveryKey(principal.userId(), request.password());
    }

    @PostMapping("/password-reset/confirm")
    public PasswordResetResponse confirmPasswordReset(@Valid @RequestBody PasswordResetConfirmRequest request, HttpServletRequest httpRequest) {
        if (passwordResetService == null) {
            throw new IllegalStateException("Servicio de recuperación no inicializado.");
        }
        String ip = httpRequest.getRemoteAddr();
        recoveryLimiter.assertAllowed(ip, request.email());
        try {
            PasswordResetResponse response = passwordResetService.confirmReset(request);
            recoveryLimiter.reset(ip, request.email());
            return response;
        } catch (org.springframework.security.authentication.BadCredentialsException ex) {
            recoveryLimiter.recordFailure(ip, request.email());
            throw ex;
        }
    }

    @PostMapping("/mfa/verify")
    public AuthTokenResponse verifyMfaLogin(
            @Valid @RequestBody MfaVerifyLoginRequest request,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        AuthTokenResponse response = authService.completeMfaLogin(request.challengeToken(), request.code());
        attachSessionCookieIfAvailable(httpServletRequest, httpServletResponse, response);
        if (sessionCookieHelper != null && !response.mfaRequired() && response.userId() != null) {
            if (Boolean.FALSE.equals(request.rememberDevice())) {
                sessionCookieHelper.clearTrustedDeviceCookie(httpServletRequest, httpServletResponse);
            } else {
                String trustedToken = authService.issueTrustedDeviceToken(response.userId(), TRUSTED_DEVICE_TTL_SECONDS);
                sessionCookieHelper.attachTrustedDeviceCookie(
                        httpServletRequest, httpServletResponse, trustedToken, TRUSTED_DEVICE_TTL_SECONDS);
            }
        }
        return response;
    }

    @PostMapping("/mfa/resend-email")
    public MfaEmailSetupResponse resendMfaEmail(@Valid @RequestBody MfaChallengeActionRequest request) {
        return requireTwoFactorService().resendEmailLoginChallenge(request.challengeToken());
    }

    @GetMapping("/mfa/status")
    public MfaStatusResponse getMfaStatus(@AuthenticationPrincipal OmegaPrincipal principal) {
        return requireTwoFactorService().getStatus(principal.userId());
    }

    @PostMapping("/mfa/totp/setup")
    public MfaTotpSetupResponse beginTotpSetup(@AuthenticationPrincipal OmegaPrincipal principal) {
        return requireTwoFactorService().beginTotpSetup(principal.userId());
    }

    @PostMapping("/mfa/totp/confirm")
    public MfaActivationResponse confirmTotpSetup(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody MfaCodeRequest request) {
        return requireTwoFactorService().confirmTotpSetup(principal.userId(), request.code());
    }

    @PostMapping("/mfa/email/setup")
    public MfaEmailSetupResponse beginEmailMfaSetup(@AuthenticationPrincipal OmegaPrincipal principal) {
        return requireTwoFactorService().beginEmailSetup(principal.userId());
    }

    @PostMapping("/mfa/email/confirm")
    public MfaActivationResponse confirmEmailMfaSetup(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody MfaCodeRequest request) {
        return requireTwoFactorService().confirmEmailSetup(principal.userId(), request.code());
    }

    @PostMapping("/mfa/disable")
    public MfaStatusResponse disableMfa(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody MfaDisableRequest request) {
        return requireTwoFactorService().disableMfa(principal.userId(), request.password());
    }

    private TwoFactorService requireTwoFactorService() {
        if (twoFactorService == null) {
            throw new IllegalStateException("Servicio 2FA no inicializado.");
        }
        return twoFactorService;
    }

    private void attachSessionCookieIfAvailable(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthTokenResponse tokenResponse) {
        if (sessionCookieHelper != null
                && tokenResponse != null
                && !tokenResponse.mfaRequired()
                && tokenResponse.accessToken() != null) {
            sessionCookieHelper.attachSessionCookie(request, response, tokenResponse.accessToken());
        }
    }
}
