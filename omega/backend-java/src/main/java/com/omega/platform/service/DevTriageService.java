package com.omega.platform.service;

import com.omega.platform.domain.DevFindingCommentEntity;
import com.omega.platform.domain.DevFindingEntity;
import com.omega.platform.domain.DevProjectEntity;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.domain.DevSuppressionEntity;
import com.omega.platform.repository.DevFindingCommentRepository;
import com.omega.platform.repository.DevFindingRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DevScanRepository;
import com.omega.platform.repository.DevSuppressionRepository;
import com.omega.platform.security.OmegaPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Triaje de hallazgos DEVELOPER (estados, comentarios, supresiones con motivo y expiración)
 * y recálculo de puntaje efectivo indicando supresiones activas.
 */
@Service
public class DevTriageService {

    private static final Set<String> VALID_TRIAGE_STATES = Set.of(
            "NEW", "CONFIRMED", "FALSE_POSITIVE", "ACCEPTED", "RESOLVED"
    );

    private final DevFindingRepository findingRepository;
    private final DevFindingCommentRepository commentRepository;
    private final DevSuppressionRepository suppressionRepository;
    private final DevScanRepository scanRepository;
    private final DevProjectRepository projectRepository;
    private final AuditLogService auditLogService;

    public DevTriageService(
            DevFindingRepository findingRepository,
            DevFindingCommentRepository commentRepository,
            DevSuppressionRepository suppressionRepository,
            DevScanRepository scanRepository,
            DevProjectRepository projectRepository,
            AuditLogService auditLogService
    ) {
        this.findingRepository = findingRepository;
        this.commentRepository = commentRepository;
        this.suppressionRepository = suppressionRepository;
        this.scanRepository = scanRepository;
        this.projectRepository = projectRepository;
        this.auditLogService = auditLogService;
    }

    @Transactional(readOnly = true)
    public List<FindingViewDto> listFindings(
            OmegaPrincipal principal,
            UUID projectId,
            String severity,
            String ruleId,
            String triageStatus
    ) {
        return listFindings(principal,projectId,severity,ruleId,triageStatus,true);
    }
    @Transactional(readOnly = true)
    public List<FindingViewDto> listFindings(OmegaPrincipal principal,UUID projectId,String severity,String ruleId,String triageStatus,boolean latestOnly) {
        UUID tenantId = principal.tenantId();
        List<DevFindingEntity> base = projectId != null
                ? findingRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId)
                : findingRepository.findAllByTenantIdOrderByCreatedAtDesc(tenantId);
        Set<UUID> latestScans = new java.util.HashSet<>();
        if(latestOnly) for(UUID id:base.stream().map(DevFindingEntity::getProjectId).distinct().toList()) {
            var scans=scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId,id);
            if(!scans.isEmpty()) latestScans.add(scans.getFirst().getId());
        }

        String sevFilter = severity == null ? "" : severity.trim().toUpperCase(Locale.ROOT);
        String ruleFilter = ruleId == null ? "" : ruleId.trim().toUpperCase(Locale.ROOT);
        String statusFilter = triageStatus == null ? "" : triageStatus.trim().toUpperCase(Locale.ROOT);

        return base.stream()
                .filter(f -> !latestOnly || latestScans.contains(f.getScanId()))
                .filter(f -> sevFilter.isEmpty() || f.getSeverity().equalsIgnoreCase(sevFilter))
                .filter(f -> ruleFilter.isEmpty() || f.getRuleId().toUpperCase(Locale.ROOT).contains(ruleFilter))
                .filter(f -> statusFilter.isEmpty() || f.getTriageStatus().equalsIgnoreCase(statusFilter))
                .map(this::toView)
                .toList();
    }

    @Transactional
    public FindingViewDto updateTriageStatus(
            OmegaPrincipal principal,
            UUID findingId,
            String nextStatus,
            String commentBody
    ) {
        String normalized = nextStatus == null ? "" : nextStatus.trim().toUpperCase(Locale.ROOT);
        if (!VALID_TRIAGE_STATES.contains(normalized)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Estado de triaje inválido.");
        }
        DevFindingEntity finding = findingRepository.findByIdAndTenantId(findingId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Hallazgo no encontrado en el espacio actual"));

        String previousStatus = finding.getTriageStatus();
        finding.setTriageStatus(normalized, principal.userId());
        findingRepository.saveAndFlush(finding);

        if (commentBody != null && !commentBody.isBlank()) {
            String cleanComment = DevProjectService.sanitizeText(commentBody, 1000);
            if (!cleanComment.isEmpty()) {
                commentRepository.saveAndFlush(new DevFindingCommentEntity(
                        principal.tenantId(), finding.getId(), principal.userId(), cleanComment));
            }
        }

        recalculateScanEffectiveScore(principal.tenantId(), finding.getProjectId(), finding.getScanId());

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_FINDING_TRIAGED",
                "DEV_FINDING",
                finding.getId().toString(),
                Map.of(
                        "projectId", finding.getProjectId().toString(),
                        "ruleId", finding.getRuleId(),
                        "previousStatus", previousStatus,
                        "newStatus", normalized
                )
        );
        return toView(finding);
    }

    @Transactional
    public CommentViewDto addComment(OmegaPrincipal principal, UUID findingId, String body) {
        DevFindingEntity finding = findingRepository.findByIdAndTenantId(findingId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Hallazgo no encontrado en el espacio actual"));
        String cleanBody = DevProjectService.sanitizeText(body, 1000);
        if (cleanBody.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El comentario no puede estar vacío.");
        }
        DevFindingCommentEntity saved = commentRepository.saveAndFlush(
                new DevFindingCommentEntity(principal.tenantId(), finding.getId(), principal.userId(), cleanBody)
        );
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_FINDING_COMMENTED",
                "DEV_FINDING",
                finding.getId().toString(),
                Map.of("commentId", saved.getId().toString())
        );
        return new CommentViewDto(saved.getId(), saved.getFindingId(), saved.getAuthorUserId(), saved.getBody(), saved.getCreatedAt());
    }

    @Transactional(readOnly = true)
    public List<CommentViewDto> listComments(OmegaPrincipal principal, UUID findingId) {
        findingRepository.findByIdAndTenantId(findingId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Hallazgo no encontrado en el espacio actual"));
        return commentRepository.findAllByTenantIdAndFindingIdOrderByCreatedAtAsc(principal.tenantId(), findingId)
                .stream()
                .map(c -> new CommentViewDto(c.getId(), c.getFindingId(), c.getAuthorUserId(), c.getBody(), c.getCreatedAt()))
                .toList();
    }

    @Transactional
    public SuppressionViewDto createSuppression(
            OmegaPrincipal principal,
            UUID projectId,
            String ruleId,
            String fingerprint,
            String reason,
            Integer expiresInDays
    ) {
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        String cleanRule = DevProjectService.sanitizeText(ruleId, 80);
        String cleanReason = DevProjectService.sanitizeText(reason, 400);
        if (cleanRule.isBlank() || cleanReason.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La regla y el motivo de supresión son obligatorios.");
        }
        Instant expiresAt = (expiresInDays != null && expiresInDays > 0)
                ? Instant.now().plus(Math.min(expiresInDays, 365), ChronoUnit.DAYS)
                : null;
        String cleanFp = (fingerprint == null || fingerprint.isBlank()) ? null : DevProjectService.sanitizeText(fingerprint, 64);

        DevSuppressionEntity saved = suppressionRepository.saveAndFlush(new DevSuppressionEntity(
                principal.tenantId(), project.getId(), cleanRule, cleanFp, cleanReason, principal.userId(), expiresAt
        ));

        // Aplicar a los hallazgos del último escaneo del proyecto
        scanRepository.findFirstByTenantIdAndProjectIdOrderByCreatedAtDesc(principal.tenantId(), project.getId())
                .ifPresent(latest -> recalculateScanEffectiveScore(principal.tenantId(), project.getId(), latest.getId()));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_SUPPRESSION_CREATED",
                "DEV_SUPPRESSION",
                saved.getId().toString(),
                Map.of(
                        "projectId", project.getId().toString(),
                        "ruleId", saved.getRuleId(),
                        "hasExpiration", expiresAt != null
                )
        );
        return toSuppressionView(saved);
    }

    @Transactional(readOnly = true)
    public List<SuppressionViewDto> listSuppressions(OmegaPrincipal principal, UUID projectId) {
        projectRepository.findByIdAndTenantId(projectId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        return suppressionRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(principal.tenantId(), projectId)
                .stream()
                .map(this::toSuppressionView)
                .toList();
    }

    @Transactional
    public SuppressionViewDto revokeSuppression(OmegaPrincipal principal, UUID suppressionId) {
        DevSuppressionEntity sup = suppressionRepository.findByIdAndTenantId(suppressionId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Supresión no encontrada en el espacio actual"));
        sup.revoke();
        suppressionRepository.saveAndFlush(sup);
        scanRepository.findFirstByTenantIdAndProjectIdOrderByCreatedAtDesc(principal.tenantId(), sup.getProjectId())
                .ifPresent(latest -> recalculateScanEffectiveScore(principal.tenantId(), sup.getProjectId(), latest.getId()));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_SUPPRESSION_REVOKED",
                "DEV_SUPPRESSION",
                sup.getId().toString(),
                Map.of("projectId", sup.getProjectId().toString(), "ruleId", sup.getRuleId())
        );
        return toSuppressionView(sup);
    }

    private void recalculateScanEffectiveScore(UUID tenantId, UUID projectId, UUID scanId) {
        DevScanEntity scan = scanRepository.findByIdAndTenantId(scanId, tenantId).orElse(null);
        if (scan == null) return;
        Instant now = Instant.now();
        List<DevSuppressionEntity> activeSups = suppressionRepository
                .findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId)
                .stream()
                .filter(s -> s.isActiveAt(now))
                .toList();
        List<DevFindingEntity> findings = findingRepository.findAllByTenantIdAndScanIdOrderByScorePointsDesc(tenantId, scanId);
        double deducted = 0.0;
        boolean hasSuppressionOrDismissal = !activeSups.isEmpty();
        for (DevFindingEntity f : findings) {
            boolean byRuleSup = activeSups.stream().anyMatch(s ->
                    s.getRuleId().equalsIgnoreCase(f.getRuleId())
                            && (s.getFingerprint() == null || s.getFingerprint().equals(f.getFingerprint())));
            boolean byTriage = "FALSE_POSITIVE".equalsIgnoreCase(f.getTriageStatus())
                    || "ACCEPTED".equalsIgnoreCase(f.getTriageStatus())
                    || "RESOLVED".equalsIgnoreCase(f.getTriageStatus());
            if (byRuleSup || byTriage) {
                deducted += f.getScorePoints();
                hasSuppressionOrDismissal = true;
            }
        }
        scan.setEffectiveScore(Math.max(0.0, scan.getScore() - deducted));
        scan.setHasActiveSuppressions(hasSuppressionOrDismissal);
        scanRepository.saveAndFlush(scan);
    }

    private FindingViewDto toView(DevFindingEntity f) {
        return new FindingViewDto(
                f.getId(), f.getProjectId(), f.getScanId(), f.getFingerprint(),
                f.getRuleId(), f.getDetector(), f.getSeverity(), f.getTitle(),
                f.getLocation(), f.getExplanation(), f.getScorePoints(),
                f.getTriageStatus(), f.getTriageUpdatedAt(), f.getCreatedAt(),DevRemediationGuide.forFinding(f.getRuleId(),f.getLocation())
        );
    }

    private SuppressionViewDto toSuppressionView(DevSuppressionEntity s) {
        return new SuppressionViewDto(
                s.getId(), s.getProjectId(), s.getRuleId(), s.getFingerprint(),
                s.getReason(), s.getCreatedBy(), s.getExpiresAt(), s.getRevokedAt(),
                s.isActiveAt(Instant.now()), s.getCreatedAt()
        );
    }

    public record FindingViewDto(
            UUID id,
            UUID projectId,
            UUID scanId,
            String fingerprint,
            String ruleId,
            String detector,
            String severity,
            String title,
            String location,
            String explanation,
            double scorePoints,
            String triageStatus,
            Instant triageUpdatedAt,
            Instant createdAt,
            DevRemediationGuide.Guide remediation
    ) {}

    public record CommentViewDto(
            UUID id,
            UUID findingId,
            UUID authorUserId,
            String body,
            Instant createdAt
    ) {}

    public record SuppressionViewDto(
            UUID id,
            UUID projectId,
            String ruleId,
            String fingerprint,
            String reason,
            UUID createdBy,
            Instant expiresAt,
            Instant revokedAt,
            boolean active,
            Instant createdAt
    ) {}
}
