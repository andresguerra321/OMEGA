package com.omega.platform.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.jsonwebtoken.Jwts;
import java.security.PrivateKey;
import java.time.Instant;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.BadCredentialsException;

class GoogleOidcClientTest {
    private static final String CLIENT = "omega-demo.apps.googleusercontent.com";
    private final GoogleOidcClient client = new GoogleOidcClient(CLIENT, "test-secret", "https://omega.example.org");

    @Test
    void authorizationSendsOnlyIdentityScopesAndOpaqueFlowValues() {
        assertThat(client.authorize("state", "nonce", "challenge").toString())
                .contains("scope=openid%20email", "code_challenge_method=S256")
                .doesNotContain("profile", "access_type=offline", "login_hint", "test-secret");
    }

    @Test
    void verifiesSignatureIssuerAudienceNonceExpiryAndEmail() {
        var pair = Jwts.SIG.RS256.keyPair().build();
        String token = signed(pair.getPrivate(), CLIENT, "https://accounts.google.com", true, Instant.now().plusSeconds(120));
        assertThat(client.verify(token, "bound-nonce", header -> pair.getPublic()))
                .isEqualTo(new GoogleOidcClient.Identity("opaque-google-id", "demo@gmail.com", true));
        assertThatThrownBy(() -> client.verify(token, "another-browser", header -> pair.getPublic())).isInstanceOf(BadCredentialsException.class);
        var wrongKey = Jwts.SIG.RS256.keyPair().build().getPublic();
        assertThatThrownBy(() -> client.verify(token, "bound-nonce", header -> wrongKey)).isInstanceOf(BadCredentialsException.class);
        for (String invalid : new String[] {
                signed(pair.getPrivate(), "other.apps.googleusercontent.com", "https://accounts.google.com", true, Instant.now().plusSeconds(120)),
                signed(pair.getPrivate(), CLIENT, "https://unrelated.example.org", true, Instant.now().plusSeconds(120)),
                signed(pair.getPrivate(), CLIENT, "https://accounts.google.com", false, Instant.now().plusSeconds(120)),
                signed(pair.getPrivate(), CLIENT, "https://accounts.google.com", true, Instant.now().minusSeconds(180)) }) {
            assertThatThrownBy(() -> client.verify(invalid, "bound-nonce", header -> pair.getPublic())).isInstanceOf(BadCredentialsException.class);
        }
    }

    private String signed(PrivateKey key, String audience, String issuer, boolean verified, Instant expiry) {
        return Jwts.builder().subject("opaque-google-id").issuer(issuer).audience().add(audience).and()
                .claim("nonce", "bound-nonce").claim("email", "Demo@gmail.com").claim("email_verified", verified)
                .issuedAt(Date.from(Instant.now().minusSeconds(200))).expiration(Date.from(expiry))
                .signWith(key, Jwts.SIG.RS256).compact();
    }
}
