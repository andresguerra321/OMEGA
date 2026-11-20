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
