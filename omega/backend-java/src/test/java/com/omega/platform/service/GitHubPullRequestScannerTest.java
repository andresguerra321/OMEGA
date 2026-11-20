package com.omega.platform.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.omega.platform.domain.GitHubAppInstallationEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import com.omega.platform.repository.GitHubRepoDailyUsageRepository;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.client.RestClient;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class GitHubPullRequestScannerTest {
    @Test
    void sendsTarballToWorkerAsMultipartWithoutReactiveDependencies() {
        var builder = RestClient.builder().baseUrl("http://worker:8000");
        var server = MockRestServiceServer.bindTo(builder).build();
        ObjectProvider<RestClient> workerProvider = mock(ObjectProvider.class);
        when(workerProvider.getIfAvailable()).thenReturn(builder.build());
        ObjectProvider<ApiTokenService> tokenProvider = mock(ObjectProvider.class);
        var scanner = new GitHubPullRequestScannerService(
                mock(GitHubAppInstallationRepository.class), mock(GitHubApiClient.class),
                workerProvider, tokenProvider, null, true, 10);
        server.expect(requestTo("http://worker:8000/api/repo/scan"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Tenant-Id", "tenant"))
                .andExpect(request -> {
                    assertTrue(request.getHeaders().getContentType().isCompatibleWith(MediaType.MULTIPART_FORM_DATA));
                    String body = ((MockClientHttpRequest) request).getBodyAsString();
                    assertTrue(body.contains("filename=\"pr.tar.gz\""));
                    assertTrue(body.contains("tarball-test"));
                })
                .andRespond(withSuccess(
                        "{\"score\":0,\"findings\":[]}", MediaType.APPLICATION_JSON));
        assertEquals(0, scanner.sendTarballToWorker("tenant", "tarball-test".getBytes(StandardCharsets.UTF_8)).get("score"));
        server.verify();
    }


        @Test
        void commentUsesStrictAllowlistNeverIncludesEvidenceOrUnknownSecretsAndEscapesHostileInput() {
                String unknownSecret = "proprietary_vault_secret_ABC_998877";
                String hostileLoc = "fork/@admin/![img](https://evil.test/x.png)<!--hijack-->/package.json:42";
                Map<String, Object> scanResult = Map.of(
                                "score", 85,
                                "findings", List.of(
                                                Map.of(
                                                                "severity", "CRITICAL",
                                                                "rule_id", "SECRET-EXFIL-01",
                                                                "location", hostileLoc,
                                                                "evidence", "SECRET=" + unknownSecret)));

                String comment = GitHubPullRequestScannerService.buildPullRequestComment(scanResult);

        assertTrue(comment.startsWith(GitHubPullRequestScannerService.PR_COMMENT_MARKER));
        assertFalse(comment.contains(unknownSecret), "Nunca deben aparecer fragmentos de evidencia ni secretos desconocidos");
        assertFalse(comment.contains("SECRET="));
        assertFalse(comment.contains("@admin"), "Las @menciones deben quedar neutralizadas");
        assertFalse(comment.contains("![img](https://evil.test/x.png)"), "Imágenes/enlaces remotos deben quedar escapados");
        assertFalse(comment.contains("<!--hijack-->"), "Comentarios HTML inyectados deben eliminarse");
        assertTrue(comment.contains("| CRITICAL | `SECRET\\-EXFIL\\-01` |"));
        assertTrue(comment.contains("| 42 |"));
        assertTrue(comment.length() <= 65_536);
    }

        @Test
        void commentRespectsGitHubMaxLengthLimit() {
                List<Map<String, Object>> manyFindings = new ArrayList<>();
                for (int i = 0; i < 100; i++) {
                        manyFindings.add(Map.of(
                                        "severity", "HIGH",
                                        "rule_id", "RULE-" + i,
                                        "location", "very/long/path/".repeat(12) + "package.json:" + (i + 1)));
                }
                String comment = GitHubPullRequestScannerService.buildPullRequestComment(
                                Map.of("score", 90, "findings", manyFindings));
                assertTrue(comment.length() < 65_536);
        }

        @Test
        void tarballHostWhitelistAllowsOnlyGitHubAndRejectsArbitraryHosts() {
                assertDoesNotThrow(() -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                                URI.create("https://api.github.com/repos/org/repo/tarball/abc")));
                assertDoesNotThrow(() -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                                URI.create("https://codeload.github.com/org/repo/legacy.tar.gz/abc")));

                assertThrows(SecurityException.class,
                                () -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                                                URI.create("https://evil.attacker.test/tarball.tar.gz")));
                assertThrows(SecurityException.class,
                                () -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                                                URI.create("http://api.github.com/repos/org/repo/tarball/abc")));
        }

    @Test
    void forkOpeningMultiplePrsHitsDailyRepoCapAndAtomicConcurrencyNeverOvershoots() throws Exception {
        GitHubAppInstallationRepository installRepo = mock(GitHubAppInstallationRepository.class);
        GitHubApiClient apiClient = mock(GitHubApiClient.class);
        ApiTokenService apiTokenService = mock(ApiTokenService.class);
        ObjectProvider<RestClient> workerProvider = mock(ObjectProvider.class);
        ObjectProvider<ApiTokenService> tokenProvider = mock(ObjectProvider.class);
        when(tokenProvider.getIfAvailable()).thenReturn(apiTokenService);

        UUID tenantId = UUID.randomUUID();
        when(installRepo.findByInstallationId(42L)).thenReturn(Optional.of(
                new GitHubAppInstallationEntity(UUID.randomUUID(), tenantId, 42L, "acme", "[\"acme/app\"]", UUID.randomUUID(), Instant.now())));
        when(apiClient.createInstallationAccessToken(42L)).thenReturn("ghs_install_tok");
        when(apiClient.listPullRequestFiles(eq("ghs_install_tok"), eq("acme/app"), anyInt())).thenReturn(List.of("package.json"));
        when(apiTokenService.tryReserveMonthlyScanQuota(tenantId)).thenReturn(true);
        when(apiClient.downloadTarballBounded(eq("ghs_install_tok"), eq("acme/app"), anyString(), anyInt()))
                .thenReturn(new byte[] {1, 2, 3});

        AtomicInteger workerExecutions = new AtomicInteger(0);
        GitHubPullRequestScannerService scanner = new GitHubPullRequestScannerService(
                installRepo, apiClient, workerProvider, tokenProvider, null, false, 2) {
            @Override
            protected Map<String, Object> sendTarballToWorker(String tid, byte[] tarballBytes) {
                workerExecutions.incrementAndGet();
                return Map.of("score", 0, "findings", List.of());
            }
        };

        // Simular 6 PRs concurrentes de un fork contra tope diario = 2
        ExecutorService pool = Executors.newFixedThreadPool(6);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(6);
        for (int i = 1; i <= 6; i++) {
            final int prNum = i;
            pool.submit(() -> {
                try {
                    start.await();
                    scanner.executePullRequestScan(42L, "acme/app", prNum, "sha" + prNum, "NONE");
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            });
        }
        start.countDown();
        done.await();
        pool.shutdownNow();

        assertEquals(2, workerExecutions.get(), "El tope diario atómico nunca debe sobrepasarse bajo concurrencia");
        verify(apiTokenService, times(2)).tryReserveMonthlyScanQuota(tenantId);
        verify(apiTokenService, never()).consumeScanQuotaAndTokenUse(any(), any());
    }

    @Test
    void failedWorkerScanReleasesReservedQuotaAndCollaboratorsOnlyBlocksExternalPrs() {
        GitHubAppInstallationRepository installRepo = mock(GitHubAppInstallationRepository.class);
        GitHubApiClient apiClient = mock(GitHubApiClient.class);
        ApiTokenService apiTokenService = mock(ApiTokenService.class);
        ObjectProvider<RestClient> workerProvider = mock(ObjectProvider.class);
        ObjectProvider<ApiTokenService> tokenProvider = mock(ObjectProvider.class);
        when(tokenProvider.getIfAvailable()).thenReturn(apiTokenService);

        UUID tenantId = UUID.randomUUID();
        when(installRepo.findByInstallationId(42L)).thenReturn(Optional.of(
                new GitHubAppInstallationEntity(UUID.randomUUID(), tenantId, 42L, "acme", "[\"acme/app\"]", UUID.randomUUID(), Instant.now())));
        when(apiClient.createInstallationAccessToken(42L)).thenReturn("ghs_install_tok");
        when(apiClient.listPullRequestFiles("ghs_install_tok", "acme/app", 9)).thenReturn(List.of("package.json"));
        when(apiTokenService.tryReserveMonthlyScanQuota(tenantId)).thenReturn(true);
        when(apiClient.downloadTarballBounded(anyString(), anyString(), anyString(), anyInt()))
                .thenReturn(new byte[] {1, 2, 3});

        // collaboratorsOnly = true (default seguro): bloquea PR externo (NONE) sin descargar tarball
        GitHubPullRequestScannerService defaultScanner = new GitHubPullRequestScannerService(
                installRepo, apiClient, workerProvider, tokenProvider, null, true, 10) {
            @Override
            protected Map<String, Object> sendTarballToWorker(String tid, byte[] tarballBytes) {
                throw new IllegalStateException("worker timeout");
            }
        };
        defaultScanner.executePullRequestScan(42L, "acme/app", 9, "sha9", "NONE");
        verify(apiClient, never()).downloadTarballBounded(anyString(), anyString(), anyString(), anyInt());

        // PR de colaborador (MEMBER) que falla en el worker -> libera la cuota reservada
        defaultScanner.executePullRequestScan(42L, "acme/app", 9, "sha9", "MEMBER");
        verify(apiTokenService).tryReserveMonthlyScanQuota(tenantId);
        verify(apiTokenService).releaseMonthlyScanQuota(tenantId);
    }
}
