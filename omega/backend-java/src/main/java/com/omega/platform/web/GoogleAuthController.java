package com.omega.platform.web;

import com.omega.platform.security.LoginRateLimiter;
import com.omega.platform.security.JwtAuthenticationFilter;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.SessionCookieHelper;
import com.omega.platform.service.AuthService;
import com.omega.platform.service.GoogleAuthFlow;
import com.omega.platform.service.GoogleOidcClient;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/auth/google")
public class GoogleAuthController {
    private static final String FLOW_COOKIE = "omega_google_flow";
    private static final Set<String> DESKTOP_ORIGINS = Set.of("http://tauri.localhost", "https://tauri.localhost", "tauri://localhost");
    private final GoogleAuthFlow flow;
    private final GoogleOidcClient google;
    private final AuthService auth;
    private final LoginRateLimiter limiter;
    private final SessionCookieHelper sessionCookies;

    public GoogleAuthController(GoogleAuthFlow flow, GoogleOidcClient google, AuthService auth,
                                LoginRateLimiter limiter, SessionCookieHelper sessionCookies) {
        this.flow = flow;
        this.google = google;
        this.auth = auth;
        this.limiter = limiter;
        this.sessionCookies = sessionCookies;
    }

    @GetMapping("/config")
    public Map<String, Boolean> config() {
        boolean enabled = google.configured();
        return Map.of("enabled", enabled, "desktopEnabled", enabled, "registrationEnabled", enabled && auth.googleRegistrationAllowed());
    }

    @GetMapping("/connection")
    public Map<String, Boolean> connection(@AuthenticationPrincipal OmegaPrincipal actor) {
        boolean enabled = google.configured();
        return Map.of("enabled", enabled, "desktopEnabled", enabled, "linked", enabled && flow.linked(actor.userId()));
    }

    @PostMapping("/start")
    public Map<String, String> start(@Valid @RequestBody StartRequest input, @AuthenticationPrincipal OmegaPrincipal actor,
            @RequestHeader(value = "X-Omega-Commercial-Version", required = false) @Size(max = 160) String terms,
            HttpServletRequest request, HttpServletResponse response) {
        requireSameOrigin(request);
        limit("google-auth-start", request);
        limitLink(input, actor);
        var start = flow.begin(input.action(), input.registration(), terms, actor, input.password());
        setFlowCookie(response, start.browser(), 480);
        return Map.of("url", start.url().toString());
    }

    @PostMapping("/finish")
    public GoogleAuthFlow.Result finish(@Valid @RequestBody FinishRequest input,
            @CookieValue(value = FLOW_COOKIE, required = false) String browser, @AuthenticationPrincipal OmegaPrincipal actor,
            HttpServletRequest request, HttpServletResponse response) {
        requireSameOrigin(request);
        limit("google-auth-finish", request);
        setFlowCookie(response, "", 0);
        var result = flow.finish(input.state(), input.code(), browser, actor);
        if (result.session() != null && !result.session().mfaRequired() && result.session().accessToken() != null) {
            sessionCookies.attachSessionCookie(request, response, result.session().accessToken());
        }
        return result;
    }

    @PostMapping("/desktop/start")
    public Map<String, String> startDesktop(@Valid @RequestBody StartRequest input, @AuthenticationPrincipal OmegaPrincipal actor,
            @RequestHeader(value = "X-Omega-Commercial-Version", required = false) @Size(max = 160) String terms,
            HttpServletRequest request) {
        requireDesktopOrigin(request);
        limit("google-auth-start", request);
        limitLink(input, actor);
        var start = flow.begin(input.action(), input.registration(), terms, actor, input.password(), true);
        return Map.of("url", start.url().toString(), "proof", start.browser());
    }

    @PostMapping("/desktop/relay")
    public ResponseEntity<Void> relayDesktop(@Valid @RequestBody DesktopRelay input, HttpServletRequest request) {
        requireSameOrigin(request);
        limit("google-desktop-relay", request);
        flow.relayDesktopCallback(input.state(), input.code());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/desktop/finish")
    public ResponseEntity<GoogleAuthFlow.Result> finishDesktop(@Valid @RequestBody DesktopFinish input,
            @AuthenticationPrincipal OmegaPrincipal actor, HttpServletRequest request) {
        requireDesktopOrigin(request);
        String ip = request.getRemoteAddr();
        limiter.assertScopedAllowed("google-desktop-finish", ip, 25);
        try {
            var result = flow.finishDesktop(input.state(), input.proof(), actor);
            return result == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(result);
        } catch (BadCredentialsException ex) {
            limiter.recordScopedFailure("google-desktop-finish", ip, 25);
            throw ex;
        }
    }

    private void limitLink(StartRequest input, OmegaPrincipal actor) {
        if (input.action() == GoogleAuthFlow.Action.LINK && actor != null) {
            String account = actor.userId().toString();
            limiter.assertScopedAllowed("google-link-account", account, 5);
            limiter.recordScopedFailure("google-link-account", account, 5);
        }
    }

    private void requireDesktopOrigin(HttpServletRequest request) {
        String origin = request.getHeader(HttpHeaders.ORIGIN);
        if (google.configured() && origin != null && JwtAuthenticationFilter.isBearerOnlyRequest(request)
                && (DESKTOP_ORIGINS.contains(origin) || google.origin().equals(origin))) return;
        throw new AccessDeniedException("Abre OMEGA Desktop para completar el acceso con Google.");
    }

    private void requireSameOrigin(HttpServletRequest request) {
        if (!google.configured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Google aún no está configurado.");
        }
        if (!google.origin().equals(request.getHeader(HttpHeaders.ORIGIN))) {
            throw new AccessDeniedException("Abre OMEGA en el origen configurado para iniciar sesión con Google.");
        }
    }

    private void limit(String scope, HttpServletRequest request) {
        String ip = request.getRemoteAddr();
        limiter.assertScopedAllowed(scope, ip, 25);
        limiter.recordScopedFailure(scope, ip, 25);
    }

    private void setFlowCookie(HttpServletResponse response, String value, int maxAge) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(FLOW_COOKIE, value)
                .httpOnly(true).secure(google.origin().startsWith("https://")).sameSite("Strict")
                .path("/api/v1/auth/google").maxAge(maxAge).build().toString());
    }

    public record StartRequest(@NotNull GoogleAuthFlow.Action action, @Valid GoogleAuthFlow.Registration registration,
                               @Size(max = 128) String password) {}
    public record FinishRequest(@NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String state,
                                @NotBlank @Size(max = 2048) String code) {}
    public record DesktopRelay(@NotBlank @Pattern(regexp = "D_[A-Za-z0-9_-]{41}") String state,
                               @Size(min = 1, max = 2048) String code) {}
    public record DesktopFinish(@NotBlank @Pattern(regexp = "D_[A-Za-z0-9_-]{41}") String state,
                                @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String proof) {}
}
