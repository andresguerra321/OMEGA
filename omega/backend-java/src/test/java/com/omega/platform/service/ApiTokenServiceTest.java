package com.omega.platform.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.omega.platform.domain.ApiTokenEntity;
import com.omega.platform.domain.RepoScanUsageEntity;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.repository.ApiTokenRepository;
import com.omega.platform.repository.RepoScanUsageRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.saas.SubscriptionEntity;
import com.omega.platform.security.Role;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class ApiTokenServiceTest {

    @Test
    void migrationV13IsMinimalAndReversible() throws Exception {
        Path migration = Path.of("src/main/resources/db/migration/V13__api_tokens.sql");
        assertTrue(Files.exists(migration));
        String sql = Files.readString(migration);
        assertTrue(sql.contains("omega_rag.api_tokens"));
        assertTrue(sql.contains("omega_rag.repo_scan_usage"));
        assertTrue(sql.contains("DROP TABLE IF EXISTS omega_rag.api_tokens"));
    }

    @Test
    void createTokenStoresOnlyHashAndAuditLogsWithoutPlaintextSecret() {
        ApiTokenRepository tokenRepo = mock(ApiTokenRepository.class);
        RepoScanUsageRepository usageRepo = mock(RepoScanUsageRepository.class);
        TenantRepository tenantRepo = mock(TenantRepository.class);
        AuditLogService auditLogService = mock(AuditLogService.class);

        when(tokenRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ApiTokenService service = new ApiTokenService(tokenRepo, usageRepo, tenantRepo, auditLogService);
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        ApiTokenService.CreatedApiToken created = service.createToken(tenantId, userId, "CI GitHub", 30, 50);

        assertTrue(created.plainTextToken().startsWith(ApiTokenService.TOKEN_PREFIX));
        assertEquals("REPO_SCAN", created.token().scope());

        ArgumentCaptor<ApiTokenEntity> savedCaptor = ArgumentCaptor.forClass(ApiTokenEntity.class);
        verify(tokenRepo).save(savedCaptor.capture());
        assertEquals(ApiTokenService.sha256Hex(created.plainTextToken()), savedCaptor.getValue().getTokenHash());
        assertNotEquals(created.plainTextToken(), savedCaptor.getValue().getTokenHash());

        ArgumentCaptor<Map<String, ?>> metaCaptor = ArgumentCaptor.forClass(Map.class);
        verify(auditLogService).record(eq(tenantId), eq(userId), eq("API_TOKEN_CREATED"), eq("API_TOKEN"), any(), metaCaptor.capture());
        assertFalse(metaCaptor.getValue().toString().contains(created.plainTextToken()));
    }

    @Test
    void revokedExpiredOrExhaustedTokenIsRejectedAndQuotaIsEnforced() {
        ApiTokenRepository tokenRepo = mock(ApiTokenRepository.class);
        RepoScanUsageRepository usageRepo = mock(RepoScanUsageRepository.class);
        TenantRepository tenantRepo = mock(TenantRepository.class);
        AuditLogService auditLogService = mock(AuditLogService.class);
        CommercialSaasService saasService = mock(CommercialSaasService.class);

        ApiTokenService service = new ApiTokenService(tokenRepo, usageRepo, tenantRepo, auditLogService);
        ReflectionTestUtils.setField(service, "commercialSaasService", saasService);

        UUID tenantId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID otherAnalystId = UUID.randomUUID();

        String raw = "omega_scan_testtokenvalue1234567890";
        String hash = ApiTokenService.sha256Hex(raw);
        ApiTokenEntity entity = new ApiTokenEntity(
                UUID.randomUUID(), tenantId, ownerId, "cli", "omega_scan_test...", hash,
                "REPO_SCAN", 2, Instant.now().plus(5, ChronoUnit.DAYS), Instant.now());

        when(tokenRepo.findByTokenHash(hash)).thenReturn(Optional.of(entity));
        when(tokenRepo.findByIdAndTenantId(entity.getId(), tenantId)).thenReturn(Optional.of(entity));
        when(tenantRepo.findByIdAndActiveTrue(tenantId)).thenReturn(Optional.of(new TenantEntity("dev", "Dev")));

        assertTrue(service.authenticate(raw).isPresent());

        // Non-owner ANALYST cannot revoke
        assertThrows(AccessDeniedException.class,
                () -> service.revokeToken(tenantId, otherAnalystId, Role.ANALYST, entity.getId()));

        // ADMIN can revoke -> authenticate rejects
        service.revokeToken(tenantId, otherAnalystId, Role.ADMIN, entity.getId());
        assertTrue(service.authenticate(raw).isEmpty());

        // Quota enforcement (PERSONAL = 30)
        SubscriptionEntity sub = new SubscriptionEntity();
        sub.setPlanCode("PERSONAL");
        when(saasService.getOrProvisionSubscription(tenantId)).thenReturn(sub);
        String ym = YearMonth.now(ZoneOffset.UTC).toString();
        when(usageRepo.findByTenantIdAndPeriodYm(tenantId, ym))
                .thenReturn(Optional.of(new RepoScanUsageEntity(UUID.randomUUID(), tenantId, ym, 30, Instant.now())));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> service.consumeScanQuotaAndTokenUse(tenantId, null));
        assertEquals(429, ex.getStatusCode().value());
    }
}
