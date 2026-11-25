package com.omega.platform.saas;

import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CommercialSaasService {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.CreditService credits;


    public record PlanLimits(String planCode, int maxDevices, int monthlyAiQuota) {}

    public static final Map<String, PlanLimits> PLAN_CATALOG = Map.of(
            "FREE", new PlanLimits("FREE", 1, 30),
            "PRO", new PlanLimits("PRO", 5, 500),
            "ENTERPRISE", new PlanLimits("ENTERPRISE", 25, 3000)
    );

    private final SubscriptionRepository subscriptionRepository;
    private final DeviceRepository deviceRepository;
    private final AiUsageQuotaRepository aiUsageQuotaRepository;
    private final AlertDispatchRepository alertDispatchRepository;

    public CommercialSaasService(
            SubscriptionRepository subscriptionRepository,
            DeviceRepository deviceRepository,
            AiUsageQuotaRepository aiUsageQuotaRepository,
            AlertDispatchRepository alertDispatchRepository) {
        this.subscriptionRepository = subscriptionRepository;
        this.deviceRepository = deviceRepository;
        this.aiUsageQuotaRepository = aiUsageQuotaRepository;
        this.alertDispatchRepository = alertDispatchRepository;
    }

    @Transactional
    public SubscriptionEntity getOrProvisionSubscription(UUID tenantId) {
        SubscriptionEntity result = subscriptionRepository.findByTenantId(tenantId).orElseGet(() -> {
            OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
            PlanLimits defaults = PLAN_CATALOG.get("FREE");
            SubscriptionEntity sub = new SubscriptionEntity();
            sub.setId(UUID.randomUUID());
            sub.setTenantId(tenantId);
            sub.setPlanCode(defaults.planCode());
            sub.setStatus("ACTIVE");
            sub.setMaxDevices(defaults.maxDevices());
            sub.setMonthlyAiQuota(defaults.monthlyAiQuota());
            sub.setCurrentPeriodStart(now);
            sub.setCurrentPeriodEnd(now.plusDays(30));
            sub.setUpdatedAt(now);
            return subscriptionRepository.save(sub);
        });
        if (credits != null && credits.enforced() && (!result.isPaidVerified() || !result.getCurrentPeriodEnd().isAfter(OffsetDateTime.now(ZoneOffset.UTC)))) {
            SubscriptionEntity view = new SubscriptionEntity();
            view.setId(result.getId()); view.setTenantId(tenantId); view.setPlanCode("FREE");
            view.setStatus("ACTIVE"); view.setMaxDevices(1); view.setMonthlyAiQuota(30);
            view.setCurrentPeriodStart(result.getCurrentPeriodStart()); view.setCurrentPeriodEnd(result.getCurrentPeriodEnd());
            return view;
        }
        return result;
    }

    @Transactional
    public SubscriptionEntity updateSubscriptionPlan(UUID tenantId, String rawPlanCode) {
        String normalized = rawPlanCode == null ? "" : rawPlanCode.trim().toUpperCase(Locale.ROOT);
        PlanLimits target = PLAN_CATALOG.get(normalized);
        if (target == null) {
            throw new IllegalArgumentException("Plan no soportado: " + rawPlanCode + ". Usa FREE, PRO o ENTERPRISE.");
        }
        SubscriptionEntity sub = getOrProvisionSubscription(tenantId);
        sub.setPlanCode(target.planCode());
        sub.setMaxDevices(target.maxDevices());
        sub.setMonthlyAiQuota(target.monthlyAiQuota());
        sub.setStatus("ACTIVE");
        sub.setUpdatedAt(OffsetDateTime.now(ZoneOffset.UTC));
        return subscriptionRepository.save(sub);
    }

    @Transactional
    public DeviceEntity registerOrHeartbeatDevice(
            UUID tenantId,
            UUID userId,
            String deviceUid,
            String hostname,
            String osPlatform,
            String sensorVersion) {
        if (credits != null) credits.lock(tenantId);
        String cleanUid = deviceUid == null ? "" : deviceUid.trim();
        if (cleanUid.isEmpty()) {
            throw new IllegalArgumentException("deviceUid es obligatorio.");
        }
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        var existingOpt = deviceRepository.findByTenantIdAndDeviceUid(tenantId, cleanUid);
        if (existingOpt.isPresent()) {
            DeviceEntity existing = existingOpt.get();
            if ("REVOKED".equalsIgnoreCase(existing.getStatus())) {
                throw new IllegalStateException("Este dispositivo fue revocado remotamente y debe re-autorizarse.");
            }
            existing.setHostname(sanitize(hostname, existing.getHostname(), 200));
            existing.setOsPlatform(sanitize(osPlatform, existing.getOsPlatform(), 64));
            existing.setSensorVersion(sanitize(sensorVersion, existing.getSensorVersion(), 40));
            existing.setLastHeartbeatAt(now);
            return deviceRepository.save(existing);
        }

        SubscriptionEntity sub = getOrProvisionSubscription(tenantId);
        long activeCount = deviceRepository.countByTenantIdAndStatus(tenantId, "ACTIVE");
        if (activeCount >= sub.getMaxDevices()) {
            throw new IllegalStateException(
                    "Límite de dispositivos del plan " + sub.getPlanCode()
                            + " alcanzado (" + activeCount + "/" + sub.getMaxDevices() + "). Revoca un equipo o mejora el plan.");
        }

        DeviceEntity created = new DeviceEntity();
        created.setId(UUID.randomUUID());
        created.setTenantId(tenantId);
        created.setUserId(userId);
        created.setDeviceUid(cleanUid.length() > 128 ? cleanUid.substring(0, 128) : cleanUid);
        created.setHostname(sanitize(hostname, "equipo-omega", 200));
        created.setOsPlatform(sanitize(osPlatform, "unknown", 64));
        created.setSensorVersion(sanitize(sensorVersion, "2.0.1", 40));
        created.setStatus("ACTIVE");
        created.setLastHeartbeatAt(now);
        created.setCreatedAt(now);
        return deviceRepository.save(created);
    }

    @Transactional
    public DeviceEntity revokeDevice(UUID tenantId, UUID deviceId) {
        DeviceEntity device = deviceRepository.findByIdAndTenantId(deviceId, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Dispositivo no encontrado en tu organización."));
        device.setStatus("REVOKED");
        device.setRevokedAt(OffsetDateTime.now(ZoneOffset.UTC));
        return deviceRepository.save(device);
    }

    @Transactional
    public AiUsageQuotaEntity consumeAiQuota(UUID tenantId, UUID userId, boolean sovereignMode, boolean isVision) {
        String periodYm = currentPeriodYm();
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        AiUsageQuotaEntity quota = aiUsageQuotaRepository
                .findByTenantIdAndUserIdAndPeriodYm(tenantId, userId, periodYm)
                .orElseGet(() -> {
                    AiUsageQuotaEntity q = new AiUsageQuotaEntity();
                    q.setId(UUID.randomUUID());
                    q.setTenantId(tenantId);
                    q.setUserId(userId);
                    q.setPeriodYm(periodYm);
                    q.setCloudQueriesUsed(0);
                    q.setVisionQueriesUsed(0);
                    q.setSovereignQueriesUsed(0);
                    q.setUpdatedAt(now);
                    return q;
                });

        if (sovereignMode) {
            // Modo Soberano (Ollama local) siempre es ilimitado para proteger privacidad y margen
            quota.setSovereignQueriesUsed(quota.getSovereignQueriesUsed() + 1);
            quota.setUpdatedAt(now);
            return aiUsageQuotaRepository.save(quota);
        }

        SubscriptionEntity sub = getOrProvisionSubscription(tenantId);
        int totalCloudUsed = quota.getCloudQueriesUsed() + quota.getVisionQueriesUsed();
        if (totalCloudUsed >= sub.getMonthlyAiQuota()) {
            throw new IllegalStateException(
                    "Cuota mensual de consultas IA en la nube alcanzada (" + totalCloudUsed + "/"
                            + sub.getMonthlyAiQuota() + "). Cambia a Modo Soberano (Ollama ilimitado) o mejora tu plan.");
        }

        if (isVision) {
            quota.setVisionQueriesUsed(quota.getVisionQueriesUsed() + 1);
        } else {
            quota.setCloudQueriesUsed(quota.getCloudQueriesUsed() + 1);
        }
        quota.setUpdatedAt(now);
        return aiUsageQuotaRepository.save(quota);
    }

    @Transactional
    public Map<String, Object> getSaasSummary(UUID tenantId, UUID userId) {
        SubscriptionEntity sub = getOrProvisionSubscription(tenantId);
        List<DeviceEntity> devices = deviceRepository.findByTenantIdOrderByLastHeartbeatAtDesc(tenantId);
        long activeDevices = devices.stream().filter(d -> "ACTIVE".equalsIgnoreCase(d.getStatus())).count();

        String periodYm = currentPeriodYm();
        AiUsageQuotaEntity quota = aiUsageQuotaRepository
                .findByTenantIdAndUserIdAndPeriodYm(tenantId, userId, periodYm)
                .orElse(null);

        int cloudUsed = quota == null ? 0 : quota.getCloudQueriesUsed() + quota.getVisionQueriesUsed();
        int visionUsed = quota == null ? 0 : quota.getVisionQueriesUsed();
        int sovereignUsed = quota == null ? 0 : quota.getSovereignQueriesUsed();

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("subscription", Map.of(
                "planCode", sub.getPlanCode(),
                "status", sub.getStatus(),
                "maxDevices", sub.getMaxDevices(),
                "activeDevices", activeDevices,
                "monthlyAiQuota", sub.getMonthlyAiQuota(),
                "currentPeriodEnd", sub.getCurrentPeriodEnd().toString()
        ));
        summary.put("aiQuota", Map.of(
                "periodYm", periodYm,
                "cloudUsed", cloudUsed,
                "visionUsed", visionUsed,
                "cloudLimit", sub.getMonthlyAiQuota(),
                "cloudRemaining", Math.max(0, sub.getMonthlyAiQuota() - cloudUsed),
                "sovereignUsed", sovereignUsed,
                "sovereignUnlimited", true
        ));
        summary.put("devices", devices.stream().map(d -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", d.getId().toString());
            m.put("deviceUid", d.getDeviceUid());
            m.put("hostname", d.getHostname());
            m.put("osPlatform", d.getOsPlatform());
            m.put("sensorVersion", d.getSensorVersion());
            m.put("status", d.getStatus());
            m.put("lastHeartbeatAt", d.getLastHeartbeatAt().toString());
            m.put("revokedAt", d.getRevokedAt() != null ? d.getRevokedAt().toString() : null);
            return m;
        }).toList());
        summary.put("recentAlerts", alertDispatchRepository.findTop20ByTenantIdOrderByCreatedAtDesc(tenantId).stream()
                .map(a -> Map.<String, Object>of(
                        "id", a.getId().toString(),
                        "channel", a.getChannel(),
                        "severity", a.getSeverity(),
                        "title", a.getTitle(),
                        "delivered", a.isDelivered(),
                        "statusDetail", a.getStatusDetail() == null ? "" : a.getStatusDetail(),
                        "createdAt", a.getCreatedAt().toString()
                )).toList());
        return summary;
    }

    public static String currentPeriodYm() {
        return YearMonth.now(ZoneOffset.UTC).toString();
    }

    private static String sanitize(String value, String fallback, int maxLen) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        String trimmed = value.trim();
        return trimmed.length() > maxLen ? trimmed.substring(0, maxLen) : trimmed;
    }
}
