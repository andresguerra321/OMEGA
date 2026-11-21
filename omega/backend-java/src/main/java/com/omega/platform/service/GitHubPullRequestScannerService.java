package com.omega.platform.service;

import com.omega.platform.domain.GitHubAppInstallationEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import com.omega.platform.repository.GitHubRepoDailyUsageRepository;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * Orquesta el análisis estático de Pull Requests (incluidos forks en solo lectura)
 * y publica/actualiza un único comentario saneado por PR.
 * <p>Nota: los semáforos de concurrencia y topes diarios por repositorio operan por instancia.</p>
 */
@Service
public class GitHubPullRequestScannerService {

    private static final Logger log = LoggerFactory.getLogger(GitHubPullRequestScannerService.class);
    public static final String PR_COMMENT_MARKER = "<!-- omega-scan-pr -->";
    public static final int MAX_TARBALL_BYTES = 52_428_800; // 50 MiB
    public static final int MAX_PR_COMMENT_LENGTH = 60_000; // Margen bajo el límite de 65,536 de GitHub
    public static final int MAX_SCANS_PER_REPO_PER_DAY = 20;
    private static final int MAX_CONCURRENT_SCANS_PER_INSTALL = 2;

    private static final Set<String> COLLABORATOR_ASSOCIATIONS = Set.of("OWNER", "MEMBER", "COLLABORATOR");

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
    private final GitHubRepoDailyUsageRepository dailyUsageRepository;
    private final boolean collaboratorsOnly;
    private final int maxScansPerRepoPerDay;
    private final ConcurrentHashMap<String, Future<?>> activePrScans = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, Semaphore> installSemaphores = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AtomicInteger> fallbackDailyCounters = new ConcurrentHashMap<>();

    public GitHubPullRequestScannerService(
            GitHubAppInstallationRepository installationRepository,
            GitHubApiClient gitHubApiClient,
            @Qualifier("forensicWorkerRestClient") ObjectProvider<RestClient> forensicWorkerRestClientProvider,
            ObjectProvider<ApiTokenService> apiTokenServiceProvider,
            ObjectProvider<GitHubRepoDailyUsageRepository> dailyUsageRepoProvider,
            @Value("${omega.github.collaborators-only:true}") boolean collaboratorsOnly,
            @Value("${omega.github.max-scans-per-repo-per-day:" + MAX_SCANS_PER_REPO_PER_DAY + "}") int maxScansPerRepoPerDay
    ) {
        this.installationRepository = installationRepository;
        this.gitHubApiClient = gitHubApiClient;
        this.forensicWorkerRestClient = forensicWorkerRestClientProvider.getIfAvailable();
        this.apiTokenService = apiTokenServiceProvider.getIfAvailable();
        this.dailyUsageRepository = dailyUsageRepoProvider != null ? dailyUsageRepoProvider.getIfAvailable() : null;
        this.collaboratorsOnly = collaboratorsOnly;
        this.maxScansPerRepoPerDay = Math.max(1, maxScansPerRepoPerDay);
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
        String authorAssoc = prMap.get("author_association") instanceof String assoc ? assoc : "";
        if (repoFullName.isBlank() || prNumber <= 0 || headSha.isBlank()) {
            return CompletableFuture.completedFuture(null);
        }

        String prKey = installationId + ":" + repoFullName + "#" + prNumber;
        Future<?> previous = activePrScans.get(prKey);
        if (previous != null && !previous.isDone()) {
            previous.cancel(true);
        }

        CompletableFuture<Void> future = CompletableFuture.runAsync(
                () -> executePullRequestScan(installationId, repoFullName, prNumber, headSha, authorAssoc)
        );
        activePrScans.put(prKey, future);
        return future;
    }

    public void executePullRequestScan(
            long installationId,
            String repoFullName,
            int prNumber,
            String headSha,
            String authorAssociation
    ) {
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

        boolean reservedDaily = false;
        boolean reservedMonthly = false;
        boolean scanCompleted = false;
        try {
            if (Thread.currentThread().isInterrupted()) {
                return;
            }
            String installationToken = gitHubApiClient.createInstallationAccessToken(installationId);

            if (collaboratorsOnly && !COLLABORATOR_ASSOCIATIONS.contains(String.valueOf(authorAssociation).toUpperCase())) {
                gitHubApiClient.upsertPullRequestComment(
                        installationToken,
                        repoFullName,
                        prNumber,
                        PR_COMMENT_MARKER,
                        buildNoticeComment("Escaneo automático omitido: requiere aprobación de un colaborador del repositorio.")
                );
                return;
            }

            List<String> changedFiles = gitHubApiClient.listPullRequestFiles(installationToken, repoFullName, prNumber);
            if (!shouldScanChangedFiles(changedFiles)) {
                return;
            }

            reservedDaily = tryAcquireDailyRepoSlot(repoFullName);
            if (!reservedDaily) {
                gitHubApiClient.upsertPullRequestComment(
                        installationToken,
                        repoFullName,
                        prNumber,
                        PR_COMMENT_MARKER,
                        buildNoticeComment("Cuota diaria de escaneos OMEGA alcanzada para este repositorio; análisis omitido sin bloquear el PR.")
                );
                return;
            }

            if (apiTokenService != null) {
                reservedMonthly = apiTokenService.tryReserveMonthlyScanQuota(install.getTenantId());
                if (!reservedMonthly) {
                    gitHubApiClient.upsertPullRequestComment(
                            installationToken,
                            repoFullName,
                            prNumber,
                            PR_COMMENT_MARKER,
                            buildNoticeComment("Cuota mensual de escaneos OMEGA alcanzada para el plan del tenant; análisis omitido sin bloquear el PR.")
                    );
                    return;
                }
            }

            if (Thread.currentThread().isInterrupted()) {
                return;
            }
            byte[] tarball = gitHubApiClient.downloadTarballBounded(
                    installationToken, repoFullName, headSha, MAX_TARBALL_BYTES);
            if (Thread.currentThread().isInterrupted()) {
                return;
            }

            Map<String, Object> scanResult = sendTarballToWorker(install.getTenantId().toString(), tarball);
            if (Thread.currentThread().isInterrupted()) {
                return;
            }

            scanCompleted = true;
            String commentBody = buildPullRequestComment(scanResult);
            gitHubApiClient.upsertPullRequestComment(
                    installationToken, repoFullName, prNumber, PR_COMMENT_MARKER, commentBody);
        } catch (Exception ex) {
            log.warn("Fallo en escaneo de PR {}#{}: {}", repoFullName, prNumber, ex.getClass().getSimpleName());
        } finally {
            if (!scanCompleted) {
                if (reservedMonthly && apiTokenService != null) {
                    apiTokenService.releaseMonthlyScanQuota(install.getTenantId());
                }
                if (reservedDaily) {
                    releaseDailyRepoSlot(repoFullName);
                }
            }
            sem.release();
        }
    }

    private boolean tryAcquireDailyRepoSlot(String repoFullName) {
        if (dailyUsageRepository != null) {
            return dailyUsageRepository.tryReserveDailySlot(repoFullName, maxScansPerRepoPerDay);
        }
        String key = LocalDate.now(ZoneOffset.UTC) + ":" + repoFullName.toLowerCase();
        AtomicInteger counter = fallbackDailyCounters.computeIfAbsent(key, ignored -> new AtomicInteger(0));
        while (true) {
            int current = counter.get();
            if (current >= maxScansPerRepoPerDay) {
                return false;
            }
            if (counter.compareAndSet(current, current + 1)) {
                return true;
            }
        }
    }

    private void releaseDailyRepoSlot(String repoFullName) {
        if (dailyUsageRepository != null) {
            dailyUsageRepository.releaseDailySlot(repoFullName);
            return;
        }
        String key = LocalDate.now(ZoneOffset.UTC) + ":" + repoFullName.toLowerCase();
        AtomicInteger counter = fallbackDailyCounters.get(key);
        if (counter != null) {
            counter.updateAndGet(v -> Math.max(0, v - 1));
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
        String noHtmlComments = noCtrl.replace("<!--", " ").replace("-->", " ").replace("@", "(at)");
        String marker = "OMEGAREDACTMARKER";
        String redacted = SECRET_VALUE_PATTERN.matcher(noHtmlComments).replaceAll(marker);
        String escaped = MARKDOWN_UNSAFE_PATTERN.matcher(redacted).replaceAll("\\\\$1");
        String restored = escaped.replace(marker, "[REDACTED_SECRET]");
        if (restored.length() > maxLen) {
            return restored.substring(0, maxLen - 3) + "...";
        }
        return restored;
    }

    private static String[] splitFileAndLine(String rawLocation) {
        String loc = rawLocation != null ? rawLocation.trim() : "repository-root";
        String line = "-";
        int colon = loc.lastIndexOf(':');
        if (colon > 0 && colon < loc.length() - 1) {
            String suffix = loc.substring(colon + 1);
            if (suffix.chars().allMatch(Character::isDigit)) {
                line = suffix;
                loc = loc.substring(0, colon);
            }
        }
        return new String[] {redactAndSanitizeUntrusted(loc, 180), line};
    }

    public static String buildNoticeComment(String noticeText) {
        return PR_COMMENT_MARKER
                + "\n### OMEGA Repo Scanner (Solo lectura)\n- "
                + redactAndSanitizeUntrusted(noticeText, 400)
                + "\n";
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

        // Lista permitida estricta: solo regla, severidad, archivo y línea (NUNCA fragmentos de evidencia)
        StringBuilder sb = new StringBuilder();
        sb.append(PR_COMMENT_MARKER).append("\n");
        sb.append("### OMEGA Repo Scanner (Solo lectura)\n");
        sb.append("- **Puntaje compuesto:** `").append(score).append("/100`\n");
        if (scanResult.get("policy_evaluation") instanceof Map<?, ?> policyEval) {
            Object rawPolStatus = policyEval.get("status") != null ? policyEval.get("status") : "PASS";
            Object rawPolThreshold = policyEval.get("fail_on_severity") != null ? policyEval.get("fail_on_severity") : "HIGH";
            String polStatus = redactAndSanitizeUntrusted(String.valueOf(rawPolStatus), 20);
            String polThreshold = redactAndSanitizeUntrusted(String.valueOf(rawPolThreshold), 20);
            sb.append("- **Política del tenant:** `").append(polStatus).append("` (umbral `").append(polThreshold).append("`)\n");
        }
        if (findings.isEmpty()) {
            sb.append("- **Estado:** Sin señales detectadas con las reglas actuales.\n");
        } else {
            sb.append("- **Señales detectadas:** ").append(findings.size()).append("\n\n");
            sb.append("| Severidad | Regla | Archivo | Línea |\n");
            sb.append("|---|---|---|---|\n");
            for (int i = 0; i < Math.min(findings.size(), 100); i++) {
                Map<String, Object> f = findings.get(i);
                String sev = redactAndSanitizeUntrusted(String.valueOf(f.getOrDefault("severity", "MEDIUM")), 20);
                String rule = redactAndSanitizeUntrusted(String.valueOf(f.getOrDefault("rule_id", "OMEGA-RULE")), 80);
                String[] fileAndLine = splitFileAndLine(String.valueOf(f.getOrDefault("location", "repository-root")));
                String row = "| " + sev + " | `" + rule + "` | `" + fileAndLine[0] + "` | " + fileAndLine[1] + " |\n";
                if (sb.length() + row.length() + 260 > MAX_PR_COMMENT_LENGTH) {
                    sb.append("\n_Lista truncada para respetar el límite de longitud de comentarios de GitHub._\n");
                    break;
                }
                sb.append(row);
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
        var body = new LinkedMultiValueMap<String, Object>();
        HttpHeaders partHeaders = new HttpHeaders();
        partHeaders.setContentDisposition(ContentDisposition.formData().name("file").filename("pr.tar.gz").build());
        partHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        body.add("file", new HttpEntity<>(new ByteArrayResource(tarballBytes) {
            @Override
            public String getFilename() {
                return "pr.tar.gz";
            }
        }, partHeaders));

        return forensicWorkerRestClient.post()
                .uri("/api/repo/scan")
                .header("X-Tenant-Id", tenantId)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(body)
                .retrieve()
                .body(Map.class);
    }
}
