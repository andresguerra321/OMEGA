package com.omega.platform.service;

import io.jsonwebtoken.Jwts;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Cliente HTTP para GitHub App (solo lectura + comentario único en PR opcional).
 */
public interface GitHubApiClient {

    Set<String> ALLOWED_TARBALL_HOSTS = Set.of("api.github.com", "codeload.github.com");

    boolean userHasInstallationAccess(String userAccessToken, long installationId);

    String createInstallationAccessToken(long installationId);

    List<String> listPullRequestFiles(String installationToken, String repoFullName, int prNumber);

    byte[] downloadTarballBounded(String installationToken, String repoFullName, String refSha, int maxBytes);

    void upsertPullRequestComment(
            String installationToken,
            String repoFullName,
            int prNumber,
            String marker,
            String bodyMarkdown
    );

    @Component
    class DefaultGitHubApiClient implements GitHubApiClient {

        private final String appId;
        private final String appPrivateKeyPem;
        private final String expectedBotLogin;
        private final RestClient restClient = RestClient.builder()
                .baseUrl("https://api.github.com")
                .defaultHeader(HttpHeaders.ACCEPT, "application/vnd.github+json")
                .defaultHeader("X-GitHub-Api-Version", "2022-11-28")
                .defaultHeader(HttpHeaders.USER_AGENT, "OMEGA-Security-Platform/2.0.9")
                .build();
        private final HttpClient noRedirectClient = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(10))
                .build();

        public DefaultGitHubApiClient(
                @Value("${OMEGA_GITHUB_APP_ID:}") String appId,
                @Value("${OMEGA_GITHUB_APP_PRIVATE_KEY:}") String appPrivateKeyPem,
                @Value("${OMEGA_GITHUB_APP_BOT_LOGIN:}") String expectedBotLogin
        ) {
            this.appId = appId != null ? appId.trim() : "";
            this.appPrivateKeyPem = appPrivateKeyPem != null ? appPrivateKeyPem.trim() : "";
            this.expectedBotLogin = expectedBotLogin != null ? expectedBotLogin.trim() : "";
        }

        @Override
        @SuppressWarnings("unchecked")
        public boolean userHasInstallationAccess(String userAccessToken, long installationId) {
            if (userAccessToken == null || userAccessToken.isBlank()) {
                return false;
            }
            Map<String, Object> body = restClient.get()
                    .uri("/user/installations?per_page=100")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + userAccessToken.trim())
                    .retrieve()
                    .body(Map.class);
            if (body == null || !(body.get("installations") instanceof List<?> installations)) {
                return false;
            }
            for (Object item : installations) {
                if (item instanceof Map<?, ?> map && map.get("id") instanceof Number num && num.longValue() == installationId) {
                    return true;
                }
            }
            return false;
        }

        @Override
        @SuppressWarnings("unchecked")
        public String createInstallationAccessToken(long installationId) {
            if (appId.isBlank() || appPrivateKeyPem.isBlank()) {
                throw new IllegalStateException("OMEGA_GITHUB_APP_ID o OMEGA_GITHUB_APP_PRIVATE_KEY no configurados");
            }
            String appJwt = buildShortLivedAppJwt(appId, parsePkcs8PrivateKey(appPrivateKeyPem));
            Map<String, Object> resp = restClient.post()
                    .uri("/app/installations/{id}/access_tokens", installationId)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + appJwt)
                    .retrieve()
                    .body(Map.class);
            if (resp == null || !(resp.get("token") instanceof String token) || token.isBlank()) {
                throw new IllegalStateException("GitHub no devolvió token de instalación");
            }
            return token;
        }

        @Override
        @SuppressWarnings("unchecked")
        public List<String> listPullRequestFiles(String installationToken, String repoFullName, int prNumber) {
            List<Map<String, Object>> files = restClient.get()
                    .uri(repositoryPath(repoFullName) + "/pulls/{pr}/files?per_page=100", prNumber)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + installationToken)
                    .retrieve()
                    .body(List.class);
            if (files == null) {
                return List.of();
            }
            List<String> names = new ArrayList<>(files.size());
            for (Map<String, Object> item : files) {
                if (item.get("filename") instanceof String fn) {
                    names.add(fn);
                }
            }
            return names;
        }

        @Override
        public byte[] downloadTarballBounded(
                String installationToken,
                String repoFullName,
                String refSha,
                int maxBytes
        ) {
            URI currentUri = URI.create("https://api.github.com" + repositoryPath(repoFullName) + "/tarball/" + refSha);
            for (int hop = 0; hop <= 2; hop++) {
                validateAllowedTarballUri(currentUri);
                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder(currentUri)
                        .timeout(Duration.ofSeconds(30))
                        .header(HttpHeaders.USER_AGENT, "OMEGA-Security-Platform/2.0.9")
                        .GET();
                if ("api.github.com".equalsIgnoreCase(currentUri.getHost())) {
                    reqBuilder.header(HttpHeaders.AUTHORIZATION, "Bearer " + installationToken);
                    reqBuilder.header(HttpHeaders.ACCEPT, "application/vnd.github+json");
                }
                try {
                    HttpResponse<InputStream> resp = noRedirectClient.send(
                            reqBuilder.build(),
                            HttpResponse.BodyHandlers.ofInputStream()
                    );
                    int status = resp.statusCode();
                    if (status >= 300 && status < 400) {
                        String loc = resp.headers().firstValue("Location").orElse("");
                        resp.body().close();
                        if (loc.isBlank()) {
                            throw new IllegalStateException("Redirección sin cabecera Location");
                        }
                        currentUri = currentUri.resolve(loc);
                        continue;
                    }
                    if (status < 200 || status >= 300) {
                        resp.body().close();
                        throw new IllegalStateException("Error descargando tarball de GitHub (HTTP " + status + ")");
                    }
                    try (InputStream is = resp.body()) {
                        byte[] bytes = is.readNBytes(maxBytes + 1);
                        if (bytes.length > maxBytes) {
                            throw new IllegalArgumentException("El tarball supera el límite permitido (" + maxBytes + " bytes)");
                        }
                        return bytes;
                    }
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Descarga de tarball interrumpida", ex);
                } catch (IOException ex) {
                    throw new IllegalStateException("Fallo de red descargando tarball", ex);
                }
            }
            throw new IllegalStateException("Demasiadas redirecciones descargando tarball");
        }

        @Override
        @SuppressWarnings("unchecked")
        public void upsertPullRequestComment(
                String installationToken,
                String repoFullName,
                int prNumber,
                String marker,
                String bodyMarkdown
        ) {
            if (expectedBotLogin.isBlank()) {
                throw new IllegalStateException("OMEGA_GITHUB_APP_BOT_LOGIN no configurado; filtro de comentario falla cerrado");
            }
            List<Map<String, Object>> comments = restClient.get()
                    .uri(repositoryPath(repoFullName) + "/issues/{pr}/comments?per_page=100", prNumber)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + installationToken)
                    .retrieve()
                    .body(List.class);

            Long existingId = null;
            if (comments != null) {
                for (Map<String, Object> c : comments) {
                    if (c.get("body") instanceof String b && b.contains(marker) && c.get("id") instanceof Number n) {
                        String authorLogin = c.get("user") instanceof Map<?, ?> u && u.get("login") instanceof String l
                                ? l.trim()
                                : "";
                        if (!expectedBotLogin.equalsIgnoreCase(authorLogin)) {
                            continue;
                        }
                        existingId = n.longValue();
                        break;
                    }
                }
            }

            if (existingId != null) {
                restClient.patch()
                        .uri(repositoryPath(repoFullName) + "/issues/comments/{commentId}", existingId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + installationToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(Map.of("body", bodyMarkdown))
                        .retrieve()
                        .toBodilessEntity();
            } else {
                restClient.post()
                        .uri(repositoryPath(repoFullName) + "/issues/{pr}/comments", prNumber)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + installationToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(Map.of("body", bodyMarkdown))
                        .retrieve()
                        .toBodilessEntity();
            }
        }

        private static String repositoryPath(String repoFullName) {
            if (repoFullName == null || !repoFullName.matches("[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+")
                    || repoFullName.endsWith("/.") || repoFullName.endsWith("/..")) {
                throw new IllegalArgumentException("Repositorio inválido; se requiere propietario/repositorio");
            }
            // Keep the owner/repository separator out of URI variables, which encode it as %2F.
            return "/repos/" + repoFullName;
        }

        public static void validateAllowedTarballUri(URI uri) {
            if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) {
                throw new SecurityException("Solo se permite HTTPS para descargar tarballs de GitHub");
            }
            String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
            if (!ALLOWED_TARBALL_HOSTS.contains(host)) {
                throw new SecurityException("Host de descarga no permitido en lista blanca: " + host);
            }
        }

        private static String buildShortLivedAppJwt(String appId, PrivateKey privateKey) {
            Instant now = Instant.now();
            return Jwts.builder()
                    .issuer(appId)
                    .issuedAt(Date.from(now.minusSeconds(30)))
                    .expiration(Date.from(now.plusSeconds(300)))
                    .signWith(privateKey, Jwts.SIG.RS256)
                    .compact();
        }

        private static PrivateKey parsePkcs8PrivateKey(String pem) {
            try {
                String clean = pem
                        .replace("-----BEGIN PRIVATE KEY-----", "")
                        .replace("-----END PRIVATE KEY-----", "")
                        .replaceAll("\\s+", "");
                byte[] decoded = Base64.getDecoder().decode(clean);
                return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(decoded));
            } catch (Exception ex) {
                throw new IllegalStateException("Clave privada de GitHub App inválida (se requiere PKCS#8 PEM)", ex);
            }
        }
    }
}
