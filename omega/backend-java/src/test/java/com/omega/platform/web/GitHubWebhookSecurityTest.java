package com.omega.platform.web;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import com.omega.platform.repository.GitHubOAuthStateRepository;
import com.omega.platform.repository.GitHubWebhookDeliveryRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.JsonSecurityHandlers;
import com.omega.platform.security.JwtAuthenticationFilter;
import com.omega.platform.security.JwtService;
import com.omega.platform.security.Role;
import com.omega.platform.security.SecurityConfig;
import com.omega.platform.security.SessionCookieHelper;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.GitHubApiClient;
import com.omega.platform.service.GitHubAppIntegrationService;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = GitHubIntegrationController.class)
@Import({
        SecurityConfig.class,
        JwtAuthenticationFilter.class,
        SessionCookieHelper.class,
        JsonSecurityHandlers.class,
        GitHubAppIntegrationService.class,
        ObjectMapper.class
})
@TestPropertySource(properties = "OMEGA_GITHUB_WEBHOOK_SECRET=test-webhook-secret-123")
class GitHubWebhookSecurityTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private GitHubAppInstallationRepository installationRepository;

    @MockBean
    private GitHubOAuthStateRepository stateRepository;

    @MockBean
    private GitHubWebhookDeliveryRepository deliveryRepository;

    @MockBean
    private GitHubApiClient gitHubApiClient;

    @MockBean
    private AuditLogService auditLogService;

    @MockBean
    private TenantRepository tenantRepository;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserRepository userRepository;

    private static String sign(byte[] body, String secret) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body));
    }

    @Test
    void webhookValidatesRawHmacAndAntiReplayWithoutJwt() throws Exception {
        byte[] body = "{\"action\":\"suspend\",\"installation\":{\"id\":123}}".getBytes(StandardCharsets.UTF_8);
        String sig = sign(body, "test-webhook-secret-123");

        when(deliveryRepository.tryRecordDelivery(eq("deliv-1"), anyInt())).thenReturn(true);

        mvc.perform(post("/api/v1/integrations/github/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Hub-Signature-256", sig)
                        .header("X-GitHub-Delivery", "deliv-1")
                        .header("X-GitHub-Event", "installation")
                        .content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.accepted").value(true));

        // Replay con mismo deliveryId -> 200 OK idempotente
        when(deliveryRepository.tryRecordDelivery(eq("deliv-1"), anyInt())).thenReturn(false);
        mvc.perform(post("/api/v1/integrations/github/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Hub-Signature-256", sig)
                        .header("X-GitHub-Delivery", "deliv-1")
                        .header("X-GitHub-Event", "installation")
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.duplicate").value(true));

        // Payload > 1 MiB -> 413 Payload Too Large
        byte[] oversized = new byte[GitHubAppIntegrationService.MAX_WEBHOOK_BYTES + 10];
        mvc.perform(post("/api/v1/integrations/github/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Hub-Signature-256", sig)
                        .header("X-GitHub-Delivery", "deliv-big")
                        .header("X-GitHub-Event", "installation")
                        .content(oversized))
                .andExpect(status().isPayloadTooLarge());

        // Firma inválida -> 403 Forbidden
        mvc.perform(post("/api/v1/integrations/github/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Hub-Signature-256", "sha256=" + "0".repeat(64))
                        .header("X-GitHub-Delivery", "deliv-2")
                        .header("X-GitHub-Event", "installation")
                        .content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void onlyAdminCanCreateLinkState() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        JwtService.ParsedJwtClaims claims = new JwtService.ParsedJwtClaims(
                userId, tenantId, "analyst@omega.test", Role.ANALYST);
        UserEntity user = mock(UserEntity.class);
        when(user.getId()).thenReturn(userId);
        when(user.getTenantId()).thenReturn(tenantId);
        when(user.isActive()).thenReturn(true);
        when(user.getRole()).thenReturn(Role.ANALYST);
        when(user.getEmail()).thenReturn(claims.email());

        when(jwtService.parseAndValidate("tok-analyst")).thenReturn(claims);
        when(userRepository.findActiveUserInActiveTenant(userId, tenantId)).thenReturn(Optional.of(user));
        when(tenantRepository.findByIdAndActiveTrue(tenantId))
                .thenReturn(Optional.of(new TenantEntity("dev-org", "Dev Org", TenantProfile.DEVELOPER)));

        mvc.perform(post("/api/v1/integrations/github/state")
                        .header("Authorization", "Bearer tok-analyst"))
                .andExpect(status().isForbidden());
    }
}
