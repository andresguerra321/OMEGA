package com.omega.platform.service;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

@Component
public class GitHubBrowserOAuth {
    private final String slug;
    private final String clientId;
    private final String clientSecret;
    private final String callbackUrl;
    private final boolean appConfigured;
    private final RestClient github;

    public GitHubBrowserOAuth(
            @Value("${OMEGA_GITHUB_APP_SLUG:}") String slug,
            @Value("${OMEGA_GITHUB_APP_CLIENT_ID:}") String clientId,
            @Value("${OMEGA_GITHUB_APP_CLIENT_SECRET:}") String clientSecret,
            @Value("${OMEGA_GITHUB_PUBLIC_ORIGIN:}") String publicOrigin,
            @Value("${OMEGA_GITHUB_APP_ID:}") String appId,
            @Value("${OMEGA_GITHUB_APP_PRIVATE_KEY:}") String privateKey,
            @Value("${OMEGA_GITHUB_WEBHOOK_SECRET:}") String webhookSecret
    ) {
        this.slug = slug.trim();
        this.clientId = clientId.trim();
        this.clientSecret = clientSecret.trim();
        this.callbackUrl = publicOrigin.trim().replaceFirst("/$", "") + "/github/callback";
        this.appConfigured = appId.matches("[0-9]+") && !privateKey.isBlank() && !webhookSecret.isBlank();
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5)).build());
        factory.setReadTimeout(Duration.ofSeconds(10));
        this.github = RestClient.builder().baseUrl("https://github.com").requestFactory(factory).build();
    }

    public void requireConfigured() {
        if (!appConfigured || !slug.matches("[a-zA-Z0-9-]+") || clientId.isBlank() || clientSecret.isBlank()
                || !callbackUrl.matches("https://[a-zA-Z0-9.-]+(:[0-9]+)?/github/callback")) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "La conexión con GitHub todavía no está configurada en este servidor.");
        }
    }

    public URI installationUrl(String state) {
        return UriComponentsBuilder.fromUriString("https://github.com")
                .pathSegment("apps", slug, "installations", "new")
                .queryParam("state", "{state}").encode().buildAndExpand(state).toUri();
    }

    public URI authorizationUrl(String state, long installationId) {
        try {
            String challenge = base64(MessageDigest.getInstance("SHA-256").digest(
                    verifier(state, installationId).getBytes(StandardCharsets.US_ASCII)));
            return UriComponentsBuilder.fromUriString("https://github.com/login/oauth/authorize")
                    .queryParam("client_id", "{client}").queryParam("redirect_uri", "{callback}")
                    .queryParam("state", "{state}").queryParam("code_challenge", challenge)
                    .queryParam("code_challenge_method", "S256").encode()
                    .buildAndExpand(clientId, callbackUrl, state).toUri();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("No se pudo preparar PKCE para GitHub", e);
        }
    }

    public String exchangeCode(String state, long installationId, String code) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        form.add("redirect_uri", callbackUrl);
        form.add("code", code);
        form.add("code_verifier", verifier(state, installationId));
        try {
            JsonNode response = github.post().uri("/login/oauth/access_token")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED).accept(MediaType.APPLICATION_JSON)
                    .body(form).retrieve().body(JsonNode.class);
            String token = response == null ? "" : response.path("access_token").asText("");
            if (!token.isBlank()) return token;
        } catch (RestClientException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "GitHub no pudo completar la autorización.");
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La autorización de GitHub venció o no es válida.");
    }

    private String verifier(String state, long installationId) {
        try {
            // Derive the verifier from the server secret so the browser never receives it.
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(clientSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return base64(mac.doFinal(("omega-github-pkce:" + state + ":" + installationId)
                    .getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("No se pudo preparar PKCE para GitHub", e);
        }
    }

    private static String base64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
