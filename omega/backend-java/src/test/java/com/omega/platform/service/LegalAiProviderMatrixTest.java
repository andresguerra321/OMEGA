package com.omega.platform.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.DocumentChunkEntity;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.ingest.AsyncDocumentProcessor;
import com.omega.platform.rag.EmbeddingException;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.rag.RagAnswerGenerator;
import com.omega.platform.repository.DocumentChunkRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Q2: Verifica la matriz de proveedores de IA para perfil LEGAL:
 * - Groq sin clave OpenAI (fallback lexical-only-tsvector + destino Groq)
 * - OpenAI (embeddings + respuestas hacia api.openai.com)
 * - Ollama local (embeddings + respuestas LOCAL)
 * - Reindexación desde fragmentos guardados sin volver a subir el PDF
 * - No divulgación de claves en política ni auditoría
 */
class LegalAiProviderMatrixTest {

    private static final String GROQ_SECRET = "gsk_synthetic_never_leak_999999999";
    private static final String OPENAI_SECRET = "sk-synthetic-never-leak-888888888";

    @Test
    void groqWithoutOpenAiKeyDisclosesLocalTextIndexingAndGroqResponsesWithoutLeakingKey() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID adminId = UUID.randomUUID();
        var props = mockProps("openai", "", "https://api.openai.com/v1", GROQ_SECRET, "https://api.groq.com/openai/v1", "http://localhost:11434");
        var embeddings = mock(EmbeddingProvider.class);
        when(embeddings.modelName()).thenReturn("text-embedding-3-small");
        when(embeddings.dimensions()).thenReturn(1536);
        var answers = mock(RagAnswerGenerator.class);
        var tenants = mock(TenantRepository.class);
        when(tenants.findByIdAndActiveTrue(tenantId)).thenReturn(Optional.of(new TenantEntity("groq-law", "Groq Law", TenantProfile.LEGAL)));
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), eq(tenantId))).thenReturn(List.of());

        var service = new LegalDocumentAiService(props, embeddings, answers, tenants,
                mock(DocumentRepository.class), mock(DocumentChunkRepository.class),
                mock(ExpedienteAuthorizationService.class), jdbc, new ObjectMapper(), mock(AuditLogService.class));

        var admin = new OmegaPrincipal(adminId, tenantId, "admin@groq.invalid", Role.ADMIN, true);
        TenantContext.set(new TenantScope(tenantId, adminId, Role.ADMIN));
        try {
            var policy = service.policy(admin);
            assertThat(policy.accepted()).isFalse();
            assertThat(policy.disclosure().indexing().provider()).isEqualTo("LOCAL_TEXT");
            assertThat(policy.disclosure().indexing().model()).isEqualTo(AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL);
            assertThat(policy.disclosure().indexing().destination()).isEqualTo("LOCAL");
            assertThat(policy.disclosure().responses()).anySatisfy(t -> {
                assertThat(t.provider()).isEqualTo("GROQ");
                assertThat(t.destination()).isEqualTo("https://api.groq.com");
            });
            String serialized = new ObjectMapper().writeValueAsString(policy);
            assertThat(serialized).doesNotContain(GROQ_SECRET);
        } finally {
            TenantContext.clear();
        }
    }

    @Test
    void openAiAndOllamaDiscloseExactDestinationsAndReindexFromSavedChunksWithoutReuploadingPdf() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID adminId = UUID.randomUUID();
        UUID caseId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();

        var propsOpenAi = mockProps("openai", OPENAI_SECRET, "https://api.openai.com/v1", "", "", "http://localhost:11434");
        var propsOllama = mockProps("ollama", "", "", "", "", "http://127.0.0.1:11434");
        var embeddings = mock(EmbeddingProvider.class);
        when(embeddings.modelName()).thenReturn("text-embedding-3-small");
        when(embeddings.dimensions()).thenReturn(1536);
        when(embeddings.embedBatch(anyList())).thenReturn(List.of(new float[1536]));
        var answers = mock(RagAnswerGenerator.class);
        when(answers.resolveActiveGeneratorModel()).thenReturn("llama3.2");

        var tenants = mock(TenantRepository.class);
        when(tenants.findByIdAndActiveTrue(tenantId)).thenReturn(Optional.of(new TenantEntity("multi-law", "Multi Law", TenantProfile.LEGAL)));

        var docRepo = mock(DocumentRepository.class);
        var chunkRepo = mock(DocumentChunkRepository.class);
        var doc = new DocumentEntity(tenantId, caseId, adminId, "synthetic.pdf", "b".repeat(64), 1,
                AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL, false, DocumentStatus.INDEXED);
        org.springframework.test.util.ReflectionTestUtils.setField(doc, "id", docId);
        var chunk = new DocumentChunkEntity(tenantId, docId, caseId,
                "Texto sintético conservado para reindexación.", new float[1536], 1, "Sección 1", 0, 10,
                AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL);
        when(docRepo.findScopedForUpdate(docId, tenantId)).thenReturn(Optional.of(doc));
        when(chunkRepo.findAllByTenantIdAndDocumentIdOrderByChunkOrderAsc(tenantId, docId)).thenReturn(List.of(chunk));

        String[] acceptedHash = {null};
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), eq(tenantId)))
                .thenAnswer(inv -> acceptedHash[0] == null ? List.of() : List.of(acceptedHash[0]));

        var openAiService = new LegalDocumentAiService(propsOpenAi, embeddings, answers, tenants,
                docRepo, chunkRepo, mock(ExpedienteAuthorizationService.class), jdbc, new ObjectMapper(), mock(AuditLogService.class));
        var ollamaService = new LegalDocumentAiService(propsOllama, embeddings, answers, tenants,
                docRepo, chunkRepo, mock(ExpedienteAuthorizationService.class), jdbc, new ObjectMapper(), mock(AuditLogService.class));

        var admin = new OmegaPrincipal(adminId, tenantId, "admin@multi.invalid", Role.ADMIN, true);
        TenantContext.set(new TenantScope(tenantId, adminId, Role.ADMIN));
        try {
            // OpenAI disclosure + reindex from saved chunks
            var openAiPolicy = openAiService.policy(admin);
            assertThat(openAiPolicy.disclosure().indexing().provider()).isEqualTo("OPENAI");
            assertThat(openAiPolicy.disclosure().indexing().destination()).isEqualTo("https://api.openai.com");
            assertThat(new ObjectMapper().writeValueAsString(openAiPolicy)).doesNotContain(OPENAI_SECRET);
            acceptedHash[0] = openAiPolicy.fingerprint();

            var reindexedOpenAi = openAiService.reindex(admin, caseId, docId);
            assertThat(reindexedOpenAi.sha256Hash()).isEqualTo("b".repeat(64));
            assertThat(reindexedOpenAi.embeddingModel()).isEqualTo("text-embedding-3-small");

            // Switch to Ollama local -> invalidates previous OpenAI consent, discloses LOCAL, reindexes cleanly
            when(embeddings.modelName()).thenReturn("nomic-embed-text");
            var ollamaPolicy = ollamaService.policy(admin);
            assertThat(ollamaPolicy.accepted()).isFalse();
            assertThat(ollamaPolicy.disclosure().indexing().provider()).isEqualTo("OLLAMA");
            assertThat(ollamaPolicy.disclosure().indexing().destination()).isEqualTo("LOCAL");
            assertThat(ollamaPolicy.disclosure().responses().getFirst().provider()).isEqualTo("OLLAMA");
            assertThat(ollamaPolicy.disclosure().responses().getFirst().destination()).isEqualTo("LOCAL");
            acceptedHash[0] = ollamaPolicy.fingerprint();

            // Even if embedding call fails with EmbeddingException, reindex degrades safely to lexical fallback
            when(embeddings.embedBatch(anyList())).thenThrow(new EmbeddingException("offline"));
            var reindexedFallback = ollamaService.reindex(admin, caseId, docId);
            assertThat(reindexedFallback.sha256Hash()).isEqualTo("b".repeat(64));
            assertThat(reindexedFallback.embeddingModel()).isEqualTo(AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL);
        } finally {
            TenantContext.clear();
        }
    }

    private static OmegaProperties mockProps(
            String provider,
            String openAiKey,
            String openAiUrl,
            String groqKey,
            String groqUrl,
            String ollamaUrl
    ) {
        var props = mock(OmegaProperties.class);
        var rag = mock(OmegaProperties.Rag.class);
        var ai = mock(OmegaProperties.Ai.class);
        var ollama = mock(OmegaProperties.Ollama.class);
        when(props.rag()).thenReturn(rag);
        when(props.ai()).thenReturn(ai);
        when(ai.provider()).thenReturn(provider);
        when(ai.ollama()).thenReturn(ollama);
        when(ollama.baseUrl()).thenReturn(ollamaUrl);
        when(rag.openAiApiKey()).thenReturn(openAiKey);
        when(rag.openAiBaseUrl()).thenReturn(openAiUrl);
        when(rag.chatModel()).thenReturn("gpt-4o-mini");
        when(rag.groqApiKey()).thenReturn(groqKey);
        when(rag.groqBaseUrl()).thenReturn(groqUrl);
        when(rag.groqModel()).thenReturn("openai/gpt-oss-120b");
        when(rag.customChatBaseUrl()).thenReturn("");
        when(rag.omniRouteBaseUrl()).thenReturn("");
        return props;
    }
}
