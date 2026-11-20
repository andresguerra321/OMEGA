package com.omega.platform.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.omega.platform.domain.GitHubAppInstallationEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.client.RestClient;

class GitHubPullRequestScannerTest {

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
                                "evidence", "SECRET=" + unknownSecret
                        )
                )
        );

        String comment = GitHubPullRequestScannerService.buildPullRequestComment(scanResult);

        assertTrue(comment.startsWith(GitHubPullRequestScannerService.PR_COMMENT_MARKER));
        assertFalse(comment.contains(unknownSecret), "Nunca deben aparecer fragmentos de evidencia ni secretos desconocidos");
        assertFalse(comment.contains("SECRET="));
        assertFalse(comment.contains("@admin"), "Las @menciones deben quedar escapadas");
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
                    "location", "very/long/path/".repeat(12) + "package.json:" + (i + 1)
            ));
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

        assertThrows(SecurityException.class, () -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                URI.create("https://evil.attacker.test/tarball.tar.gz")));
        assertThrows(SecurityException.class, () -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                URI.create("http://api.github.com/repos/org/repo/tarball/abc")));
    }

    @Test
    void forkOpeningMultiplePrsHitsDailyRepoCapAndChargesOnlySuccessfulScans() {
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
        when(apiClient.listPullRequestFiles("ghs_install_tok", "acme/app", 1)).thenReturn(List.of("package.json"));
        when(apiClient.listPullRequestFiles("ghs_install_tok", "acme/app", 2)).thenReturn(List.of("package.json"));
        when(apiClient.listPullRequestFiles("ghs_install_tok", "acme/app", 3)).thenReturn(List.of("package.json"));
        when(apiTokenService.hasAvailableMonthlyQuota(tenantId)).thenReturn(true);
        when(apiClient.downloadTarballBounded(eq("ghs_install_tok"), eq("acme/app"), anyString(), anyInt()))
                .thenReturn(new byte[] {1, 2, 3});

        // Tope diario por repo = 2
        GitHubPullRequestScannerService scanner = new GitHubPullRequestScannerService(
                installRepo, apiClient, workerProvider, tokenProvider, false, 2) {
            @Override
            protected Map<String, Object> sendTarballToWorker(String tid, byte[] tarballBytes) {
                return Map.of("score", 0, "findings", List.of());
            }
        };

        scanner.executePullRequestScan(42L, "acme/app", 1, "sha1", "NONE");
        scanner.executePullRequestScan(42L, "acme/app", 2, "sha2", "NONE");
        scanner.executePullRequestScan(42L, "acme/app", 3, "sha3", "NONE");

        // Solo 2 escaneos descontaron cuota mensual del tenant; ninguno tocó consumeScanQuotaAndTokenUse(..., tokenId)
        verify(apiTokenService, times(2)).consumeTenantMonthlyScanQuota(tenantId);
        verify(apiTokenService, never()).consumeScanQuotaAndTokenUse(any(), any());

        ArgumentCaptor<String> commentCaptor = ArgumentCaptor.forClass(String.class);
        verify(apiClient).upsertPullRequestComment(
                eq("ghs_install_tok"), eq("acme/app"), eq(3), eq(GitHubPullRequestScannerService.PR_COMMENT_MARKER), commentCaptor.capture());
        assertTrue(commentCaptor.getValue().contains("Cuota de escaneos OMEGA alcanzada"));
    }

    @Test
    void failedWorkerScanDoesNotChargeTenantQuota() {
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
        when(apiTokenService.hasAvailableMonthlyQuota(tenantId)).thenReturn(true);
        when(apiClient.downloadTarballBounded(anyString(), anyString(), anyString(), anyInt()))
                .thenReturn(new byte[] {1, 2, 3});

        GitHubPullRequestScannerService failingScanner = new GitHubPullRequestScannerService(
                installRepo, apiClient, workerProvider, tokenProvider, false, 10) {
            @Override
            protected Map<String, Object> sendTarballToWorker(String tid, byte[] tarballBytes) {
                throw new IllegalStateException("worker timeout");
            }
        };

        failingScanner.executePullRequestScan(42L, "acme/app", 9, "sha9", "MEMBER");
        verify(apiTokenService, never()).consumeTenantMonthlyScanQuota(any());
    }
}
