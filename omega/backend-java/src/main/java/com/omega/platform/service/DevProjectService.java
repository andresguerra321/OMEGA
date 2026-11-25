package com.omega.platform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DevDependencyEntity;
import com.omega.platform.domain.DevFindingEntity;
import com.omega.platform.domain.DevProjectEntity;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.domain.DevSuppressionEntity;
import com.omega.platform.repository.DevDependencyRepository;
import com.omega.platform.repository.DevFindingRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DevScanRepository;
import com.omega.platform.repository.DevSuppressionRepository;
import com.omega.platform.security.OmegaPrincipal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Gestión multi-tenant de proyectos DEVELOPER, historial de escaneos, tendencia y comparación entre escaneos.
 * Zero-Retention: solo persiste metadatos derivados, nunca código fuente ni valores de secretos.
 */
@Service
public class DevProjectService {

    private static final Pattern NON_SLUG = Pattern.compile("[^a-z0-9]+");
    private static final Pattern SECRET_LIKE = Pattern.compile(
            "(?i)(gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|omega_scan_[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----)"
    );

    private final DevProjectRepository projectRepository;
    private final DevScanRepository scanRepository;
    private final DevFindingRepository findingRepository;
    private final DevDependencyRepository dependencyRepository;
    private final DevSuppressionRepository suppressionRepository;
    private final AuditLogService auditLogService;
    private final ObjectMapper objectMapper;
    private final DevPolicyService devPolicyService;

    public DevProjectService(
            DevProjectRepository projectRepository,
            DevScanRepository scanRepository,
            DevFindingRepository findingRepository,
            DevDependencyRepository dependencyRepository,
            DevSuppressionRepository suppressionRepository,
            AuditLogService auditLogService,
            ObjectMapper objectMapper,
            @org.springframework.beans.factory.annotation.Autowired(required = false) DevPolicyService devPolicyService
    ) {
        this.projectRepository = projectRepository;
        this.scanRepository = scanRepository;
        this.findingRepository = findingRepository;
        this.dependencyRepository = dependencyRepository;
        this.suppressionRepository = suppressionRepository;
        this.auditLogService = auditLogService;
        this.objectMapper = objectMapper;
        this.devPolicyService = devPolicyService;
    }

    @Transactional(readOnly = true)
    public List<ProjectSummaryDto> listProjects(OmegaPrincipal principal) {
        UUID tenantId = principal.tenantId();
        List<DevProjectEntity> projects = projectRepository.findAllByTenantIdOrderByUpdatedAtDesc(tenantId);
        List<ProjectSummaryDto> out = new ArrayList<>(projects.size());
        for (DevProjectEntity p : projects) {
            List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, p.getId());
            DevScanEntity latest = scans.isEmpty() ? null : scans.get(0);
            DevScanEntity previous = scans.size() > 1 ? scans.get(1) : null;
            Double scoreDelta = (latest != null && previous != null)
                    ? latest.getEffectiveScore() - previous.getEffectiveScore()
                    : null;
            out.add(new ProjectSummaryDto(
                    p.getId(),
                    p.getName(),
                    p.getSlug(),
                    p.getRepoUrl(),
                    p.getDefaultBranch(),
                    p.getSourceType(),
                    scans.size(),
                    latest != null ? latest.getEffectiveScore() : null,
                    latest != null ? latest.getScore() : null,
                    scoreDelta,
                    latest != null ? latest.getFindingsCount() : 0,
                    latest != null ? latest.getDependenciesCount() : 0,
                    latest != null ? latest.getPolicyStatus() : "PASS",
                    latest != null && latest.isHasActiveSuppressions(),
                    latest != null ? latest.getCreatedAt() : null,
                    p.getCreatedAt(),
                    p.getUpdatedAt()
            ));
        }
        return out;
    }

    @Transactional
    public ProjectSummaryDto createProject(
            OmegaPrincipal principal,
            String name,
            String repoUrl,
            String defaultBranch,
            String sourceType
    ) {
        String cleanName = sanitizeText(name, 160);
        if (cleanName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre del proyecto es obligatorio.");
        }
        String baseSlug = toSlug(cleanName);
        String slug = baseSlug;
        int suffix = 2;
        while (projectRepository.findByTenantIdAndSlug(principal.tenantId(), slug).isPresent()) {
            slug = baseSlug + "-" + suffix++;
        }
        String cleanUrl = sanitizeRepoUrl(repoUrl);
        String cleanBranch = sanitizeText(defaultBranch, 120);
        String cleanSource = normalizeSourceType(sourceType);

        DevProjectEntity saved = projectRepository.saveAndFlush(new DevProjectEntity(
                principal.tenantId(),
                principal.userId(),
                cleanName,
                slug,
                cleanUrl.isEmpty() ? null : cleanUrl,
                cleanBranch.isEmpty() ? null : cleanBranch,
                cleanSource
        ));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_PROJECT_CREATED",
                "DEV_PROJECT",
                saved.getId().toString(),
                Map.of("sourceType", saved.getSourceType(), "slugHash", sha256Hex(saved.getSlug()))
        );

        return new ProjectSummaryDto(
                saved.getId(), saved.getName(), saved.getSlug(), saved.getRepoUrl(), saved.getDefaultBranch(),
                saved.getSourceType(), 0, null, null, null, 0, 0, "PASS", false, null,
                saved.getCreatedAt(), saved.getUpdatedAt()
        );
    }

    @Transactional(readOnly = true)
    public ProjectDetailDto getProjectDetail(OmegaPrincipal principal, UUID projectId) {
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(
                principal.tenantId(), projectId);
        List<ScanSummaryDto> scanDtos = scans.stream().map(this::toScanSummary).toList();
        return new ProjectDetailDto(
                project.getId(),
                project.getName(),
                project.getSlug(),
                project.getRepoUrl(),
                project.getDefaultBranch(),
                project.getSourceType(),
                project.getCreatedAt(),
                project.getUpdatedAt(),
                scanDtos
        );
    }

    @Transactional(readOnly = true)
    public ScanComparisonDto compareScans(
            OmegaPrincipal principal,
            UUID projectId,
            UUID baseScanId,
            UUID headScanId
    ) {
        projectRepository.findByIdAndTenantId(projectId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        DevScanEntity base = scanRepository.findByIdAndTenantId(baseScanId, principal.tenantId())
                .filter(s -> s.getProjectId().equals(projectId))
                .orElseThrow(() -> new ResourceNotFoundException("Escaneo base no encontrado"));
        DevScanEntity head = scanRepository.findByIdAndTenantId(headScanId, principal.tenantId())
                .filter(s -> s.getProjectId().equals(projectId))
                .orElseThrow(() -> new ResourceNotFoundException("Escaneo objetivo no encontrado"));

        List<DevFindingEntity> baseFindings = findingRepository.findAllByTenantIdAndScanIdOrderByScorePointsDesc(
                principal.tenantId(), base.getId());
        List<DevFindingEntity> headFindings = findingRepository.findAllByTenantIdAndScanIdOrderByScorePointsDesc(
                principal.tenantId(), head.getId());

        Map<String, DevFindingEntity> baseByFp = new LinkedHashMap<>();
        for (DevFindingEntity f : baseFindings) baseByFp.putIfAbsent(f.getFingerprint(), f);
        Map<String, DevFindingEntity> headByFp = new LinkedHashMap<>();
        for (DevFindingEntity f : headFindings) headByFp.putIfAbsent(f.getFingerprint(), f);

        List<FindingDiffItem> added = new ArrayList<>();
        List<FindingDiffItem> unchanged = new ArrayList<>();
        for (Map.Entry<String, DevFindingEntity> e : headByFp.entrySet()) {
            FindingDiffItem item = toDiffItem(e.getValue());
            if (!baseByFp.containsKey(e.getKey())) {
                added.add(item);
            } else {
                unchanged.add(item);
            }
        }
        List<FindingDiffItem> resolved = new ArrayList<>();
        for (Map.Entry<String, DevFindingEntity> e : baseByFp.entrySet()) {
            if (!headByFp.containsKey(e.getKey())) {
                resolved.add(toDiffItem(e.getValue()));
            }
        }

        return new ScanComparisonDto(
                projectId,
                toScanSummary(base),
                toScanSummary(head),
                head.getEffectiveScore() - base.getEffectiveScore(),
                added,
                resolved,
                unchanged
        );
    }

    @Transactional
    public void deleteProject(OmegaPrincipal principal, UUID projectId) {
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        projectRepository.deleteByIdAndTenantId(project.getId(), principal.tenantId());
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_PROJECT_DELETED",
                "DEV_PROJECT",
                project.getId().toString(),
                Map.of("cascadeDeleted", true)
        );
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public Optional<DevScanEntity> recordScanResult(
            UUID tenantId,
            UUID triggeredBy,
            UUID projectId,
            String projectNameHint,
            String repoUrlHint,
            String branchHint,
            String source,
            Map<String, Object> workerResponse
    ) {
        if (workerResponse == null) return Optional.empty();
        DevProjectEntity project = resolveOrCreateProject(
                tenantId, triggeredBy, projectId, projectNameHint, repoUrlHint, branchHint, source);
        if (project == null) return Optional.empty();

        Map<String, Object> mutableResponse = new LinkedHashMap<>(workerResponse);
        double rawScore = toDouble(mutableResponse.get("score"), toDouble(mutableResponse.get("overall_score"), 0.0));
        List<Map<String, Object>> rawFindings = mutableResponse.get("findings") instanceof List<?> list
                ? (List<Map<String, Object>>) list : List.of();
        List<Map<String, Object>> rawDeps = mutableResponse.get("dependencies") instanceof List<?> list
                ? (List<Map<String, Object>>) list : List.of();
        List<Map<String,Object>> breakdown = mutableResponse.get("score_breakdown") instanceof List<?> list
                ? list.stream().filter(Map.class::isInstance).map(item -> (Map<String,Object>)item).toList() : List.of();
        rawFindings=rawFindings.stream().filter(java.util.Objects::nonNull).map(finding -> {
            var normalized=new LinkedHashMap<>(finding);
            normalized.put("score",findingPoints(finding,breakdown));
            return (Map<String,Object>)normalized;
        }).toList();
        mutableResponse.put("findings",rawFindings);

        Instant now = Instant.now();
        List<DevSuppressionEntity> activeSuppressions = suppressionRepository
                .findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, project.getId())
                .stream()
                .filter(s -> s.isActiveAt(now))
                .toList();

        double suppressedPoints = 0.0;
        boolean hasSuppressionsApplied = false;
        List<DevFindingEntity> findingsToSave = new ArrayList<>();
        Set<String> seenFp = new HashSet<>();

        String breakdownJson = writeJsonSafe(workerResponse.getOrDefault("score_breakdown", List.of()), "[]");
        String limitsJson = writeJsonSafe(workerResponse.getOrDefault("limits", Map.of()), "{}");
        String rulesVersion = sanitizeText(String.valueOf(workerResponse.getOrDefault("rules_version", "2.0.0")), 40);

        DevScanEntity scan = scanRepository.saveAndFlush(new DevScanEntity(
                tenantId,
                project.getId(),
                triggeredBy,
                normalizeScanSource(source),
                rulesVersion.isEmpty() ? "2.0.0" : rulesVersion,
                sanitizeText(String.valueOf(workerResponse.getOrDefault("commit_sha", "")), 64),
                sanitizeText(branchHint, 120),
                rawScore,
                rawScore,
                false,
                breakdownJson,
                limitsJson,
                rawFindings.size(),
                rawDeps.size(),
                rawScore >= 50 ? "FAIL" : (rawScore > 0 ? "WARN" : "PASS")
        ));

        for (Map<String, Object> f : rawFindings) {
            if (f == null) continue;
            String ruleId = sanitizeText(String.valueOf(f.getOrDefault("rule_id", "UNKNOWN-RULE")), 80);
            String detector = sanitizeText(String.valueOf(f.getOrDefault("detector", "static")), 64);
            String severity = normalizeSeverity(String.valueOf(f.getOrDefault("severity", "LOW")));
            String title = sanitizeText(String.valueOf(f.getOrDefault("title", ruleId)), 255);
            String location = sanitizeText(String.valueOf(f.getOrDefault("location", f.getOrDefault("file_path", ""))), 300);
            String explanation = sanitizeText(String.valueOf(f.getOrDefault("explanation", f.getOrDefault("summary", ""))), 1200);
            double pts = toDouble(f.get("score"), 0.0);
            String fp = sha256Hex(ruleId + "|" + location + "|" + title);
            if (!seenFp.add(fp)) continue;

            DevFindingEntity entity = new DevFindingEntity(
                    tenantId, project.getId(), scan.getId(), fp, ruleId, detector, severity,
                    title, location.isEmpty() ? null : location, explanation, pts
            );

            boolean suppressed = activeSuppressions.stream().anyMatch(s ->
                    s.getRuleId().equalsIgnoreCase(ruleId)
                            && (s.getFingerprint() == null || s.getFingerprint().equals(fp)));
            if (suppressed) {
                entity.setTriageStatus("ACCEPTED", triggeredBy);
                suppressedPoints += pts;
                hasSuppressionsApplied = true;
            }
            findingsToSave.add(entity);
        }

        if (!findingsToSave.isEmpty()) {
            findingRepository.saveAllAndFlush(findingsToSave);
        }

        List<DevDependencyEntity> depsToSave = new ArrayList<>();
        for (Map<String, Object> d : rawDeps) {
            if (d == null) continue;
            String eco = sanitizeText(String.valueOf(d.getOrDefault("ecosystem", "generic")), 32).toLowerCase(Locale.ROOT);
            String pkg = sanitizeText(String.valueOf(d.getOrDefault("name", "")), 255);
            if (pkg.isEmpty()) continue;
            String ver = sanitizeText(String.valueOf(d.getOrDefault("version", "")), 120);
            String purl = sanitizeText(String.valueOf(d.getOrDefault("purl", buildPurl(eco, pkg, ver))), 400);
            String manifest = sanitizeText(String.valueOf(d.getOrDefault("manifest_path", "")), 255);
            boolean direct = !Boolean.FALSE.equals(d.get("direct"));
            depsToSave.add(new DevDependencyEntity(
                    tenantId, project.getId(), scan.getId(), eco, pkg, ver, purl,
                    manifest.isEmpty() ? null : manifest, direct));
        }
        if (!depsToSave.isEmpty()) {
            dependencyRepository.saveAllAndFlush(depsToSave);
        }

        if (hasSuppressionsApplied) {
            scan.setEffectiveScore(Math.max(0.0, rawScore - suppressedPoints));
            scan.setHasActiveSuppressions(true);
        }

        if (devPolicyService != null) {
            DevPolicyService.PolicyEvaluationResult eval = devPolicyService.evaluateScan(
                    tenantId, project.getId(), findingsToSave, depsToSave);
            scan.setPolicyStatus(eval.status());
            try {
                workerResponse.put("policy_evaluation", Map.of(
                        "status", eval.status(),
                        "fail_on_severity", eval.failOnSeverity(),
                        "action_on_violation", eval.actionOnViolation(),
                        "should_fail_pipeline", eval.shouldFailPipeline(),
                        "violations", eval.violations()
                ));
            } catch (UnsupportedOperationException ignored) {
                // Immutable map passed in direct unit/integration tests
            }
        }
        scanRepository.saveAndFlush(scan);

        project.touch();
        projectRepository.saveAndFlush(project);

        auditLogService.record(
                tenantId,
                triggeredBy,
                "DEV_SCAN_RECORDED",
                "DEV_SCAN",
                scan.getId().toString(),
                Map.of(
                        "projectId", project.getId().toString(),
                        "source", scan.getSource(),
                        "findingsCount", findingsToSave.size(),
                        "dependenciesCount", depsToSave.size(),
                        "hasActiveSuppressions", scan.isHasActiveSuppressions()
                )
        );
        return Optional.of(scan);
    }

    private DevProjectEntity resolveOrCreateProject(
            UUID tenantId,
            UUID userId,
            UUID projectId,
            String projectNameHint,
            String repoUrlHint,
            String branchHint,
            String source
    ) {
        if (projectId != null) {
            return projectRepository.findByIdAndTenantId(projectId, tenantId)
                    .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        }
        String hint = sanitizeText(projectNameHint, 160);
        if (hint.isBlank()) {
            return null;
        }
        String slug = toSlug(hint);
        return projectRepository.findByTenantIdAndSlug(tenantId, slug)
                .orElseGet(() -> projectRepository.saveAndFlush(new DevProjectEntity(
                        tenantId,
                        userId != null ? userId : tenantId,
                        hint,
                        slug,
                        sanitizeRepoUrl(repoUrlHint).isEmpty() ? null : sanitizeRepoUrl(repoUrlHint),
                        sanitizeText(branchHint, 120).isEmpty() ? null : sanitizeText(branchHint, 120),
                        normalizeSourceType(source)
                )));
    }

    private ScanSummaryDto toScanSummary(DevScanEntity s) {
        return new ScanSummaryDto(
                s.getId(), s.getProjectId(), s.getSource(), s.getRulesVersion(),
                s.getCommitSha(), s.getBranch(), s.getScore(), s.getEffectiveScore(),
                s.isHasActiveSuppressions(), s.getFindingsCount(), s.getDependenciesCount(),
                s.getPolicyStatus(), s.getCreatedAt()
        );
    }

    private FindingDiffItem toDiffItem(DevFindingEntity f) {
        return new FindingDiffItem(
                f.getId(), f.getFingerprint(), f.getRuleId(), f.getSeverity(),
                f.getTitle(), f.getLocation(), f.getTriageStatus(), f.getScorePoints()
        );
    }

    private String writeJsonSafe(Object obj, String fallback) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception ex) {
            return fallback;
        }
    }

    public static String buildPurl(String ecosystem, String name, String version) {
        String eco = (ecosystem == null || ecosystem.isBlank()) ? "generic" : ecosystem.toLowerCase(Locale.ROOT);
        String cleanName = name == null ? "" : name.trim();
        String cleanVer = version == null ? "" : version.trim().replaceAll("^[~^=>< ]+", "");
        return "pkg:" + eco + "/" + cleanName + (cleanVer.isEmpty() ? "" : "@" + cleanVer);
    }

    public static String sanitizeText(String raw, int maxLen) {
        if (raw == null || "null".equals(raw)) return "";
        String cleaned = SECRET_LIKE.matcher(raw).replaceAll("[REDACTED]")
                .replaceAll("[\\r\\n\\t]+", " ")
                .trim();
        return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
    }

    private static String sanitizeRepoUrl(String raw) {
        String s = sanitizeText(raw, 500);
        if (s.contains("@") && s.startsWith("http")) {
            s = s.replaceAll("https?://[^@]+@", "https://");
        }
        return s;
    }

    private static String toSlug(String raw) {
        String lower = raw == null ? "proyecto" : raw.toLowerCase(Locale.ROOT);
        String slug = NON_SLUG.matcher(lower).replaceAll("-").replaceAll("^-|-$", "");
        if (slug.isEmpty()) slug = "proyecto";
        return slug.length() > 100 ? slug.substring(0, 100) : slug;
    }

    private static String normalizeSourceType(String raw) {
        String v = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        return switch (v) {
            case "GITHUB_URL", "URL" -> "GITHUB_URL";
            case "GITHUB_APP" -> "GITHUB_APP";
            case "CLI", "GITHUB_ACTION" -> "CLI";
            default -> "ARCHIVE";
        };
    }

    private static String normalizeScanSource(String raw) {
        String v = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        return switch (v) {
            case "CLI", "GITHUB_ACTION", "GITHUB_APP", "URL" -> v;
            default -> "UI";
        };
    }

    private static String normalizeSeverity(String raw) {
        String v = raw == null ? "LOW" : raw.trim().toUpperCase(Locale.ROOT);
        return switch (v) {
            case "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO" -> v;
            default -> "LOW";
        };
    }

    private static double toDouble(Object val, double fallback) {
        if (val instanceof Number n) return n.doubleValue();
        try {
            return val == null ? fallback : Double.parseDouble(String.valueOf(val));
        } catch (Exception ex) {
            return fallback;
        }
    }
    static double findingPoints(Map<String,Object> finding,List<Map<String,Object>> breakdown) {
        Object value=finding.containsKey("score")?finding.get("score"):finding.get("score_points");
        if(value==null) value=breakdown.stream().filter(item -> java.util.Objects.equals(item.get("rule_id"),finding.get("rule_id"))
            && java.util.Objects.equals(item.get("location"),finding.get("location"))).map(item -> item.get("points")).filter(java.util.Objects::nonNull).findFirst().orElse(null);
        double points=toDouble(value,0);
        return Double.isFinite(points)?Math.max(0,Math.min(100,points)):0;
    }

    public static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest((input == null ? "" : input).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    public record ProjectSummaryDto(
            UUID id,
            String name,
            String slug,
            String repoUrl,
            String defaultBranch,
            String sourceType,
            int scansCount,
            Double latestEffectiveScore,
            Double latestRawScore,
            Double scoreDelta,
            int latestFindingsCount,
            int latestDependenciesCount,
            String latestPolicyStatus,
            boolean hasActiveSuppressions,
            Instant lastScanAt,
            Instant createdAt,
            Instant updatedAt
    ) {}

    public record ScanSummaryDto(
            UUID id,
            UUID projectId,
            String source,
            String rulesVersion,
            String commitSha,
            String branch,
            double score,
            double effectiveScore,
            boolean hasActiveSuppressions,
            int findingsCount,
            int dependenciesCount,
            String policyStatus,
            Instant createdAt
    ) {}

    public record ProjectDetailDto(
            UUID id,
            String name,
            String slug,
            String repoUrl,
            String defaultBranch,
            String sourceType,
            Instant createdAt,
            Instant updatedAt,
            List<ScanSummaryDto> scans
    ) {}

    public record FindingDiffItem(
            UUID id,
            String fingerprint,
            String ruleId,
            String severity,
            String title,
            String location,
            String triageStatus,
            double scorePoints
    ) {}

    public record ScanComparisonDto(
            UUID projectId,
            ScanSummaryDto baseScan,
            ScanSummaryDto headScan,
            double scoreDelta,
            List<FindingDiffItem> added,
            List<FindingDiffItem> resolved,
            List<FindingDiffItem> unchanged
    ) {}
}
