package com.omega.platform.service;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Cliente mínimo para verificar autorización de instalaciones GitHub App del usuario.
 */
public interface GitHubApiClient {

    boolean userHasInstallationAccess(String userAccessToken, long installationId);

    @Component
    class DefaultGitHubApiClient implements GitHubApiClient {

        private final RestClient restClient = RestClient.builder()
                .baseUrl("https://api.github.com")
                .defaultHeader(HttpHeaders.ACCEPT, "application/vnd.github+json")
                .defaultHeader("X-GitHub-Api-Version", "2022-11-28")
                .defaultHeader(HttpHeaders.USER_AGENT, "OMEGA-Security-Platform/2.0.9")
                .build();

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
                if (item instanceof Map<?, ?> map) {
                    Object idVal = map.get("id");
                    if (idVal instanceof Number num && num.longValue() == installationId) {
                        return true;
                    }
                }
            }
            return false;
        }
    }
}
