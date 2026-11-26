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
    public static final String CLAIM_MFA_AT = "mfa_at";

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
        return issueToken(userId, tenantId, email, role, null);
    }

    public String issueToken(UUID userId, UUID tenantId, String email, Role role, Instant mfaAt) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(expirationSeconds);
        var builder = Jwts.builder()
                .issuer(issuer)
                .subject(userId.toString())
                .claim(CLAIM_TENANT_ID, tenantId.toString())
                .claim(CLAIM_ROLE, role.name())
                .claim(CLAIM_EMAIL, email)
                .claim("authn", "credentials-v1")
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiresAt));
        if (mfaAt != null) {
            builder.claim(CLAIM_MFA_AT, mfaAt.getEpochSecond());
        }
        return builder.signWith(signingKey, Jwts.SIG.HS256).compact();
    }

    public ParsedJwtClaims parseAndValidate(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .requireIssuer(issuer)
                    .require("authn", "credentials-v1")
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
            Number rawMfaAt = claims.get(CLAIM_MFA_AT, Number.class);
            Instant mfaAt = rawMfaAt != null ? Instant.ofEpochSecond(rawMfaAt.longValue()) : null;
            return new ParsedJwtClaims(userId, tenantId, email, role, mfaAt);
        } catch (IllegalArgumentException | NullPointerException ex) {
            throw new JwtException("Claims JWT inválidos o malformados", ex);
        }
    }

    public long getExpirationSeconds() {
        return expirationSeconds;
    }

    public String issueTrustedDeviceToken(UUID userId, long ttlSeconds) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(Math.max(60L, ttlSeconds));
        return Jwts.builder()
                .issuer(issuer)
                .subject(userId.toString())
                .claim("purpose", "trusted-device")
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiresAt))
                .signWith(signingKey, Jwts.SIG.HS256)
                .compact();
    }

    public boolean isTrustedDeviceTokenValid(String token, UUID expectedUserId) {
        if (token == null || token.isBlank() || expectedUserId == null) {
            return false;
        }
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .requireIssuer(issuer)
                    .require("purpose", "trusted-device")
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            return expectedUserId.equals(UUID.fromString(claims.getSubject()));
        } catch (JwtException | IllegalArgumentException | NullPointerException ex) {
            return false;
        }
    }

    public record ParsedJwtClaims(
            UUID userId,
            UUID tenantId,
            String email,
            Role role,
            Instant mfaAt
    ) {
        public ParsedJwtClaims(UUID userId, UUID tenantId, String email, Role role) {
            this(userId, tenantId, email, role, null);
        }
    }
}
