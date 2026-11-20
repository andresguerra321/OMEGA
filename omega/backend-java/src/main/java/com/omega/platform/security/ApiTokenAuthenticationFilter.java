package com.omega.platform.security;

import com.omega.platform.service.ApiTokenService;
import com.omega.platform.service.ApiTokenService.AuthenticatedApiToken;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Autentica tokens de API de alcance limitado (omega_scan_...) sin exponer JWTs ni credenciales de usuario.
 */
@Component
public class ApiTokenAuthenticationFilter extends OncePerRequestFilter {

    public static final String API_TOKEN_ID_ATTR = "OMEGA_API_TOKEN_ID";
    private static final String BEARER_PREFIX = "Bearer ";

    private final ApiTokenService apiTokenService;
    private final JsonSecurityHandlers securityHandlers;

    @Autowired
    public ApiTokenAuthenticationFilter(
            ObjectProvider<ApiTokenService> apiTokenServiceProvider,
            JsonSecurityHandlers securityHandlers
    ) {
        this.apiTokenService = apiTokenServiceProvider.getIfAvailable();
        this.securityHandlers = securityHandlers;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String rawToken = resolveApiToken(request);
        if (rawToken == null || apiTokenService == null) {
            filterChain.doFilter(request, response);
            return;
        }

        boolean managedTenantContext = false;
        try {
            Optional<AuthenticatedApiToken> verified = apiTokenService.authenticate(rawToken);
            if (verified.isEmpty()) {
                SecurityContextHolder.clearContext();
                securityHandlers.commence(
                        request,
                        response,
                        new BadCredentialsException("Token de API inválido, revocado, expirado o agotado")
                );
                return;
            }

            AuthenticatedApiToken tokenInfo = verified.get();
            OmegaPrincipal principal = new OmegaPrincipal(
                    tokenInfo.createdByUserId(),
                    tokenInfo.tenantId(),
                    "api-token:" + tokenInfo.tokenId(),
                    Role.CLIENT,
                    false
            );
            String scopeAuthority = "SCOPE_" + tokenInfo.scope();
            UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    principal,
                    null,
                    List.of(new SimpleGrantedAuthority(scopeAuthority))
            );
            auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

            SecurityContextHolder.getContext().setAuthentication(auth);
            TenantContext.set(new TenantScope(tokenInfo.tenantId(), tokenInfo.createdByUserId(), Role.CLIENT));
            request.setAttribute(API_TOKEN_ID_ATTR, tokenInfo.tokenId());
            managedTenantContext = true;

            filterChain.doFilter(request, response);
        } finally {
            if (managedTenantContext) {
                TenantContext.clear();
            }
        }
    }

    private static String resolveApiToken(HttpServletRequest request) {
        String headerKey = request.getHeader("X-Omega-Api-Key");
        if (headerKey != null && !headerKey.isBlank()) {
            String trimmed = headerKey.trim();
            if (trimmed.startsWith(ApiTokenService.TOKEN_PREFIX)) {
                return trimmed;
            }
        }
        String authHeader = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authHeader != null && authHeader.startsWith(BEARER_PREFIX)) {
            String candidate = authHeader.substring(BEARER_PREFIX.length()).trim();
            if (candidate.startsWith(ApiTokenService.TOKEN_PREFIX)) {
                return candidate;
            }
        }
        return null;
    }
}
