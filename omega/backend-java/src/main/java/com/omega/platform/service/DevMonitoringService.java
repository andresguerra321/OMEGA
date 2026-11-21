package com.omega.platform.service;

import com.omega.platform.config.DevMonitoringProperties;
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
import com.omega.platform.saas.SubscriptionEntity;
import com.omega.platform.saas.SubscriptionRepository;
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
import java.util.function.BiFunction;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Monitoreo continuo del inventario de dependencias almacenado (Bloque DG).
 * Reevalúa `dev_dependencies` contra advisories de cadena de suministro sin re-descargar código fuente,
 * tanto bajo demanda (`POST /evaluate`) como de forma programada por plan (`DevContinuousMonitorScheduler`),
 * deduplica alertas por fingerprint, respeta supresiones activas, tolera fallos de feeds
 * y advierte si el feed supera la ventana configurada (48h por defecto) sin actualizarse.
 */
@Service
public class DevMonitoringService {

    private static final Logger log = LoggerFactory.getLogger(DevMonitoringService.class);
    private static final Set<String> VALID_CHANNELS = Set.of("WEBHOOK", "EMAIL", "UI_ALERT");
    private static final Set<String> VALID_SEVERITIES = Set.of("CRITICAL", "HIGH", "MEDIUM", "LOW");

    private final DevProjectRepository projectRepository;
    private final DevScanRepository scanRepository;
    private final DevDependencyRepository dependencyRepository;
    private final DevFindingRepository findingRepository;
    private final DevSuppressionRepository suppressionRepository;
    private final DevMonitorSubscriptionRepository subscriptionRepository;
    private final DevSupplyChainIntelService supplyChainIntelService;
    private final SubscriptionRepository saasSubscriptionRepository;
    private final DevMonitoringProperties monitoringProperties;
    private final AuditLogService auditLogService;

    private volatile Instant lastFeedRefreshAt = Instant.now();
    private volatile Instant lastFeedErrorAt;
    private volatile String lastFeedErrorMessage;
    private volatile BiFunction<UUID, UUID, SupplyChainCatalogResponse> catalogFetcherOverride;

    public DevMonitoringService(
            DevProjectRepository projectRepository,
            DevScanRepository scanRepository,
            DevDependencyRepository dependencyRepository,
            DevFindingRepository findingRepository,
            DevSuppressionRepository suppressionRepository,
            DevMonitorSubscriptionRepository subscriptionRepository,
            DevSupplyChainIntelService supplyChainIntelService,
            SubscriptionRepository saasSubscriptionRepository,
            DevMonitoringProperties monitoringProperties,
            AuditLogService auditLogService
    ) {
        this.projectRepository = projectRepository;
        this.scanRepository = scanRepository;
        this.dependencyRepository = dependencyRepository;
        this.findingRepository = findingRepository;
        this.suppressionRepository = suppressionRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.supplyChainIntelService = supplyChainIntelService;
        this.saasSubscriptionRepository = saasSubscriptionRepository;
        this.monitoringProperties = monitoringProperties;
        this.auditLogService = auditLogService;
    }

    public void setLastFeedRefreshAt(Instant lastFeedRefreshAt) {
        this.lastFeedRefreshAt = lastFeedRefreshAt == null ? Instant.now() : lastFeedRefreshAt;
    }

    public void setCatalogFetcherOverride(BiFunction<UUID, UUID, SupplyChainCatalogResponse> override) {
        this.catalogFetcherOverride = override;
    }

    public void clearFeedFailureState() {
        this.lastFeedErrorAt = null;
        this.lastFeedErrorMessage = null;
    }

    public int resolveFrequencyHours(UUID tenantId) {
        String planCode = saasSubscriptionRepository.findByTenantId(tenantId)
                .map(SubscriptionEntity::getPlanCode)
                .orElse("PERSONAL");
        return monitoringProperties.frequencyHoursForPlan(planCode);
    }

    @Transactional(readOnly = true)
    public MonitoringStatusDto getProjectMonitoring(OmegaPrincipal principal, UUID projectId) {
        UUID tenantId = principal.tenantId();
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        List<DevMonitorSubscriptionEntity> subs = subscriptionRepository.findAllByTenantIdAndProjectId(tenantId, project.getId());
        DevMonitorSubscriptionEntity sub = subs.isEmpty() ? null : subs.get(0);
        return toStatusDto(tenantId, project.getId(), sub);
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
                        "minSeverity", saved.getMinSeverity(),
                        "frequencyHours", resolveFrequencyHours(tenantId)
                )
        );
        return toStatusDto(tenantId, project.getId(), saved);
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

        return evaluateStoredInventoryInternal(tenantId, principal.userId(), project.getId(), sub, Instant.now(), "MANUAL");
    }

    /**
     * Ejecuta la pasada programada del planificador sobre todas las suscripciones activas cuya ventana
     * según el plan del tenant haya vencido. Nunca descarga código y aísla fallos por suscripción/feed.
     */
    @Transactional
    public ScheduledRunSummary runScheduledEvaluations() {
        return runScheduledEvaluations(Instant.now());
    }

    @Transactional
    public ScheduledRunSummary runScheduledEvaluations(Instant now) {
        List<DevMonitorSubscriptionEntity> activeSubs = subscriptionRepository.findAllByEnabledTrue();
        int evaluated = 0;
        int newAlertsTotal = 0;
        int failed = 0;

        for (DevMonitorSubscriptionEntity sub : activeSubs) {
            int frequencyHours = resolveFrequencyHours(sub.getTenantId());
            if (!isDue(sub.getLastEvaluatedAt(), frequencyHours, now)) {
                continue;
            }
            try {
                MonitoringEvaluationDto res = evaluateStoredInventoryInternal(
                        sub.getTenantId(),
                        sub.getCreatedBy(),
                        sub.getProjectId(),
                        sub,
                        now,
                        "SCHEDULED"
                );
                evaluated++;
                newAlertsTotal += res.newAlertsCount();
            } catch (Exception ex) {
                failed++;
                recordFeedFailure(now, ex);
                log.warn(
                        "DEV_MONITORING_SCHEDULED_FAILED tenant={} project={} reason={}",
                        sub.getTenantId(),
                        sub.getProjectId(),
                        ex.getClass().getSimpleName()
                );
            }
        }
        return new ScheduledRunSummary(activeSubs.size(), evaluated, newAlertsTotal, failed);
    }

    private MonitoringEvaluationDto evaluateStoredInventoryInternal(
            UUID tenantId,
            UUID actorUserId,
            UUID projectId,
            DevMonitorSubscriptionEntity sub,
            Instant now,
            String triggerSource
    ) {
        List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId);
        if (scans.isEmpty()) {
            sub.setLastEvaluatedAt(now);
            subscriptionRepository.saveAndFlush(sub);
            return new MonitoringEvaluationDto(
                    projectId,
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
        List<DevSuppressionEntity> activeSuppressions = suppressionRepository
                .findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId)
                .stream()
                .filter(s -> s.isActiveAt(now))
                .toList();

        Set<String> existingFingerprints = new HashSet<>();
        for (DevFindingEntity f : existingFindings) {
            existingFingerprints.add(f.getFingerprint());
        }

        SupplyChainCatalogResponse catalog = fetchCatalogForTenant(tenantId, projectId, now);
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
                        projectId,
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
                actorUserId,
                "DEV_MONITORING_EVALUATED",
                "DEV_PROJECT",
                projectId.toString(),
                Map.of(
                        "trigger", triggerSource,
                        "evaluatedDependencies", storedDeps.size(),
                        "newAlertsCount", newAlerts.size(),
                        "deduplicatedCount", deduplicatedCount,
                        "suppressedCount", suppressedCount,
                        "feedStaleWarning", isFeedStale()
                )
        );

        return new MonitoringEvaluationDto(
                projectId,
                latestScan.getId(),
                storedDeps.size(),
                newAlerts.size(),
                deduplicatedCount,
                newAlerts,
                isFeedStale(),
                buildStaleNotice()
        );
    }

    private SupplyChainCatalogResponse fetchCatalogForTenant(UUID tenantId, UUID projectId, Instant now) {
        BiFunction<UUID, UUID, SupplyChainCatalogResponse> fetcher = catalogFetcherOverride;
        SupplyChainCatalogResponse response = fetcher != null
                ? fetcher.apply(tenantId, projectId)
                : supplyChainIntelService.listAdvisoriesForTenant(tenantId, null, null, projectId);
        // Al recuperar con éxito un catálogo válido, se limpia cualquier error transitorio previo del feed.
        if (lastFeedErrorAt != null) {
            lastFeedErrorAt = null;
            lastFeedErrorMessage = null;
            lastFeedRefreshAt = now;
        }
        return response;
    }

    private void recordFeedFailure(Instant now, Exception ex) {
        this.lastFeedErrorAt = now;
        this.lastFeedErrorMessage = "Aviso: el último intento de consulta al feed de advisories falló ("
                + ex.getClass().getSimpleName()
                + "); el monitoreo reintentará en el siguiente ciclo.";
    }

    private static boolean isDue(Instant lastEvaluatedAt, int frequencyHours, Instant now) {
        if (lastEvaluatedAt == null) {
            return true;
        }
        return !lastEvaluatedAt.plus(Duration.ofHours(Math.max(1, frequencyHours))).isAfter(now);
    }

    private MonitoringStatusDto toStatusDto(UUID tenantId, UUID projectId, DevMonitorSubscriptionEntity sub) {
        boolean stale = isFeedStale();
        int frequencyHours = resolveFrequencyHours(tenantId);
        Instant lastEval = sub != null ? sub.getLastEvaluatedAt() : null;
        Instant nextScheduledAt = (sub != null && sub.isEnabled())
                ? (lastEval == null ? Instant.now() : lastEval.plus(Duration.ofHours(frequencyHours)))
                : null;
        return new MonitoringStatusDto(
                projectId,
                sub != null ? sub.getId() : null,
                sub != null && sub.isEnabled(),
                sub != null ? sub.getChannel() : "WEBHOOK",
                sub != null ? sub.getMinSeverity() : "HIGH",
                lastEval,
                lastFeedRefreshAt,
                stale,
                buildStaleNotice(),
                frequencyHours,
                nextScheduledAt
        );
    }

    private boolean isFeedStale() {
        if (lastFeedErrorAt != null) {
            return true;
        }
        Duration threshold = Duration.ofHours(Math.max(1, monitoringProperties.getStaleFeedThresholdHours()));
        return Duration.between(lastFeedRefreshAt, Instant.now()).compareTo(threshold) > 0;
    }

    private String buildStaleNotice() {
        if (lastFeedErrorMessage != null) {
            return lastFeedErrorMessage;
        }
        int thresholdHours = Math.max(1, monitoringProperties.getStaleFeedThresholdHours());
        if (!isFeedStale()) {
            return "Catálogo de advisories actualizado dentro de la ventana de " + thresholdHours + "h.";
        }
        return "Aviso: el feed de advisories lleva más de " + thresholdHours
                + " horas sin actualizarse; las alertas pueden no reflejar campañas recientes.";
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
            String feedStatusMessage,
            int frequencyHours,
            Instant nextScheduledAt
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

    public record ScheduledRunSummary(
            int checkedSubscriptions,
            int evaluatedCount,
            int newAlertsTotal,
            int failedCount
    ) {}
}
