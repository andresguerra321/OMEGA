package com.omega.platform.security;

import com.omega.platform.config.OmegaProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

    public static final String CLAIM_TENANT_ID = "tid";
    public static final String CLAIM_ROLE = "role";
    public static final String CLAIM_EMAIL = "email";

    private static final String DEV_SECRET_MARKER = "omega-dev-local-only";

    private final SecretKey signingKey;
    private final String issuer;
    private final long expirationSeconds;

    public JwtService(OmegaProperties properties, Environment environment) {
        String rawSecret = properties.security().jwtSecret();
        boolean isProd = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(profile -> profile.equalsIgnoreCase("prod") || profile.equalsIgnoreCase("production"));
        if (isProd && rawSecret.contains(DEV_SECRET_MARKER)) {
            throw new IllegalStateException("OMEGA_JWT_SECRET de desarrollo prohibido en perfil prod/production");
        }
        byte[] keyBytes = rawSecret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            throw new IllegalStateException("OMEGA_JWT_SECRET debe medir al menos 32 bytes para HMAC-SHA256");
        }
        this.signingKey = Keys.hmacShaKeyFor(keyBytes);
        this.issuer = properties.security().jwtIssuer();
        this.expirationSeconds = properties.security().jwtExpirationSeconds();
    }

    public String issueToken(UUID userId, UUID tenantId, String email, Role role) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(expirationSeconds);
        return Jwts.builder()
                .issuer(issuer)
                .subject(userId.toString())
                .claim(CLAIM_TENANT_ID, tenantId.toString())
                .claim(CLAIM_ROLE, role.name())
                .claim(CLAIM_EMAIL, email)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiresAt))
                .signWith(signingKey, Jwts.SIG.HS256)
                .compact();
    }

    public ParsedJwtClaims parseAndValidate(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .requireIssuer(issuer)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            UUID userId = UUID.fromString(claims.getSubject());
            UUID tenantId = UUID.fromString(claims.get(CLAIM_TENANT_ID, String.class));
            Role role = Role.valueOf(claims.get(CLAIM_ROLE, String.class));
            String email = claims.get(CLAIM_EMAIL, String.class);
            if (email == null || email.isBlank()) {
                throw new JwtException("Claim email faltante en JWT");
            }
            return new ParsedJwtClaims(userId, tenantId, email, role);
        } catch (IllegalArgumentException | NullPointerException ex) {
            throw new JwtException("Claims JWT inválidos o malformados", ex);
        }
    }

    public long getExpirationSeconds() {
        return expirationSeconds;
    }

    public record ParsedJwtClaims(
            UUID userId,
            UUID tenantId,
            String email,
            Role role
    ) {
    }
}
