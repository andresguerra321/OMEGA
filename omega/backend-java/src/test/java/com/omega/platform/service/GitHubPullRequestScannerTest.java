package com.omega.platform.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.omega.platform.domain.GitHubAppInstallationEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import java.net.URI;
import java.time.Instant;
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
    void commentRedactsSecretsAndEscapesHostileMarkdownFromForks() {
        String secretToken = "omega_scan_leaked_secret_123456";
        String ghpSecret = "ghp_superSecretGitHubToken987654";
        Map<String, Object> scanResult = Map.of(
                "score", 85,
                "findings", List.of(
                        Map.of(
                                "severity", "CRITICAL",
                                "rule_id", "SECRET-EXFIL-01",
                                "location", "fork/[evil](https://phishing.test)/package.json",
                                "evidence", "curl -H \"Authorization: Bearer " + secretToken + "\" " + ghpSecret
                        )
                )
        );

        String comment = GitHubPullRequestScannerService.buildPullRequestComment(scanResult);

        assertTrue(comment.startsWith(GitHubPullRequestScannerService.PR_COMMENT_MARKER));
        assertFalse(comment.contains(secretToken), "Nunca debe aparecer el token OMEGA en el comentario");
        assertFalse(comment.contains(ghpSecret), "Nunca debe aparecer el token GitHub en el comentario");
        assertTrue(comment.contains("[REDACTED_SECRET]"));
        // Markdown injection from fork filename is escaped
        assertFalse(comment.contains("[evil](https://phishing.test)"));
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
    void skipsPrWithoutManifestsAndScansManifestPrWithQuotaAndSingleCommentUpsert() {
        assertFalse(GitHubPullRequestScannerService.shouldScanChangedFiles(List.of("README.md", "src/App.jsx")));
        assertTrue(GitHubPullRequestScannerService.shouldScanChangedFiles(List.of("src/App.jsx", "package.json")));
        assertTrue(GitHubPullRequestScannerService.shouldScanChangedFiles(List.of(".github/workflows/ci.yml")));

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
        when(apiClient.listPullRequestFiles("ghs_install_tok", "acme/app", 7)).thenReturn(List.of("package.json"));
        when(apiClient.downloadTarballBounded("ghs_install_tok", "acme/app", "sha123", GitHubPullRequestScannerService.MAX_TARBALL_BYTES))
                .thenReturn(new byte[] {1, 2, 3});

        GitHubPullRequestScannerService scanner = new GitHubPullRequestScannerService(
                installRepo, apiClient, workerProvider, tokenProvider) {
            @Override
            protected Map<String, Object> sendTarballToWorker(String tid, byte[] tarballBytes) {
                assertEquals(tenantId.toString(), tid);
                return Map.of("score", 0, "findings", List.of());
            }
        };
        scanner.executePullRequestScan(42L, "acme/app", 7, "sha123");

        verify(apiTokenService).consumeScanQuotaAndTokenUse(tenantId, null);
        ArgumentCaptor<String> commentCaptor = ArgumentCaptor.forClass(String.class);
        verify(apiClient).upsertPullRequestComment(
                eq("ghs_install_tok"), eq("acme/app"), eq(7), eq(GitHubPullRequestScannerService.PR_COMMENT_MARKER), commentCaptor.capture());
        assertTrue(commentCaptor.getValue().contains("Sin señales detectadas con las reglas actuales"));
    }
}
