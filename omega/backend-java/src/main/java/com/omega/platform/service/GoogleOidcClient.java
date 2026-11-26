package com.omega.platform.service;

import com.fasterxml.jackson.databind.JsonNode;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.Locator;
import io.jsonwebtoken.LocatorAdapter;
import io.jsonwebtoken.ProtectedHeader;
import io.jsonwebtoken.UnsupportedJwtException;
import io.jsonwebtoken.security.Jwks;
import java.net.URI;
import java.net.http.HttpClient;
import java.security.Key;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

@Component
public class GoogleOidcClient {
    private final String clientId;
    private final String clientSecret;
    private final String origin;
    private final RestClient http;
    private Map<String, Key> keys = Map.of();
    private Instant keysExpireAt = Instant.EPOCH;

    public GoogleOidcClient(@Value("${OMEGA_GOOGLE_CLIENT_ID:}") String clientId,
                            @Value("${OMEGA_GOOGLE_CLIENT_SECRET:}") String clientSecret,
                            @Value("${OMEGA_GOOGLE_PUBLIC_ORIGIN:}") String origin) {
        this.clientId = clientId.strip();
        this.clientSecret = clientSecret.strip();
        this.origin = origin.strip().replaceFirst("/$", "");
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5)).build());
        factory.setReadTimeout(Duration.ofSeconds(10));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    public boolean configured() {
        return clientId.endsWith(".apps.googleusercontent.com") && !clientSecret.isBlank()
                && origin.matches("(?:https://[a-zA-Z0-9.-]+|http://localhost)(?::[0-9]+)?");
    }

    public String origin() { return origin; }

    private String callback() { return origin + "/google/callback"; }

    public URI authorize(String state, String nonce, String challenge) {
        return UriComponentsBuilder.fromUriString("https://accounts.google.com/o/oauth2/v2/auth")
                .queryParam("client_id", "{client}").queryParam("redirect_uri", "{callback}")
                .queryParam("response_type", "code").queryParam("scope", "{scope}")
                .queryParam("state", state).queryParam("nonce", nonce)
                .queryParam("code_challenge", challenge).queryParam("code_challenge_method", "S256")
                .queryParam("prompt", "select_account").encode()
                .buildAndExpand(clientId, callback(), "openid email").toUri();
    }

    public Identity exchange(String code, String verifier, String nonce) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "authorization_code");
        form.add("code", code);
        form.add("redirect_uri", callback());
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        form.add("code_verifier", verifier);
        try {
            JsonNode response = http.post().uri("https://oauth2.googleapis.com/token")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(JsonNode.class);
            String token = response == null ? "" : response.path("id_token").asText("");
            return verify(token, nonce, new LocatorAdapter<Key>() {
                @Override protected Key locate(ProtectedHeader header) {
                    if (!"RS256".equals(header.getAlgorithm()) || header.getKeyId() == null) {
                        throw new UnsupportedJwtException("Clave de Google inválida");
                    }
                    return signingKey(header.getKeyId());
                }
            });
        } catch (RestClientException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Google no pudo completar la autenticación.");
        }
    }

    Identity verify(String token, String nonce, Locator<Key> locator) {
        try {
            var claims = Jwts.parser().requireAudience(clientId).require("nonce", nonce)
                    .keyLocator(locator).clockSkewSeconds(30).build().parseSignedClaims(token).getPayload();
            String subject = claims.getSubject();
            String email = claims.get("email", String.class);
            String authorizedParty = claims.get("azp", String.class);
            if (!("https://accounts.google.com".equals(claims.getIssuer()) || "accounts.google.com".equals(claims.getIssuer()))
                    || claims.getExpiration() == null || claims.getIssuedAt() == null
                    || claims.getIssuedAt().toInstant().isAfter(Instant.now().plusSeconds(30))
                    || ((authorizedParty != null || claims.getAudience().size() > 1) && !clientId.equals(authorizedParty))
                    || !Boolean.TRUE.equals(claims.get("email_verified", Boolean.class))
                    || subject == null || subject.isBlank() || subject.length() > 255
                    || email == null || email.isBlank() || email.length() > 255) {
                throw new BadCredentialsException("No se pudo verificar la identidad de Google.");
            }
            String normalizedEmail = email.strip().toLowerCase(Locale.ROOT);
            String domain = claims.get("hd", String.class);
            boolean authoritative = normalizedEmail.endsWith("@gmail.com")
                    || (domain != null && !domain.isBlank()
                            && normalizedEmail.endsWith("@" + domain.toLowerCase(Locale.ROOT)));
            return new Identity(subject, normalizedEmail, authoritative);
        } catch (JwtException | IllegalArgumentException e) {
            throw new BadCredentialsException("No se pudo verificar la identidad de Google.");
        }
    }

    private synchronized Key signingKey(String kid) {
        if (!keysExpireAt.isAfter(Instant.now()) || !keys.containsKey(kid)) {
            var response = http.get().uri("https://www.googleapis.com/oauth2/v3/certs").retrieve().toEntity(String.class);
            keys = Jwks.setParser().build().parse(response.getBody()).getKeys().stream()
                    .filter(jwk -> jwk.getId() != null && jwk.toKey() instanceof RSAPublicKey)
                    .collect(Collectors.toUnmodifiableMap(jwk -> jwk.getId(), jwk -> jwk.toKey()));
            var age = java.util.regex.Pattern.compile("(?:^|,)\\s*max-age=(\\d+)").matcher(
                    response.getHeaders().getCacheControl() == null ? "" : response.getHeaders().getCacheControl());
            long maxAge = age.find() ? Math.min(3600, Long.parseLong(age.group(1))) : 300;
            keysExpireAt = Instant.now().plusSeconds(maxAge);
        }
        Key key = keys.get(kid);
        if (key == null) throw new UnsupportedJwtException("Clave de Google desconocida");
        return key;
    }

    public record Identity(String subject, String email, boolean authoritativeEmail) {}
}
