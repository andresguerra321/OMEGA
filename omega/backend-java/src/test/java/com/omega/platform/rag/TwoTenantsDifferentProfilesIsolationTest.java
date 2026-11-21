package com.omega.platform.rag;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.ingest.AsyncDocumentProcessor;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.AuditLogService;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class TwoTenantsDifferentProfilesIsolationTest {

    @Test
    void twoTenantsWithDifferentProfilesStayIsolatedByTenantAndCorpusScope() {
        ExpedienteAuthorizationService authz = mock(ExpedienteAuthorizationService.class);
        DocumentRepository documentRepository = mock(DocumentRepository.class);
        EmbeddingProvider embeddingProvider = mock(EmbeddingProvider.class);
        HybridRagSearchRepository searchRepository = mock(HybridRagSearchRepository.class);
        RagAnswerGenerator answerGenerator = mock(RagAnswerGenerator.class);
        AuditLogService auditLogService = mock(AuditLogService.class);
        TenantRepository tenantRepository = mock(TenantRepository.class);

        when(embeddingProvider.modelName()).thenReturn("text-embedding-3-small");
        when(searchRepository.searchLexicalOnly(any(), any(), anyString(), any(), anyInt(), anyString(), any()))
                .thenReturn(List.of());
        when(answerGenerator.generateGroundedAnswer(anyString(), any(), any()))
                .thenReturn("Sin evidencia suficiente.");
        when(answerGenerator.resolveActiveGeneratorModel()).thenReturn("mock-model");

        UUID devTenantId = UUID.randomUUID();
        UUID legalTenantId = UUID.randomUUID();
        UUID expDev = UUID.randomUUID();
        UUID expLegal = UUID.randomUUID();

        DocumentEntity devDoc = mock(DocumentEntity.class);
        when(devDoc.getId()).thenReturn(UUID.randomUUID());
        when(devDoc.getStatus()).thenReturn(DocumentStatus.INDEXED);
        when(devDoc.getEmbeddingModel()).thenReturn(AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL);
        when(devDoc.getOriginalFilename()).thenReturn("dev-advisory.pdf");
        when(devDoc.getSha256Hash()).thenReturn("a".repeat(64));

        DocumentEntity legalDoc = mock(DocumentEntity.class);
        when(legalDoc.getId()).thenReturn(UUID.randomUUID());
        when(legalDoc.getStatus()).thenReturn(DocumentStatus.INDEXED);
        when(legalDoc.getEmbeddingModel()).thenReturn(AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL);
        when(legalDoc.getOriginalFilename()).thenReturn("legal-expediente.pdf");
        when(legalDoc.getSha256Hash()).thenReturn("b".repeat(64));

        when(documentRepository.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(devTenantId, expDev))
                .thenReturn(List.of(devDoc));
        when(documentRepository.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(legalTenantId, expLegal))
                .thenReturn(List.of(legalDoc));

        when(tenantRepository.findByIdAndActiveTrue(devTenantId))
                .thenReturn(Optional.of(new TenantEntity("dev-org", "Dev Org", TenantProfile.DEVELOPER)));
        when(tenantRepository.findByIdAndActiveTrue(legalTenantId))
                .thenReturn(Optional.of(new TenantEntity("legal-org", "Legal Org", TenantProfile.LEGAL)));

        HybridRagQueryService service = new HybridRagQueryService(
                authz, documentRepository, embeddingProvider, searchRepository, answerGenerator, auditLogService);
        ReflectionTestUtils.setField(service, "tenantRepository", tenantRepository);

        OmegaPrincipal devPrincipal = new OmegaPrincipal(
                UUID.randomUUID(), devTenantId, "dev@omega.test", Role.ANALYST, false);
        OmegaPrincipal legalPrincipal = new OmegaPrincipal(
                UUID.randomUUID(), legalTenantId, "legal@omega.test", Role.ANALYST, false);

        service.queryExpediente(devPrincipal, expDev,
                new HybridRagQueryService.RagQueryRequest("postinstall script", 5));
        service.queryExpediente(legalPrincipal, expLegal,
                new HybridRagQueryService.RagQueryRequest("cadena de custodia", 5));

        assertNotEquals(devTenantId, legalTenantId);
        verify(authz).requireReadAccess(devPrincipal, expDev);
        verify(authz).requireReadAccess(legalPrincipal, expLegal);
        verify(searchRepository).searchLexicalOnly(eq(devTenantId), eq(expDev), eq("postinstall script"), any(), eq(5), eq("DEVELOPER"), any());
        verify(searchRepository).searchLexicalOnly(eq(legalTenantId), eq(expLegal), eq("cadena de custodia"), any(), eq(5), eq("LEGAL"), any());
    }
}
