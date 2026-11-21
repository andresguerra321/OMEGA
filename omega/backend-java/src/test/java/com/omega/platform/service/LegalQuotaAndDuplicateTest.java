package com.omega.platform.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.omega.platform.config.LegalQuotaProperties;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.saas.SubscriptionEntity;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

/**
 * Q8: Verifica cuotas por plan configurables, rate limiting con reserva reversible
 * y vista de administrador de documentos en fallo/atascados sin contenido ni nombres de archivo.
 */
class LegalQuotaAndDuplicateTest {

    @Test
    void enforcesConfigurableUploadAndQueryRateLimitsAndReversesFailedReservations() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID caseId = UUID.randomUUID();

        var props = new LegalQuotaProperties();
        props.getPlans().get("PERSONAL").setUploadPerMinute(1);
        props.getPlans().get("PERSONAL").setQueryPerMinute(1);
        props.getPlans().get("PERSONAL").setMaxDocumentsPerCase(2);
        props.getPlans().get("PERSONAL").setMaxConcurrentIndexing(2);

        var docRepo = mock(DocumentRepository.class);
        var tenantRepo = mock(TenantRepository.class);
        var saas = mock(CommercialSaasService.class);
        var sub = new SubscriptionEntity();
        sub.setPlanCode("PERSONAL");
        when(saas.getOrProvisionSubscription(tenantId)).thenReturn(sub);
        when(tenantRepo.findByIdAndActiveTrue(tenantId))
                .thenReturn(Optional.of(new TenantEntity("quota-law", "Quota Law", TenantProfile.LEGAL)));
        when(docRepo.countByTenantIdAndStatus(tenantId, DocumentStatus.PROCESSING)).thenReturn(0L);
        when(docRepo.countByTenantIdAndExpedienteIdAndStatusIn(eq(tenantId), eq(caseId), any())).thenReturn(0L);

        var service = new LegalQuotaService(props, docRepo, tenantRepo, saas);
        var admin = new OmegaPrincipal(userId, tenantId, "admin@quota.invalid", Role.ADMIN, true);

        // 1. Reserva y reversión tras fallo: el cupo debe quedar libre de nuevo
        var res1 = service.reserveUploadSlot(admin, caseId);
        service.releaseUploadReservation(res1);

        var res2 = service.reserveUploadSlot(admin, caseId);
        service.commitUploadReservation(res2);

        // 2. Segunda carga en el mismo minuto excede uploadPerMinute=1 -> 429
        assertThatThrownBy(() -> service.reserveUploadSlot(admin, caseId))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("límite de cargas por minuto");

        // 3. Consulta dentro de límite y segunda consulta excede queryPerMinute=1 -> 429
        service.checkQueryRate(admin);
        assertThatThrownBy(() -> service.checkQueryRate(admin))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("límite de consultas por minuto");
    }

    @Test
    void adminIssuesViewListsFailedAndStuckDocumentsWithoutFilenamesAndDeniesNonAdmin() {
        UUID tenantId = UUID.randomUUID();
        UUID adminId = UUID.randomUUID();
        UUID caseId = UUID.randomUUID();

        var props = new LegalQuotaProperties();
        props.setStuckProcessingMinutes(10);

        var failed = new DocumentEntity(tenantId, caseId, adminId, "CONFIDENCIAL_CLIENTE_SECRETO.pdf",
                "a".repeat(64), 0, "lexical-only-tsvector", false, DocumentStatus.FAILED);
        ReflectionTestUtils.setField(failed, "id", UUID.randomUUID());
        failed.setFailureCode("TEXT_UNAVAILABLE");

        var stuck = new DocumentEntity(tenantId, caseId, adminId, "OTRO_SECRETO.pdf",
                "b".repeat(64), 0, "lexical-only-tsvector", false, DocumentStatus.PROCESSING);
        ReflectionTestUtils.setField(stuck, "id", UUID.randomUUID());
        ReflectionTestUtils.setField(stuck, "createdAt", Instant.now().minusSeconds(1200));

        var docRepo = mock(DocumentRepository.class);
        when(docRepo.findAllByTenantIdAndStatusInOrderByCreatedAtDesc(eq(tenantId), any()))
                .thenReturn(List.of(failed, stuck));

        var service = new LegalQuotaService(props, docRepo, mock(TenantRepository.class), mock(CommercialSaasService.class));
        var admin = new OmegaPrincipal(adminId, tenantId, "admin@law.invalid", Role.ADMIN, true);
        var analyst = new OmegaPrincipal(UUID.randomUUID(), tenantId, "analyst@law.invalid", Role.ANALYST, true);

        assertThatThrownBy(() -> service.listAdminDocumentIssues(analyst))
                .isInstanceOf(AccessDeniedException.class);

        var issues = service.listAdminDocumentIssues(admin);
        assertThat(issues).hasSize(2);
        assertThat(issues.get(0).failureCode()).isEqualTo("TEXT_UNAVAILABLE");
        assertThat(issues.get(1).stuck()).isTrue();
        assertThat(issues.get(1).failureCode()).isEqualTo("PROCESSING_STUCK");
        assertThat(issues.toString()).doesNotContain("CONFIDENCIAL_CLIENTE_SECRETO").doesNotContain("OTRO_SECRETO");
    }
}
