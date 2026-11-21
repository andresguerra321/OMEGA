package com.omega.platform.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.*;
import com.omega.platform.repository.*;
import com.omega.platform.rag.*;
import com.omega.platform.security.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class LegalDocumentAiPolicyTest {
    @Test void changingIndexingModelInvalidatesConsentWithoutDisclosingKeys() throws Exception {
        var properties=mock(OmegaProperties.class); var rag=mock(OmegaProperties.Rag.class); var ai=mock(OmegaProperties.Ai.class);
        when(properties.ai()).thenReturn(ai); when(properties.rag()).thenReturn(rag);
        when(rag.openAiApiKey()).thenReturn("synthetic-secret-never-disclose"); when(rag.openAiBaseUrl()).thenReturn("https://api.openai.com/v1");
        var embeddings=mock(EmbeddingProvider.class); when(embeddings.modelName()).thenReturn("model-one");
        var tenants=mock(TenantRepository.class); var jdbc=mock(JdbcTemplate.class); UUID tenant=UUID.randomUUID(),user=UUID.randomUUID();
        when(tenants.findByIdAndActiveTrue(tenant)).thenReturn(Optional.of(new TenantEntity("synthetic","Synthetic",TenantProfile.LEGAL)));
        String[] accepted={null};
        when(jdbc.queryForList(anyString(),eq(String.class),eq(tenant))).thenAnswer(inv -> accepted[0]==null ? List.of() : List.of(accepted[0]));
        var mapper=new ObjectMapper(); var service=new LegalDocumentAiService(properties,embeddings,mock(RagAnswerGenerator.class),tenants,
                mock(DocumentRepository.class),mock(DocumentChunkRepository.class),mock(ExpedienteAuthorizationService.class),jdbc,mapper,mock(AuditLogService.class));
        var actor=new OmegaPrincipal(user,tenant,"synthetic@example.invalid",Role.ADMIN,true);
        TenantContext.set(new TenantScope(tenant,user,Role.ADMIN));
        try {
            var first=service.policy(actor); assertThat(first.accepted()).isFalse(); accepted[0]=first.fingerprint();
            assertThat(service.policy(actor).accepted()).isTrue();
            when(embeddings.modelName()).thenReturn("model-two");
            var changed=service.policy(actor); assertThat(changed.accepted()).isFalse();
            assertThat(changed.fingerprint()).isNotEqualTo(first.fingerprint());
            assertThat(mapper.writeValueAsString(changed)).doesNotContain("synthetic-secret-never-disclose");
            assertThatThrownBy(() -> service.requireIndexedImageForLegal(actor)).isInstanceOf(ConflictException.class);
            when(tenants.findByIdAndActiveTrue(tenant)).thenReturn(Optional.of(new TenantEntity("synthetic","Synthetic",TenantProfile.GENERAL)));
            assertThatCode(() -> service.requireIndexedImageForLegal(actor)).doesNotThrowAnyException();
        } finally { TenantContext.clear(); }
    }
}
