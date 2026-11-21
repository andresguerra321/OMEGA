package com.omega.platform.service;

import com.omega.platform.domain.DevDependencyEntity;
import com.omega.platform.domain.DevFindingEntity;
import com.omega.platform.domain.DevMonitorSubscriptionEntity;
import com.omega.platform.domain.DevProjectEntity;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.domain.DevSuppressionEntity;
import com.omega.platform.repository.DevDependencyRepository;
import com.omega.platform.repository.DevFindingRepository;
import com.omega.platform.repository.DevMonitorSubscriptionRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DevScanRepository;
import com.omega.platform.repository.DevSuppressionRepository;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.DevSupplyChainIntelService.AdvisoryWithProjectImpactDto;
import com.omega.platform.service.DevSupplyChainIntelService.SupplyChainCatalogResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
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
 * Monitoreo continuo del inventario de dependencias almacenado (Bloque DG).
 * Reevalúa `dev_dependencies` contra advisories de cadena de suministro sin re-descargar código fuente,
 * deduplica alertas por fingerprint, respeta supresiones activas y advierte si el feed supera 48 horas sin actualizarse.
 */
@Service
public class DevMonitoringService {

    private static final Set<String> VALID_CHANNELS = Set.of("WEBHOOK", "EMAIL", "UI_ALERT");
    private static final Set<String> VALID_SEVERITIES = Set.of("CRITICAL", "HIGH", "MEDIUM", "LOW");
    private static final Duration STALE_FEED_THRESHOLD = Duration.ofHours(48);

    private final DevProjectRepository projectRepository;
    private final DevScanRepository scanRepository;
    private final DevDependencyRepository dependencyRepository;
    private final DevFindingRepository findingRepository;
    private final DevSuppressionRepository suppressionRepository;
    private final DevMonitorSubscriptionRepository subscriptionRepository;
    private final DevSupplyChainIntelService supplyChainIntelService;
    private final AuditLogService auditLogService;

    private volatile Instant lastFeedRefreshAt = Instant.now();

    public DevMonitoringService(
            DevProjectRepository projectRepository,
            DevScanRepository scanRepository,
            DevDependencyRepository dependencyRepository,
            DevFindingRepository findingRepository,
            DevSuppressionRepository suppressionRepository,
            DevMonitorSubscriptionRepository subscriptionRepository,
            DevSupplyChainIntelService supplyChainIntelService,
            AuditLogService auditLogService
    ) {
        this.projectRepository = projectRepository;
        this.scanRepository = scanRepository;
        this.dependencyRepository = dependencyRepository;
        this.findingRepository = findingRepository;
        this.suppressionRepository = suppressionRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.supplyChainIntelService = supplyChainIntelService;
        this.auditLogService = auditLogService;
    }

    public void setLastFeedRefreshAt(Instant lastFeedRefreshAt) {
        this.lastFeedRefreshAt = lastFeedRefreshAt == null ? Instant.now() : lastFeedRefreshAt;
    }

    @Transactional(readOnly = true)
    public MonitoringStatusDto getProjectMonitoring(OmegaPrincipal principal, UUID projectId) {
        UUID tenantId = principal.tenantId();
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        List<DevMonitorSubscriptionEntity> subs = subscriptionRepository.findAllByTenantIdAndProjectId(tenantId, project.getId());
        DevMonitorSubscriptionEntity sub = subs.isEmpty() ? null : subs.get(0);
        return toStatusDto(project.getId(), sub);
    }

    @Transactional
    public MonitoringStatusDto updateProjectMonitoring(
            OmegaPrincipal principal,
            UUID projectId,
            UpdateMonitoringRequest request
    ) {
        requireWriteRole(principal);
        UUID tenantId = principal.tenantId();
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));

        String channel = normalizeChannel(request.channel());
        String minSeverity = normalizeSeverity(request.minSeverity());
        boolean enabled = request.enabled() == null || request.enabled();

        List<DevMonitorSubscriptionEntity> existingList = subscriptionRepository.findAllByTenantIdAndProjectId(tenantId, project.getId());
        DevMonitorSubscriptionEntity entity;
        if (!existingList.isEmpty()) {
            entity = existingList.get(0);
            entity.setEnabled(enabled);
            entity.setMinSeverity(minSeverity);
        } else {
            entity = new DevMonitorSubscriptionEntity(tenantId, project.getId(), channel, minSeverity, principal.userId());
            entity.setEnabled(enabled);
        }

        DevMonitorSubscriptionEntity saved = subscriptionRepository.saveAndFlush(entity);
        auditLogService.record(
                tenantId,
                principal.userId(),
                "DEV_MONITORING_UPDATED",
                "DEV_PROJECT",
                project.getId().toString(),
                Map.of(
                        "enabled", saved.isEnabled(),
                        "channel", saved.getChannel(),
                        "minSeverity", saved.getMinSeverity()
                )
        );
        return toStatusDto(project.getId(), saved);
    }

    @Transactional
    public MonitoringEvaluationDto evaluateStoredInventory(OmegaPrincipal principal, UUID projectId) {
        requireWriteRole(principal);
        UUID tenantId = principal.tenantId();
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));

        List<DevMonitorSubscriptionEntity> subs = subscriptionRepository.findAllByTenantIdAndProjectId(tenantId, project.getId());
        DevMonitorSubscriptionEntity sub = subs.isEmpty()
                ? subscriptionRepository.saveAndFlush(
                        new DevMonitorSubscriptionEntity(tenantId, project.getId(), "WEBHOOK", "HIGH", principal.userId()))
                : subs.get(0);

        List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, project.getId());
        if (scans.isEmpty()) {
            sub.setLastEvaluatedAt(Instant.now());
            subscriptionRepository.saveAndFlush(sub);
            return new MonitoringEvaluationDto(
                    project.getId(),
                    null,
                    0,
                    0,
                    0,
                    List.of(),
                    isFeedStale(),
                    buildStaleNotice()
            );
        }

        DevScanEntity latestScan = scans.get(0);
        List<DevDependencyEntity> storedDeps = dependencyRepository
                .findAllByTenantIdAndScanIdOrderByEcosystemAscPackageNameAsc(tenantId, latestScan.getId());
        List<DevFindingEntity> existingFindings = findingRepository
                .findAllByTenantIdAndScanIdOrderByScorePointsDesc(tenantId, latestScan.getId());
        Instant now = Instant.now();
        List<DevSuppressionEntity> activeSuppressions = suppressionRepository
                .findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, project.getId())
                .stream()
                .filter(s -> s.isActiveAt(now))
                .toList();

        Set<String> existingFingerprints = new HashSet<>();
        for (DevFindingEntity f : existingFindings) {
            existingFingerprints.add(f.getFingerprint());
        }

        SupplyChainCatalogResponse catalog = supplyChainIntelService.listAdvisories(principal, null, null, project.getId());
        int minRank = severityRank(sub.getMinSeverity());
        int deduplicatedCount = 0;
        int suppressedCount = 0;
        List<NewAlertDto> newAlerts = new ArrayList<>();

        for (AdvisoryWithProjectImpactDto adv : catalog.advisories()) {
            if (!adv.affectsSelectedProject()) continue;
            if (severityRank(adv.severity()) < minRank) continue;

            for (String matchedCoord : adv.matchedProjectDependencies()) {
                String ruleId = "PKG-MALICIOUS-ADVISORY-01";
                String location = "sbom:" + matchedCoord;
                String title = adv.id() + " en " + matchedCoord;
                String fp = DevProjectService.sha256Hex(ruleId + "|" + location + "|" + title);

                boolean suppressed = activeSuppressions.stream().anyMatch(s ->
                        s.getRuleId().equalsIgnoreCase(ruleId)
                                && (s.getFingerprint() == null || s.getFingerprint().equals(fp)));
                if (suppressed) {
                    suppressedCount++;
                    continue;
                }

                if (!existingFingerprints.add(fp)) {
                    deduplicatedCount++;
                    continue;
                }

                String explanation = "Monitoreo continuo sobre SBOM almacenado (sin descargar código): "
                        + adv.title() + ". Mitigación: " + adv.mitigation();
                DevFindingEntity finding = findingRepository.saveAndFlush(new DevFindingEntity(
                        tenantId,
                        project.getId(),
                        latestScan.getId(),
                        fp,
                        ruleId,
                        "continuous_monitor",
                        adv.severity(),
                        title,
                        location,
                        explanation,
                        50.0
                ));
                newAlerts.add(new NewAlertDto(
                        finding.getId(),
                        finding.getRuleId(),
                        finding.getSeverity(),
                        finding.getTitle(),
                        finding.getLocation(),
                        adv.id()
                ));
            }
        }

        sub.setLastEvaluatedAt(now);
        subscriptionRepository.saveAndFlush(sub);

        auditLogService.record(
                tenantId,
                principal.userId(),
                "DEV_MONITORING_EVALUATED",
                "DEV_PROJECT",
                project.getId().toString(),
                Map.of(
                        "evaluatedDependencies", storedDeps.size(),
                        "newAlertsCount", newAlerts.size(),
                        "deduplicatedCount", deduplicatedCount,
                        "suppressedCount", suppressedCount,
                        "feedStaleWarning", isFeedStale()
                )
        );

        return new MonitoringEvaluationDto(
                project.getId(),
                latestScan.getId(),
                storedDeps.size(),
                newAlerts.size(),
                deduplicatedCount,
                newAlerts,
                isFeedStale(),
                buildStaleNotice()
        );
    }

    private MonitoringStatusDto toStatusDto(UUID projectId, DevMonitorSubscriptionEntity sub) {
        boolean stale = isFeedStale();
        return new MonitoringStatusDto(
                projectId,
                sub != null ? sub.getId() : null,
                sub != null && sub.isEnabled(),
                sub != null ? sub.getChannel() : "WEBHOOK",
                sub != null ? sub.getMinSeverity() : "HIGH",
                sub != null ? sub.getLastEvaluatedAt() : null,
                lastFeedRefreshAt,
                stale,
                buildStaleNotice()
        );
    }

    private boolean isFeedStale() {
        return Duration.between(lastFeedRefreshAt, Instant.now()).compareTo(STALE_FEED_THRESHOLD) > 0;
    }

    private String buildStaleNotice() {
        if (!isFeedStale()) {
            return "Catálogo de advisories actualizado dentro de la ventana de 48h.";
        }
        return "Aviso: el feed de advisories lleva más de 48 horas sin actualizarse; las alertas pueden no reflejar campañas recientes.";
    }

    private static int severityRank(String severity) {
        if (severity == null) return 1;
        return switch (severity.trim().toUpperCase(Locale.ROOT)) {
            case "CRITICAL" -> 4;
            case "HIGH" -> 3;
            case "MEDIUM" -> 2;
            case "LOW" -> 1;
            default -> 1;
        };
    }

    private static String normalizeChannel(String raw) {
        String c = raw == null || raw.isBlank() ? "WEBHOOK" : raw.trim().toUpperCase(Locale.ROOT);
        if (!VALID_CHANNELS.contains(c)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Canal de monitoreo inválido: " + raw);
        }
        return c;
    }

    private static String normalizeSeverity(String raw) {
        String s = raw == null || raw.isBlank() ? "HIGH" : raw.trim().toUpperCase(Locale.ROOT);
        if (!VALID_SEVERITIES.contains(s)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Severidad mínima inválida: " + raw);
        }
        return s;
    }

    private static void requireWriteRole(OmegaPrincipal principal) {
        if (principal == null || (principal.role() != Role.ADMIN && principal.role() != Role.ANALYST)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Se requiere rol ADMIN o ANALYST.");
        }
    }

    public record UpdateMonitoringRequest(
            Boolean enabled,
            String channel,
            String minSeverity
    ) {}

    public record MonitoringStatusDto(
            UUID projectId,
            UUID subscriptionId,
            boolean enabled,
            String channel,
            String minSeverity,
            Instant lastEvaluatedAt,
            Instant feedUpdatedAt,
            boolean feedStaleWarning,
            String feedStatusMessage
    ) {}

    public record NewAlertDto(
            UUID findingId,
            String ruleId,
            String severity,
            String title,
            String location,
            String advisoryId
    ) {}

    public record MonitoringEvaluationDto(
            UUID projectId,
            UUID scanId,
            int evaluatedDependencies,
            int newAlertsCount,
            int deduplicatedCount,
            List<NewAlertDto> newAlerts,
            boolean feedStaleWarning,
            String feedStatusMessage
    ) {}
}
