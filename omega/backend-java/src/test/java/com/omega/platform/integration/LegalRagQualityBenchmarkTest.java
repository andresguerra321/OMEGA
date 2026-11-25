package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.rag.EmbeddingException;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.rag.HybridRagQueryService;
import com.omega.platform.rag.RagAnswerGenerator;
import com.omega.platform.repository.DocumentRepository;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Q7: Benchmark reproducible de calidad del asistente LEGAL sobre corpus sintético.
 * Mide fidelidad a fuentes, exactitud de cita (documento + página), tasa de abstención correcta,
 * tasa de respuestas sin sustento y fuga entre expedientes. Falla ante cualquier regresión por debajo de los umbrales.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@org.springframework.context.annotation.Import(PaidWorkspaceFixture.class)
class LegalRagQualityBenchmarkTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static Path sharedTempDir;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (sharedTempDir == null) {
            sharedTempDir = Files.createTempDirectory("omega-legal-bench-");
        }
        registry.add("omega.ingest.temp-dir", () -> sharedTempDir.toAbsolutePath().toString());
        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            @SuppressWarnings("resource")
            PostgreSQLContainer<?> container = new PostgreSQLContainer<>(
                    DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_rag_test")
                    .withUsername("omega_test")
                    .withPassword("omega_test_secret");
            container.start();
            pgContainer = container;
        }
        String baseUrl = pgContainer.getJdbcUrl();
        String sep = baseUrl.contains("?") ? "&" : "?";
        registry.add("spring.datasource.url", () -> baseUrl + sep + "currentSchema=omega_rag,public");
        registry.add("spring.datasource.username", pgContainer::getUsername);
        registry.add("spring.datasource.password", pgContainer::getPassword);
    }

    private static String envOrDefault(String key, String fallback) {
        String val = System.getenv(key);
        return (val == null || val.isBlank()) ? fallback : val;
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private DocumentRepository documentRepository;

    @MockBean private EmbeddingProvider embeddingProvider;
    @MockBean private RagAnswerGenerator answerGenerator;

    @Test
    void meetsQualityThresholdsForFidelityCitationExactnessAbstentionAndZeroCrossCaseLeakage() throws Exception {
        // Modo léxico determinista (simula despliegue sin clave OpenAI / reproducible 100% sin red)
        when(embeddingProvider.modelName()).thenReturn("text-embedding-3-small");
        when(embeddingProvider.dimensions()).thenReturn(1536);
        when(embeddingProvider.embedBatch(anyList())).thenThrow(new EmbeddingException("deterministic-lexical-benchmark"));
        when(embeddingProvider.embedQuery(anyString())).thenThrow(new EmbeddingException("deterministic-lexical-benchmark"));
        when(answerGenerator.resolveActiveGeneratorModel()).thenReturn("omega-benchmark-grounded");
        when(answerGenerator.generateGroundedAnswer(anyString(), anyList(), any())).thenAnswer(inv -> {
            List<RagAnswerGenerator.RankedChunk> chunks = inv.getArgument(1);
            if (chunks == null || chunks.isEmpty()) return HybridRagQueryService.LEGAL_ABSTENTION;
            return "Según la evidencia recuperada: " + chunks.getFirst().content() + " [1]";
        });

        JsonNode fixture = objectMapper.readTree(new ClassPathResource("legal_benchmark/synthetic_cases.json").getInputStream());
        JsonNode thresholds = fixture.path("thresholds");

        String slug = "bench-" + UUID.randomUUID().toString().substring(0, 8);
        String token = registerLegalTenant(slug, "bench@" + slug + ".invalid");
        acceptConsent(token);

        Map<String, UUID> caseIds = new HashMap<>();
        Map<String, UUID> docIds = new HashMap<>();

        for (JsonNode caseNode : fixture.path("cases")) {
            UUID caseId = createCase(token, caseNode.path("title").asText());
            caseIds.put(caseNode.path("key").asText(), caseId);
            for (JsonNode docNode : caseNode.path("documents")) {
                List<String> pages = new java.util.ArrayList<>();
                docNode.path("pages").forEach(p -> pages.add(p.asText()));
                UUID docId = uploadMultiPagePdfAndWait(token, caseId, docNode.path("filename").asText(), pages);
                docIds.put(docNode.path("key").asText(), docId);
            }
        }

        int answerableTotal = 0, fidelityHits = 0, exactCitationHits = 0;
        int abstentionExpectedTotal = 0, abstentionCorrectHits = 0;
        int crossCaseTotal = 0, crossCaseLeaks = 0;
        int unsupportedAnswers = 0;

        for (JsonNode qNode : fixture.path("questions")) {
            String category = qNode.path("category").asText();
            UUID caseId = caseIds.get(qNode.path("caseKey").asText());
            String question = qNode.path("question").asText();

            MvcResult res = mockMvc.perform(post("/api/v1/expedientes/" + caseId + "/query").with(csrf())
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("question", question, "topK", 5))))
                    .andExpect(status().isOk())
                    .andReturn();

            JsonNode body = objectMapper.readTree(res.getResponse().getContentAsString());
            String answer = body.path("answer").asText();
            JsonNode citations = body.path("citations");

            if ("ANSWERABLE".equals(category)) {
                answerableTotal++;
                UUID expectedDoc = docIds.get(qNode.path("expectedDocKey").asText());
                int expectedPage = qNode.path("expectedPage").asInt();
                String expectedTerm = qNode.path("expectedTerm").asText();

                boolean faithful = answer.contains(expectedTerm) && answer.contains("No es asesoría legal.") && answer.contains("[1]");
                if (faithful) fidelityHits++;
                else unsupportedAnswers++;

                boolean exactCitation = false;
                for (JsonNode c : citations) {
                    if (expectedDoc.toString().equals(c.path("documentId").asText())
                            && c.path("pageNumber").asInt() == expectedPage) {
                        exactCitation = true;
                        break;
                    }
                }
                if (exactCitation) exactCitationHits++;
            } else {
                abstentionExpectedTotal++;
                boolean abstained = HybridRagQueryService.LEGAL_ABSTENTION.equals(answer) && citations.isEmpty();
                if (abstained) abstentionCorrectHits++;
                else unsupportedAnswers++;

                if ("CROSS_CASE".equals(category)) {
                    crossCaseTotal++;
                    String forbidden = qNode.path("forbiddenTerm").asText();
                    if (answer.contains(forbidden)) {
                        crossCaseLeaks++;
                    }
                }
            }
        }

        double fidelityRate = (double) fidelityHits / answerableTotal;
        double citationExactnessRate = (double) exactCitationHits / answerableTotal;
        double abstentionRate = (double) abstentionCorrectHits / abstentionExpectedTotal;
        double unsupportedRate = (double) unsupportedAnswers / (answerableTotal + abstentionExpectedTotal);
        double leakageRate = (double) crossCaseLeaks / crossCaseTotal;

        assertThat(fidelityRate)
                .as("Fidelidad a las fuentes (actual=%.2f)", fidelityRate)
                .isGreaterThanOrEqualTo(thresholds.path("minSourceFidelity").asDouble());
        assertThat(citationExactnessRate)
                .as("Exactitud de cita documento+página (actual=%.2f)", citationExactnessRate)
                .isGreaterThanOrEqualTo(thresholds.path("minCitationExactness").asDouble());
        assertThat(abstentionRate)
                .as("Tasa de abstención correcta (actual=%.2f)", abstentionRate)
                .isGreaterThanOrEqualTo(thresholds.path("minCorrectAbstention").asDouble());
        assertThat(unsupportedRate)
                .as("Tasa de respuestas sin sustento (actual=%.2f)", unsupportedRate)
                .isLessThanOrEqualTo(thresholds.path("maxUnsupportedRate").asDouble());
        assertThat(leakageRate)
                .as("Tasa de fuga entre expedientes (actual=%.2f)", leakageRate)
                .isLessThanOrEqualTo(thresholds.path("maxCrossCaseLeakage").asDouble());
    }

    private String registerLegalTenant(String slug, String email) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"tenantName\":\"Benchmark " + slug + "\","
                                + "\"adminEmail\":\"" + email + "\",\"adminPassword\":\"OmegaBench!2026\","
                                + "\"adminFullName\":\"Benchmark Admin\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String token = objectMapper.readTree(res.getResponse().getContentAsString()).path("accessToken").asText();
        mockMvc.perform(put("/api/v1/profile").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isOk());
        return token;
    }

    private void acceptConsent(String adminToken) throws Exception {
        MvcResult policy = mockMvc.perform(get("/api/v1/legal/document-ai/policy")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn();
        String fp = objectMapper.readTree(policy.getResponse().getContentAsString()).path("fingerprint").asText();
        mockMvc.perform(post("/api/v1/legal/document-ai/consent").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fingerprint\":\"" + fp + "\"}"))
                .andExpect(status().isNoContent());
    }

    private UUID createCase(String token, String title) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/expedientes").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("title", title, "classification", "CONFIDENTIAL"))))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).path("id").asText());
    }

    private UUID uploadMultiPagePdfAndWait(String token, UUID caseId, String filename, List<String> pages) throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", filename, "application/pdf", buildMultiPagePdf(pages));
        MvcResult res = mockMvc.perform(multipart("/api/v1/expedientes/" + caseId + "/documents")
                        .file(file)
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isAccepted())
                .andReturn();
        UUID docId = UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).path("id").asText());
        long deadline = System.currentTimeMillis() + 15000;
        while (System.currentTimeMillis() < deadline) {
            var opt = documentRepository.findById(docId);
            if (opt.isPresent() && opt.get().getStatus() == DocumentStatus.INDEXED) {
                return docId;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Documento sintético de benchmark no terminó de indexar: " + docId);
    }

    private static byte[] buildMultiPagePdf(List<String> pages) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (String pageText : pages) {
                PDPage page = new PDPage();
                doc.addPage(page);
                try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                    cs.beginText();
                    cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                    cs.newLineAtOffset(50, 700);
                    cs.showText(pageText.replaceAll("[^\\x20-\\x7EáéíóúÁÉÍÓÚñÑ¿¡]", " "));
                    cs.endText();
                }
            }
            doc.save(out);
            return out.toByteArray();
        }
    }
}
