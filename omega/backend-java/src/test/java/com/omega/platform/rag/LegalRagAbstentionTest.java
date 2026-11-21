package com.omega.platform.rag;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.omega.platform.domain.*;
import com.omega.platform.ingest.AsyncDocumentProcessor;
import com.omega.platform.repository.*;
import com.omega.platform.security.*;
import com.omega.platform.service.AuditLogService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class LegalRagAbstentionTest {
    @Test void neverCallsGeneratorWithoutRelevantEvidenceAndRejectsUnsupportedAnswerReferences() {
        UUID tenant=UUID.randomUUID(),caseId=UUID.randomUUID(),docId=UUID.randomUUID();
        var auth=mock(ExpedienteAuthorizationService.class); var documents=mock(DocumentRepository.class);
        var embeddings=mock(EmbeddingProvider.class); var search=mock(HybridRagSearchRepository.class);
        var generator=mock(RagAnswerGenerator.class); var tenants=mock(TenantRepository.class);
        when(tenants.findByIdAndActiveTrue(tenant)).thenReturn(Optional.of(new TenantEntity("synthetic","Synthetic",TenantProfile.LEGAL)));
        when(embeddings.modelName()).thenReturn("synthetic-model");
        var document=mock(DocumentEntity.class); when(document.getId()).thenReturn(docId);
        when(document.getStatus()).thenReturn(DocumentStatus.INDEXED);
        when(document.getEmbeddingModel()).thenReturn(AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL);
        when(document.getSha256Hash()).thenReturn("a".repeat(64));
        when(documents.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(tenant,caseId)).thenReturn(List.of(document));
        when(search.searchLexicalOnly(any(),any(),anyString(),any(),anyInt(),anyString(),any())).thenReturn(List.of());
        var service=new HybridRagQueryService(auth,documents,embeddings,search,generator,mock(AuditLogService.class));
        ReflectionTestUtils.setField(service,"tenantRepository",tenants);
        var actor=new OmegaPrincipal(UUID.randomUUID(),tenant,"synthetic@example.invalid",Role.CLIENT,true);
        var request=new HybridRagQueryService.RagQueryRequest("contrato",5,"SYNTHETIC_FOREIGN_CONTEXT");
        var empty=service.queryExpediente(actor,caseId,request);
        assertThat(empty.answer()).isEqualTo(HybridRagQueryService.LEGAL_ABSTENTION);
        assertThat(empty.citations()).isEmpty(); verifyNoInteractions(generator);
        var irrelevant=new RagAnswerGenerator.RankedChunk(docId,"synthetic-private.pdf","a".repeat(64),1,"Synthetic",0,"UNRELATED_MARKER",0.1,0,0.1);
        when(search.searchLexicalOnly(any(),any(),anyString(),any(),anyInt(),anyString(),any())).thenReturn(List.of(irrelevant));
        assertThat(service.queryExpediente(actor,caseId,request).answer()).isEqualTo(HybridRagQueryService.LEGAL_ABSTENTION);
        verifyNoInteractions(generator);
        var relevant=new RagAnswerGenerator.RankedChunk(docId,"synthetic-private.pdf","a".repeat(64),2,"Synthetic",0,"El contrato sintético menciona un monto de prueba.",0,1,0.2);
        when(search.searchLexicalOnly(any(),any(),anyString(),any(),anyInt(),anyString(),any())).thenReturn(List.of(relevant));
        when(generator.generateGroundedAnswer(anyString(),anyList(),any())).thenReturn("UNSUPPORTED_MODEL_CLAIM [99]");
        var grounded=service.queryExpediente(actor,caseId,request);
        assertThat(grounded.answer()).contains("[1]","Pág. 2",docId.toString(),"contrato sintético")
                .doesNotContain("UNSUPPORTED_MODEL_CLAIM","SYNTHETIC_FOREIGN_CONTEXT","synthetic-private.pdf");
        assertThat(grounded.citations().getFirst().documentId()).isEqualTo(docId);
        verify(generator).generateGroundedAnswer(eq("contrato"),anyList(),argThat(context -> !context.contains("SYNTHETIC_FOREIGN_CONTEXT")));
    }
}
