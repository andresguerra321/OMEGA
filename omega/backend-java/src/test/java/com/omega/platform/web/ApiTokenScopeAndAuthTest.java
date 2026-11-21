package com.omega.platform.web;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.ApiTokenAuthenticationFilter;
import com.omega.platform.security.JsonSecurityHandlers;
import com.omega.platform.security.JwtAuthenticationFilter;
import com.omega.platform.security.JwtService;
import com.omega.platform.security.Role;
import com.omega.platform.security.SecurityConfig;
import com.omega.platform.security.SessionCookieHelper;
import com.omega.platform.service.ApiTokenService;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.TenantProfileConfigService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.RestClient;

@WebMvcTest(controllers = {ApiTokenController.class, ProfileConfigController.class, RepoScannerProxyController.class})
@Import({
        SecurityConfig.class,
        ApiTokenAuthenticationFilter.class,
        JwtAuthenticationFilter.class,
        SessionCookieHelper.class,
        JsonSecurityHandlers.class,
        TenantProfileConfigService.class
})
class ApiTokenScopeAndAuthTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private ApiTokenService apiTokenService;

    @MockBean
    private TenantRepository tenantRepository;

    @MockBean
    private com.omega.platform.repository.DocumentRepository documentRepository;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserRepository userRepository;

    @MockBean
    private AuditLogService auditLogService;

    @MockBean
    @Qualifier("forensicWorkerRestClient")
    private RestClient forensicWorkerRestClient;

    @Test
    void apiTokenAllowsRepoScanAndBlocksOtherApiEndpoints() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID tokenId = UUID.randomUUID();
        String rawToken = "omega_scan_validtoken_secret_12345";

        when(apiTokenService.authenticate(rawToken)).thenReturn(Optional.of(
                new ApiTokenService.AuthenticatedApiToken(tokenId, tenantId, userId, ApiTokenService.SCOPE_REPO_SCAN)));

        RestClient.RequestHeadersUriSpec uriSpec = mock(RestClient.RequestHeadersUriSpec.class);
        RestClient.RequestHeadersSpec headersSpec = mock(RestClient.RequestHeadersSpec.class);
        RestClient.ResponseSpec responseSpec = mock(RestClient.ResponseSpec.class);
        when(forensicWorkerRestClient.get()).thenReturn(uriSpec);
        when(uriSpec.uri("/api/repo/scan/{scanId}", "scan-123")).thenReturn(headersSpec);
        when(headersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(Map.class)).thenReturn(Map.of("scan_id", "scan-123", "status", "COMPLETED"));

        // Allowed: /api/v1/repo/scan/{scanId}
        mvc.perform(get("/api/v1/repo/scan/scan-123")
                        .header("Authorization", "Bearer " + rawToken))
                .andExpect(status().isOk());

        // Forbidden: /api/v1/profile/config and /api/v1/api-tokens
        mvc.perform(get("/api/v1/profile/config")
                        .header("Authorization", "Bearer " + rawToken))
                .andExpect(status().isForbidden());

        mvc.perform(get("/api/v1/api-tokens")
                        .header("Authorization", "Bearer " + rawToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void invalidApiTokenReturns401AndNeverLeaksTokenInResponse() throws Exception {
        String badToken = "omega_scan_invalid_secret_value_999";
        when(apiTokenService.authenticate(badToken)).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/repo/scan/scan-123")
                        .header("Authorization", "Bearer " + badToken))
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(not(containsString(badToken))));
    }

    @Test
    void clientRoleCannotCreateApiTokens() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        JwtService.ParsedJwtClaims claims = new JwtService.ParsedJwtClaims(
                userId, tenantId, "client@omega.test", Role.CLIENT);
        UserEntity user = mock(UserEntity.class);
        when(user.getId()).thenReturn(userId);
        when(user.getTenantId()).thenReturn(tenantId);
        when(user.isActive()).thenReturn(true);
        when(user.getRole()).thenReturn(Role.CLIENT);
        when(user.getEmail()).thenReturn(claims.email());

        when(jwtService.parseAndValidate("tok-client")).thenReturn(claims);
        when(userRepository.findActiveUserInActiveTenant(userId, tenantId)).thenReturn(Optional.of(user));
        when(tenantRepository.findByIdAndActiveTrue(tenantId))
                .thenReturn(Optional.of(new TenantEntity("dev-org", "Dev Org", TenantProfile.DEVELOPER)));

        mvc.perform(post("/api/v1/api-tokens")
                        .header("Authorization", "Bearer tok-client")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"ci-token\"}"))
                .andExpect(status().isForbidden());
    }
}
