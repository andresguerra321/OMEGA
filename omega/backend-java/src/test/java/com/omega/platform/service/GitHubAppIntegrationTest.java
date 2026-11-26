package com.omega.platform.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.GitHubAppInstallationEntity;
import com.omega.platform.domain.GitHubOAuthStateEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import com.omega.platform.repository.GitHubOAuthStateRepository;
import com.omega.platform.repository.GitHubWebhookDeliveryRepository;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.server.ResponseStatusException;

class GitHubAppIntegrationTest {

    @Test
    void migrationV14ExistsAndIsReversible() throws Exception {
        Path migration = Path.of("src/main/resources/db/migration/V14__github_app_integrations.sql");
        assertTrue(Files.exists(migration));
        String sql = Files.readString(migration);
        assertTrue(sql.contains("omega_rag.github_app_installations"));
        assertTrue(sql.contains("omega_rag.github_oauth_states"));
        assertTrue(sql.contains("omega_rag.github_webhook_deliveries"));
        assertTrue(sql.contains("DROP TABLE IF EXISTS omega_rag.github_app_installations"));
    }

    @Test
    void rejectsForeignInstallationAndReusedStateAndCrossTenantInstallation() {
        GitHubAppInstallationRepository installRepo = mock(GitHubAppInstallationRepository.class);
        GitHubOAuthStateRepository stateRepo = mock(GitHubOAuthStateRepository.class);
        GitHubWebhookDeliveryRepository deliveryRepo = mock(GitHubWebhookDeliveryRepository.class);
        GitHubApiClient apiClient = mock(GitHubApiClient.class);
        AuditLogService auditLogService = mock(AuditLogService.class);

        GitHubAppIntegrationService service = new GitHubAppIntegrationService(
                installRepo, stateRepo, deliveryRepo, apiClient, auditLogService, new ObjectMapper(), "wh-secret");

        UUID tenantA = UUID.randomUUID();
        UUID userA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();

        GitHubOAuthStateEntity stateEntity = new GitHubOAuthStateEntity(
                "state-1", tenantA, userA, Instant.now().plus(5, ChronoUnit.MINUTES), Instant.now());
        when(stateRepo.findByStateTokenAndTenantIdAndUserId("state-1", tenantA, userA))
                .thenReturn(Optional.of(stateEntity));
        when(apiClient.userHasInstallationAccess("ghu_user", 999L)).thenReturn(false);

        // Intento de vincular una instalación ajena (usuario no tiene acceso en GitHub)
        assertThrows(AccessDeniedException.class,
                () -> service.completeInstallationLink(tenantA, userA, "state-1", 999L, "ghu_user", "acme"));

        // State quedó consumido (single-use)
        assertThrows(AccessDeniedException.class,
                () -> service.completeInstallationLink(tenantA, userA, "state-1", 999L, "ghu_user", "acme"));

        // State nuevo, usuario sí tiene acceso, pero installation_id ya pertenece a tenantB -> 409 Conflict
        GitHubOAuthStateEntity state2 = new GitHubOAuthStateEntity(
                "state-2", tenantA, userA, Instant.now().plus(5, ChronoUnit.MINUTES), Instant.now());
        when(stateRepo.findByStateTokenAndTenantIdAndUserId("state-2", tenantA, userA))
                .thenReturn(Optional.of(state2));
        when(apiClient.userHasInstallationAccess("ghu_user", 777L)).thenReturn(true);
        when(installRepo.findByInstallationId(777L))
                .thenReturn(Optional.of(new GitHubAppInstallationEntity(
                        UUID.randomUUID(), tenantB, 777L, "other-org", "[]", UUID.randomUUID(), Instant.now())));

        ResponseStatusException conflict = assertThrows(ResponseStatusException.class,
                () -> service.completeInstallationLink(tenantA, userA, "state-2", 777L, "ghu_user", "acme"));
        assertEquals(409, conflict.getStatusCode().value());
    }

    @Test
    void browserLinkUsesTheInstallationAccountReturnedByGitHubAndConsumesState() {
        var installations = mock(GitHubAppInstallationRepository.class);
        var states = mock(GitHubOAuthStateRepository.class);
        var gitHub = mock(GitHubApiClient.class);
        var service = new GitHubAppIntegrationService(installations, states,
                mock(GitHubWebhookDeliveryRepository.class), gitHub, mock(AuditLogService.class), new ObjectMapper(), "test");
        UUID tenant = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        Instant now = Instant.now();
        var state = new GitHubOAuthStateEntity("browser-state", tenant, user, now.plusSeconds(60), now);
        when(states.findByStateTokenAndTenantIdAndUserId("browser-state", tenant, user)).thenReturn(Optional.of(state));
        when(gitHub.userInstallationAccount("test-token", 123L)).thenReturn(Optional.of("demo-org"));

        assertThrows(AccessDeniedException.class,
                () -> service.verifyPendingLink(UUID.randomUUID(), user, "browser-state"));
        assertEquals("demo-org", service.completeBrowserLink(tenant, user, "browser-state", 123L, "test-token").accountLogin());
        assertThrows(AccessDeniedException.class, () -> service.verifyPendingLink(tenant, user, "browser-state"));
    }

    @Test
    void browserAuthorizationBindsPkceToStateAndInstallation() {
        var oauth = new GitHubBrowserOAuth("omega-demo", "client-id", "client-secret",
                "https://demo.example.org", "123", "configured-key", "configured-webhook");
        oauth.requireConfigured();
        assertEquals("https://github.com/apps/omega-demo/installations/new?state=some-state",
                oauth.installationUrl("some-state").toString());

        var first = org.springframework.web.util.UriComponentsBuilder.fromUri(oauth.authorizationUrl("some-state", 123))
                .build().getQueryParams();
        var second = org.springframework.web.util.UriComponentsBuilder.fromUri(oauth.authorizationUrl("some-state", 456))
                .build().getQueryParams();
        assertEquals("S256", first.getFirst("code_challenge_method"));
        assertEquals("some-state", first.getFirst("state"));
        assertEquals(43, first.getFirst("code_challenge").length());
        assertNotEquals(first.getFirst("code_challenge"), second.getFirst("code_challenge"));
        assertFalse(first.containsKey("client_secret"));
    }

    @Test
    void processesInstallationAndRepositoryLifecycleWebhooks() {
        GitHubAppInstallationRepository installRepo = mock(GitHubAppInstallationRepository.class);
        GitHubOAuthStateRepository stateRepo = mock(GitHubOAuthStateRepository.class);
        GitHubWebhookDeliveryRepository deliveryRepo = mock(GitHubWebhookDeliveryRepository.class);
        GitHubApiClient apiClient = mock(GitHubApiClient.class);
        AuditLogService auditLogService = mock(AuditLogService.class);

        GitHubAppIntegrationService service = new GitHubAppIntegrationService(
                installRepo, stateRepo, deliveryRepo, apiClient, auditLogService, new ObjectMapper(), "wh-secret");

        GitHubAppInstallationEntity entity = new GitHubAppInstallationEntity(
                UUID.randomUUID(), UUID.randomUUID(), 555L, "acme", "[\"acme/old\"]", UUID.randomUUID(), Instant.now());
        when(installRepo.findByInstallationId(555L)).thenReturn(Optional.of(entity));

        byte[] repoChange = """
                {
                  "action": "added",
                  "installation": {"id": 555},
                  "repositories_added": [{"full_name": "acme/new-repo"}],
                  "repositories_removed": [{"full_name": "acme/old"}]
                }
                """.getBytes(StandardCharsets.UTF_8);
        service.processWebhookPayload(repoChange, "installation_repositories");
        assertTrue(entity.getSelectedReposJson().contains("acme/new-repo"));
        assertFalse(entity.getSelectedReposJson().contains("acme/old"));

        byte[] suspend = "{\"action\":\"suspend\",\"installation\":{\"id\":555}}".getBytes(StandardCharsets.UTF_8);
        service.processWebhookPayload(suspend, "installation");
        assertNotNull(entity.getSuspendedAt());

        byte[] deleted = "{\"action\":\"deleted\",\"installation\":{\"id\":555}}".getBytes(StandardCharsets.UTF_8);
        service.processWebhookPayload(deleted, "installation");
        verify(installRepo).delete(entity);
    }
}
