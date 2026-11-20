package com.omega.platform.service;

import com.omega.platform.domain.GitHubAppInstallationEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Orquesta el análisis estático de Pull Requests (incluidos forks en solo lectura)
 * y publica/actualiza un único comentario saneado por PR.
 */
@Service
public class GitHubPullRequestScannerService {

    private static final Logger log = LoggerFactory.getLogger(GitHubPullRequestScannerService.class);
    public static final String PR_COMMENT_MARKER = "<!-- omega-scan-pr -->";
    public static final int MAX_TARBALL_BYTES = 52_428_800; // 50 MiB
    private static final int MAX_CONCURRENT_SCANS_PER_INSTALL = 2;

    private static final Set<String> MANIFEST_FILENAMES = Set.of(
            "package.json",
            "package-lock.json",
            "yarn.lock",
            "pnpm-lock.yaml",
            "setup.py",
            "pyproject.toml",
            "pom.xml",
            "cargo.toml",
            "cargo.lock",
            "build.gradle",
            "build.gradle.kts"
    );

    private static final Pattern SECRET_VALUE_PATTERN = Pattern.compile(
            "(omega_scan_[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{16}|Bearer\\s+[A-Za-z0-9._-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern MARKDOWN_UNSAFE_PATTERN = Pattern.compile("([\\\\`*{}\\[\\]()#+\\-.!|<>])");

    private final GitHubAppInstallationRepository installationRepository;
    private final GitHubApiClient gitHubApiClient;
    private final RestClient forensicWorkerRestClient;
    private final ApiTokenService apiTokenService;
    private final ConcurrentHashMap<String, Future<?>> activePrScans = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, Semaphore> installSemaphores = new ConcurrentHashMap<>();

    public GitHubPullRequestScannerService(
            GitHubAppInstallationRepository installationRepository,
            GitHubApiClient gitHubApiClient,
            @Qualifier("forensicWorkerRestClient") ObjectProvider<RestClient> forensicWorkerRestClientProvider,
            ObjectProvider<ApiTokenService> apiTokenServiceProvider
    ) {
        this.installationRepository = installationRepository;
        this.gitHubApiClient = gitHubApiClient;
        this.forensicWorkerRestClient = forensicWorkerRestClientProvider.getIfAvailable();
        this.apiTokenService = apiTokenServiceProvider.getIfAvailable();
    }

    public Future<?> submitPullRequestWebhook(long installationId, Map<String, Object> payload) {
        String action = String.valueOf(payload.getOrDefault("action", ""));
        if (!Set.of("opened", "synchronize", "reopened").contains(action)) {
            return CompletableFuture.completedFuture(null);
        }
        if (!(payload.get("pull_request") instanceof Map<?, ?> prMap)
                || !(payload.get("repository") instanceof Map<?, ?> repoMap)) {
            return CompletableFuture.completedFuture(null);
        }
        String repoFullName = String.valueOf(repoMap.get("full_name"));
        int prNumber = prMap.get("number") instanceof Number n ? n.intValue() : 0;
        String headSha = prMap.get("head") instanceof Map<?, ?> headMap
                ? String.valueOf(headMap.get("sha"))
                : "";
        if (repoFullName.isBlank() || prNumber <= 0 || headSha.isBlank()) {
            return CompletableFuture.completedFuture(null);
        }

        String prKey = installationId + ":" + repoFullName + "#" + prNumber;
        Future<?> previous = activePrScans.get(prKey);
        if (previous != null && !previous.isDone()) {
            previous.cancel(true);
        }

        CompletableFuture<Void> future = CompletableFuture.runAsync(
                () -> executePullRequestScan(installationId, repoFullName, prNumber, headSha)
        );
        activePrScans.put(prKey, future);
        return future;
    }

    public void executePullRequestScan(long installationId, String repoFullName, int prNumber, String headSha) {
        Optional<GitHubAppInstallationEntity> installOpt = installationRepository.findByInstallationId(installationId);
        if (installOpt.isEmpty() || installOpt.get().getSuspendedAt() != null) {
            return;
        }
        GitHubAppInstallationEntity install = installOpt.get();
        Semaphore sem = installSemaphores.computeIfAbsent(
                installationId,
                ignored -> new Semaphore(MAX_CONCURRENT_SCANS_PER_INSTALL)
        );
        if (!sem.tryAcquire()) {
            log.warn("Límite de concurrencia alcanzado para instalación {}", installationId);
            return;
        }

        try {
            String installationToken = gitHubApiClient.createInstallationAccessToken(installationId);
            List<String> changedFiles = gitHubApiClient.listPullRequestFiles(installationToken, repoFullName, prNumber);
            if (!shouldScanChangedFiles(changedFiles)) {
                return;
            }

            if (apiTokenService != null) {
                apiTokenService.consumeScanQuotaAndTokenUse(install.getTenantId(), null);
            }

            byte[] tarball = gitHubApiClient.downloadTarballBounded(
                    installationToken, repoFullName, headSha, MAX_TARBALL_BYTES);
            Map<String, Object> scanResult = sendTarballToWorker(install.getTenantId().toString(), tarball);
            String commentBody = buildPullRequestComment(scanResult);
            gitHubApiClient.upsertPullRequestComment(
                    installationToken, repoFullName, prNumber, PR_COMMENT_MARKER, commentBody);
        } catch (Exception ex) {
            log.warn("Fallo en escaneo de PR {}#{}: {}", repoFullName, prNumber, ex.getClass().getSimpleName());
        } finally {
            sem.release();
        }
    }

    public static boolean shouldScanChangedFiles(List<String> changedFiles) {
        if (changedFiles == null || changedFiles.isEmpty()) {
            return false;
        }
        for (String rawPath : changedFiles) {
            if (rawPath == null) {
                continue;
            }
            String lower = rawPath.trim().toLowerCase().replace("\\", "/");
            String name = lower.contains("/") ? lower.substring(lower.lastIndexOf('/') + 1) : lower;
            if (MANIFEST_FILENAMES.contains(name)) {
                return true;
            }
            if (name.startsWith("requirements") && name.endsWith(".txt")) {
                return true;
            }
            if (lower.startsWith(".github/workflows/") && (lower.endsWith(".yml") || lower.endsWith(".yaml"))) {
                return true;
            }
        }
        return false;
    }

    public static String redactAndSanitizeUntrusted(String raw, int maxLen) {
        if (raw == null) {
            return "";
        }
        String noCtrl = raw.replaceAll("[\\x00-\\x1f\\x7f]", " ").trim();
        String marker = "OMEGAREDACTMARKER";
        String redacted = SECRET_VALUE_PATTERN.matcher(noCtrl).replaceAll(marker);
        String escaped = MARKDOWN_UNSAFE_PATTERN.matcher(redacted).replaceAll("\\\\$1");
        String restored = escaped.replace(marker, "[REDACTED_SECRET]");
        if (restored.length() > maxLen) {
            return restored.substring(0, maxLen - 3) + "...";
        }
        return restored;
    }

    @SuppressWarnings("unchecked")
    public static String buildPullRequestComment(Map<String, Object> scanResult) {
        int score = scanResult.get("score") instanceof Number n ? n.intValue() : 0;
        List<Map<String, Object>> findings = scanResult.get("findings") instanceof List<?> list
                ? (List<Map<String, Object>>) list
                : List.of();
        String notice = redactAndSanitizeUntrusted(
                String.valueOf(scanResult.getOrDefault(
                        "zero_retention_notice",
                        "Análisis estático en RAM/tmpfs; contenido purgado al finalizar.")),
                200
        );

        StringBuilder sb = new StringBuilder();
        sb.append(PR_COMMENT_MARKER).append("\n");
        sb.append("### OMEGA Repo Scanner (Solo lectura)\n");
        sb.append("- **Puntaje compuesto:** `").append(score).append("/100`\n");
        if (findings.isEmpty()) {
            sb.append("- **Estado:** Sin señales detectadas con las reglas actuales.\n");
        } else {
            sb.append("- **Señales detectadas:** ").append(findings.size()).append("\n\n");
            sb.append("| Severidad | Regla | Ubicación | Evidencia |\n");
            sb.append("|---|---|---|---|\n");
            for (int i = 0; i < Math.min(findings.size(), 25); i++) {
                Map<String, Object> f = findings.get(i);
                String sev = redactAndSanitizeUntrusted(String.valueOf(f.getOrDefault("severity", "MEDIUM")), 20);
                String rule = redactAndSanitizeUntrusted(String.valueOf(f.getOrDefault("rule_id", "OMEGA-RULE")), 80);
                String loc = redactAndSanitizeUntrusted(String.valueOf(f.getOrDefault("location", "repository-root")), 180);
                String evid = redactAndSanitizeUntrusted(String.valueOf(f.getOrDefault("evidence", "")), 200);
                sb.append("| ").append(sev).append(" | `").append(rule).append("` | `")
                        .append(loc).append("` | `").append(evid).append("` |\n");
            }
        }
        sb.append("\n_").append(notice).append("_\n");
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    protected Map<String, Object> sendTarballToWorker(String tenantId, byte[] tarballBytes) {
        if (forensicWorkerRestClient == null) {
            throw new IllegalStateException("forensicWorkerRestClient no disponible");
        }
        MultipartBodyBuilder bodyBuilder = new MultipartBodyBuilder();
        HttpHeaders partHeaders = new HttpHeaders();
        partHeaders.setContentDisposition(ContentDisposition.formData().name("file").filename("pr.tar.gz").build());
        partHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        bodyBuilder.part("file", new HttpEntity<>(new ByteArrayResource(tarballBytes) {
            @Override
            public String getFilename() {
                return "pr.tar.gz";
            }
        }, partHeaders));

        return forensicWorkerRestClient.post()
                .uri("/api/repo/scan")
                .header("X-Tenant-Id", tenantId)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(bodyBuilder.build())
                .retrieve()
                .body(Map.class);
    }
}
