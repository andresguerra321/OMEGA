package com.omega.platform.security;

import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.UserRepository;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Extrae el JWT Bearer o la cookie HttpOnly de sesión, valida firma e integridad
 * del usuario/tenant activos e inyecta un TenantScope inmutable en ThreadLocal
 * (limpiado siempre en finally).
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";
    private static final Set<String> PUBLIC_AUTH_PATHS = Set.of(
            "/actuator/health",
            "/api/v1/auth/config",
            "/api/v1/public/commercial",
            "/api/v1/auth/csrf",
            "/api/v1/auth/login",
            "/api/v1/auth/logout",
            "/api/v1/auth/register",
            "/api/v1/auth/tenants/register",
            "/api/v1/auth/password-reset/request",
            "/api/v1/auth/password-reset/confirm",
            "/api/v1/auth/mfa/verify",
            "/api/v1/auth/mfa/resend-email",
            "/api/v1/integrations/github/webhook",
            "/api/v1/billing/webhooks/mercadopago"
    );

    private final JwtService jwtService;
    private final UserRepository userRepository;
    private final JsonSecurityHandlers securityHandlers;
    private final SessionCookieHelper sessionCookieHelper;

    public JwtAuthenticationFilter(
            JwtService jwtService,
            UserRepository userRepository,
            JsonSecurityHandlers securityHandlers
    ) {
        this(jwtService, userRepository, securityHandlers, null);
    }

    @Autowired
    public JwtAuthenticationFilter(
            JwtService jwtService,
            UserRepository userRepository,
            JsonSecurityHandlers securityHandlers,
            SessionCookieHelper sessionCookieHelper
    ) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
        this.securityHandlers = securityHandlers;
        this.sessionCookieHelper = sessionCookieHelper;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        boolean isPublicAuthPath = PUBLIC_AUTH_PATHS.contains(request.getRequestURI());
        try {
            if (SecurityContextHolder.getContext().getAuthentication() != null) {
                filterChain.doFilter(request, response);
                return;
            }
            String token = resolveJwtToken(request);
            if (token == null || token.isEmpty()) {
                filterChain.doFilter(request, response);
                return;
            }

            JwtService.ParsedJwtClaims claims = jwtService.parseAndValidate(token);
            Optional<UserEntity> activeUser = userRepository.findActiveUserInActiveTenant(
                    claims.userId(),
                    claims.tenantId()
            );

            if (activeUser.isEmpty()) {
                SecurityContextHolder.clearContext();
                if (isPublicAuthPath) {
                    filterChain.doFilter(request, response);
                    return;
                }
                securityHandlers.commence(
                        request,
                        response,
                        new BadCredentialsException("Tu cuenta o espacio de trabajo no se encuentra activo.")
                );
                return;
            }

            UserEntity user = activeUser.get();
            OmegaPrincipal principal = new OmegaPrincipal(
                    user.getId(),
                    user.getTenantId(),
                    user.getEmail(),
                    user.getRole(),
                    user.isActive()
            );

            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

            SecurityContextHolder.getContext().setAuthentication(authentication);
            TenantContext.set(new TenantScope(principal.tenantId(), principal.userId(), principal.role()));

            filterChain.doFilter(request, response);
        } catch (JwtException ex) {
            SecurityContextHolder.clearContext();
            if (isPublicAuthPath) {
                filterChain.doFilter(request, response);
                return;
            }
            securityHandlers.commence(
                    request,
                    response,
                    new BadCredentialsException("Tu sesión expiró o no es válida. Inicia sesión nuevamente.", ex)
            );
        } finally {
            TenantContext.clear();
        }
    }

    private String resolveJwtToken(HttpServletRequest request) {
        String bearer = extractBearerToken(request);
        // An explicit Bearer header must never fall back to ambient cookie credentials.
        if (bearer != null) {
            return bearer;
        }
        return sessionCookieHelper == null || isBearerOnlyRequest(request)
                ? null : sessionCookieHelper.extractSessionToken(request);
    }

    public static boolean isBearerOnlyRequest(HttpServletRequest request) {
        return request != null && "bearer".equals(request.getHeader("X-Omega-Auth-Mode"));
    }

    static String extractBearerToken(HttpServletRequest request) {
        String authHeader = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authHeader != null && authHeader.startsWith(BEARER_PREFIX)) {
            return authHeader.substring(BEARER_PREFIX.length()).trim();
        }
        return null;
    }
}
