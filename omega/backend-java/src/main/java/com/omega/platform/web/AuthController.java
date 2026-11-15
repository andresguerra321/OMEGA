package com.omega.platform.web;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.SessionCookieHelper;
import com.omega.platform.service.AuthService;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import com.omega.platform.web.dto.AuthDtos.CreateTenantUserRequest;
import com.omega.platform.web.dto.AuthDtos.LoginRequest;
import com.omega.platform.web.dto.AuthDtos.PrincipalMeResponse;
import com.omega.platform.web.dto.AuthDtos.RegisterAccountRequest;
import com.omega.platform.web.dto.AuthDtos.RegisterTenantRequest;
import com.omega.platform.web.dto.AuthDtos.UserSummaryResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
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

    public AuthController(AuthService authService, OmegaProperties properties) {
        this(authService, properties, null);
    }

    @Autowired
    public AuthController(
            AuthService authService,
            OmegaProperties properties,
            SessionCookieHelper sessionCookieHelper) {
        this.authService = authService;
        this.properties = properties;
        this.sessionCookieHelper = sessionCookieHelper;
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
                PASSKEYS_ROADMAP_NOTE);
    }

    public record AuthConfigResponse(
            boolean tenantSelfRegistrationEnabled,
            boolean bootstrapSecretRequired,
            boolean cookieAuthEnabled,
            boolean passkeysSupported,
            String passkeysRoadmap) {
        public AuthConfigResponse(boolean tenantSelfRegistrationEnabled, boolean bootstrapSecretRequired) {
            this(tenantSelfRegistrationEnabled, bootstrapSecretRequired, true, false, PASSKEYS_ROADMAP_NOTE);
        }
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthTokenResponse registerAccount(
            @Valid @RequestBody RegisterAccountRequest request,
            @RequestHeader(value = "X-Omega-Bootstrap-Secret", required = false) String bootstrapSecret,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        AuthTokenResponse response = authService.registerAccount(request, bootstrapSecret);
        attachSessionCookieIfAvailable(httpServletRequest, httpServletResponse, response);
        return response;
    }

    @PostMapping("/tenants/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthTokenResponse registerTenant(
            @Valid @RequestBody RegisterTenantRequest request,
            @RequestHeader(value = "X-Omega-Bootstrap-Secret", required = false) String bootstrapSecret,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        AuthTokenResponse response = authService.registerTenant(request, bootstrapSecret);
        attachSessionCookieIfAvailable(httpServletRequest, httpServletResponse, response);
        return response;
    }

    @PostMapping("/login")
    public AuthTokenResponse login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpServletRequest,
            HttpServletResponse httpServletResponse) {
        AuthTokenResponse response = authService.login(request, httpServletRequest.getRemoteAddr());
        attachSessionCookieIfAvailable(httpServletRequest, httpServletResponse, response);
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

    private void attachSessionCookieIfAvailable(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthTokenResponse tokenResponse) {
        if (sessionCookieHelper != null && tokenResponse != null) {
            sessionCookieHelper.attachSessionCookie(request, response, tokenResponse.accessToken());
        }
    }
}
