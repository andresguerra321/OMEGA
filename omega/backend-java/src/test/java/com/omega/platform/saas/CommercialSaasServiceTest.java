package com.omega.platform.saas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class CommercialSaasServiceTest {

    private SubscriptionRepository subscriptionRepository;
    private DeviceRepository deviceRepository;
    private AiUsageQuotaRepository aiUsageQuotaRepository;
    private AlertDispatchRepository alertDispatchRepository;
    private CommercialSaasService saasService;

    @BeforeEach
    void setUp() {
        subscriptionRepository = mock(SubscriptionRepository.class);
        deviceRepository = mock(DeviceRepository.class);
        aiUsageQuotaRepository = mock(AiUsageQuotaRepository.class);
        alertDispatchRepository = mock(AlertDispatchRepository.class);

        when(subscriptionRepository.save(any(SubscriptionEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(deviceRepository.save(any(DeviceEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(aiUsageQuotaRepository.save(any(AiUsageQuotaEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(alertDispatchRepository.save(any(AlertDispatchEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        saasService = new CommercialSaasService(
                subscriptionRepository,
                deviceRepository,
                aiUsageQuotaRepository,
                alertDispatchRepository);
    }

    @Test
    void enforcesPlanDeviceLimitAndBlocksRevokedDevices() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        SubscriptionEntity sub = new SubscriptionEntity();
        sub.setId(UUID.randomUUID());
        sub.setTenantId(tenantId);
        sub.setPlanCode("PERSONAL");
        sub.setStatus("ACTIVE");
        sub.setMaxDevices(2);
        sub.setMonthlyAiQuota(100);
        sub.setCurrentPeriodStart(OffsetDateTime.now(ZoneOffset.UTC));
        sub.setCurrentPeriodEnd(OffsetDateTime.now(ZoneOffset.UTC).plusDays(30));

        when(subscriptionRepository.findByTenantId(tenantId)).thenReturn(Optional.of(sub));
        when(deviceRepository.findByTenantIdAndDeviceUid(tenantId, "dev-3")).thenReturn(Optional.empty());
        when(deviceRepository.countByTenantIdAndStatus(tenantId, "ACTIVE")).thenReturn(2L);

        assertThrows(IllegalStateException.class, () ->
                saasService.registerOrHeartbeatDevice(tenantId, userId, "dev-3", "laptop-3", "windows", "1.10.1"));

        DeviceEntity revoked = new DeviceEntity();
        revoked.setId(UUID.randomUUID());
        revoked.setTenantId(tenantId);
        revoked.setUserId(userId);
        revoked.setDeviceUid("dev-revoked");
        revoked.setStatus("REVOKED");
        when(deviceRepository.findByTenantIdAndDeviceUid(tenantId, "dev-revoked")).thenReturn(Optional.of(revoked));

        assertThrows(IllegalStateException.class, () ->
                saasService.registerOrHeartbeatDevice(tenantId, userId, "dev-revoked", "stolen-pc", "windows", "1.10.1"));
    }

    @Test
    void sovereignOllamaIsUnlimitedWhileCloudQuotaIsEnforced() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        SubscriptionEntity sub = new SubscriptionEntity();
        sub.setId(UUID.randomUUID());
        sub.setTenantId(tenantId);
        sub.setPlanCode("PERSONAL");
        sub.setStatus("ACTIVE");
        sub.setMaxDevices(3);
        sub.setMonthlyAiQuota(2);
        sub.setCurrentPeriodStart(OffsetDateTime.now(ZoneOffset.UTC));
        sub.setCurrentPeriodEnd(OffsetDateTime.now(ZoneOffset.UTC).plusDays(30));

        AiUsageQuotaEntity quota = new AiUsageQuotaEntity();
        quota.setId(UUID.randomUUID());
        quota.setTenantId(tenantId);
        quota.setUserId(userId);
        quota.setPeriodYm(CommercialSaasService.currentPeriodYm());
        quota.setCloudQueriesUsed(1);
        quota.setVisionQueriesUsed(1);
        quota.setSovereignQueriesUsed(50);

        when(subscriptionRepository.findByTenantId(tenantId)).thenReturn(Optional.of(sub));
        when(aiUsageQuotaRepository.findByTenantIdAndUserIdAndPeriodYm(tenantId, userId, quota.getPeriodYm()))
                .thenReturn(Optional.of(quota));

        // Cloud query fails when limit (2/2) is reached
        assertThrows(IllegalStateException.class, () ->
                saasService.consumeAiQuota(tenantId, userId, false, false));

        // Sovereign Ollama query ALWAYS succeeds even after cloud quota is exhausted
        AiUsageQuotaEntity updated = saasService.consumeAiQuota(tenantId, userId, true, false);
        assertEquals(51, updated.getSovereignQueriesUsed());
    }

    @Test
    void alertDispatcherRejectsPrivateWebhooksAndRecordsAuditTrail() {
        assertFalse(AlertDispatcherService.isSafeExternalHttpsWebhook("http://example.com/hook"));
        assertFalse(AlertDispatcherService.isSafeExternalHttpsWebhook("https://localhost/hook"));
        assertFalse(AlertDispatcherService.isSafeExternalHttpsWebhook("https://127.0.0.1/hook"));
        assertFalse(AlertDispatcherService.isSafeExternalHttpsWebhook("https://10.0.0.5/hook"));
        assertFalse(AlertDispatcherService.isSafeExternalHttpsWebhook("https://192.168.1.1/hook"));

        AlertDispatcherService dispatcher = new AlertDispatcherService(
                alertDispatchRepository,
                RestClient.builder(),
                "",
                "",
                "",
                "");
        List<AlertDispatcherService.DispatchResult> results = dispatcher.dispatchCriticalAlert(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "CRITICAL",
                "Posible Pegasus",
                "Indicador detectado",
                "http://127.0.0.1:8080/internal");

        assertEquals(1, results.size());
        assertFalse(results.get(0).delivered());
        assertTrue(results.get(0).detail().contains("HTTPS"));
    }
}
