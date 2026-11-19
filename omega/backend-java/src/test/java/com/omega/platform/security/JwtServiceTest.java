package com.omega.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.omega.platform.config.OmegaProperties;
import io.jsonwebtoken.JwtException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class JwtServiceTest {

    @Test
    void rejectsSessionsIssuedBeforeMandatoryCredentialAuthentication() {
        String secret = java.util.HexFormat.of().formatHex(java.security.SecureRandom.getSeed(32));
        JwtService service = new JwtService(defaultProps(secret, "test"), new MockEnvironment());
        String legacy = io.jsonwebtoken.Jwts.builder()
                .issuer("omega-rag-core").subject(UUID.randomUUID().toString())
                .claim("tid", UUID.randomUUID().toString()).claim("email", "user@example.org").claim("role", "ADMIN")
                .expiration(java.util.Date.from(java.time.Instant.now().plusSeconds(3600)))
                .signWith(io.jsonwebtoken.security.Keys.hmacShaKeyFor(secret.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .compact();
        assertThatThrownBy(() -> service.parseAndValidate(legacy)).isInstanceOf(JwtException.class);
    }

    @Test
    void issuesAndParsesTenantScopedClaims() {
        OmegaProperties props = defaultProps("omega-unit-test-hmac-sha256-secret-key-32-chars", "test");
        JwtService jwtService = new JwtService(props, new MockEnvironment());

        UUID userId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();

        String token = jwtService.issueToken(userId, tenantId, "analyst@omega.sec", Role.ANALYST);
        JwtService.ParsedJwtClaims claims = jwtService.parseAndValidate(token);

        assertThat(claims.userId()).isEqualTo(userId);
        assertThat(claims.tenantId()).isEqualTo(tenantId);
        assertThat(claims.email()).isEqualTo("analyst@omega.sec");
        assertThat(claims.role()).isEqualTo(Role.ANALYST);
    }

    @Test
    void rejectsTamperedTokenAndDevSecretInProdProfile() {
        OmegaProperties props = defaultProps("omega-unit-test-hmac-sha256-secret-key-32-chars", "dev");
        JwtService jwtService = new JwtService(props, new MockEnvironment());
        String token = jwtService.issueToken(UUID.randomUUID(), UUID.randomUUID(), "a@b.co", Role.ADMIN);

        assertThatThrownBy(() -> jwtService.parseAndValidate(token + "tamper"))
                .isInstanceOf(JwtException.class);

        MockEnvironment prodEnv = new MockEnvironment();
        prodEnv.setActiveProfiles("prod");
        OmegaProperties devPlaceholder = defaultProps(
                "omega-dev-local-only-hmac-sha256-secret-key-2026-change-in-prod",
                "prod"
        );
        assertThatThrownBy(() -> new JwtService(devPlaceholder, prodEnv))
                .isInstanceOf(IllegalStateException.class);
    }

    private static OmegaProperties defaultProps(String secret, String ignoredProfile) {
        return new OmegaProperties(
                new OmegaProperties.Security(
                        secret,
                        3600,
                        "omega-rag-core",
                        true,
                        "",
                        "omega-test-internal-service-token"
                ),
                new OmegaProperties.Ingest("/tmp/omega_ingest", 26214400L, "/usr/share/tesseract-ocr/4.00/tessdata"),
                new OmegaProperties.Rag(
                        "openai",
                        "text-embedding-3-small",
                        1536,
                        "https://api.openai.com/v1",
                        "",
                        32,
                        2,
                        "gpt-4o-mini",
                        60,
                        1.0,
                        1.0,
                        500,
                        1000,
                        120
                ),
                new OmegaProperties.ForensicWorker("http://forensic-worker:8000", 5000, 120000),
                new OmegaProperties.Cti("/app/corpus_mvp/iocs")
        );
    }
}
