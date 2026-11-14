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
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Extrae el JWT Bearer, valida firma e integridad del usuario/tenant activos
 * e inyecta un TenantScope inmutable en ThreadLocal (limpiado siempre en finally).
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final UserRepository userRepository;
    private final JsonSecurityHandlers securityHandlers;

    public JwtAuthenticationFilter(
            JwtService jwtService,
            UserRepository userRepository,
            JsonSecurityHandlers securityHandlers
    ) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
        this.securityHandlers = securityHandlers;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        try {
            String authHeader = request.getHeader(HttpHeaders.AUTHORIZATION);
            if (authHeader == null || !authHeader.startsWith(BEARER_PREFIX)) {
                filterChain.doFilter(request, response);
                return;
            }

            String token = authHeader.substring(BEARER_PREFIX.length()).trim();
            if (token.isEmpty()) {
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
                securityHandlers.commence(
                        request,
                        response,
                        new BadCredentialsException("Usuario o tenant inactivo o inexistente")
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
            securityHandlers.commence(
                    request,
                    response,
                    new BadCredentialsException("Token JWT inválido o expirado", ex)
            );
        } finally {
            TenantContext.clear();
        }
    }
}
