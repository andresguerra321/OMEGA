package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.repository.DocumentRepository;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
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

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HybridRagQueryTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static Path sharedTempDir;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (sharedTempDir == null) {
            sharedTempDir = Files.createTempDirectory("omega-rag-query-test-");
        }
        registry.add("omega.ingest.temp-dir", () -> sharedTempDir.toAbsolutePath().toString());

        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            pgContainer = new PostgreSQLContainer<>(
                    DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_rag_test")
                    .withUsername("omega_test")
                    .withPassword("omega_test_secret");
            pgContainer.start();
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

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private DocumentRepository documentRepository;

    @MockBean
    private EmbeddingProvider embeddingProvider;

    @Test
    void enforcesHybridSearchTenantExpedienteIsolationCitationsAndModelDriftReindexWarning() throws Exception {
        final String[] activeModelHolder = {"text-embedding-3-small"};
        when(embeddingProvider.modelName()).thenAnswer(inv -> activeModelHolder[0]);
        when(embeddingProvider.dimensions()).thenReturn(1536);
        when(embeddingProvider.embedBatch(anyList())).thenAnswer(inv -> {
            @SuppressWarnings("unchecked")
            var texts = (java.util.List<String>) inv.getArgument(0);
            return texts.stream().map(HybridRagQueryTest::semanticVector).toList();
        });
        when(embeddingProvider.embedQuery(anyString())).thenAnswer(inv -> semanticVector(inv.getArgument(0)));

        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode tenantA = registerTenant("rag-alpha-" + suffix, "RAG Alpha", "alpha@" + suffix + ".org");
        JsonNode tenantB = registerTenant("rag-bravo-" + suffix, "RAG Bravo", "bravo@" + suffix + ".org");
        String tokenA = tenantA.get("accessToken").asText();
        String tokenB = tenantB.get("accessToken").asText();

        UUID expA1 = createExpediente(tokenA, "Expediente Predator A1");
        UUID expA2 = createExpediente(tokenA, "Expediente Privado A2");
        UUID expB1 = createExpediente(tokenB, "Expediente Candiru B1");

        // Subir PDFs distintos en A1, A2 y B1
        UUID docA1 = uploadPdfAndWaitIndexed(
                tokenA, expA1, "predator-cytrox.pdf",
                "1. Infraestructura Cytrox Predator",
                "La campaña Predator operada por Intellexa emplea el dominio liink.info y la IP 176.223.111.131."
        );
        uploadPdfAndWaitIndexed(
                tokenA, expA2, "secreto-a2.pdf",
                "2. Notas Internas A2",
                "MARCADOR_EXCLUSIVO_EXPEDIENTE_A2 que nunca debe aparecer en consultas de A1."
        );
        uploadPdfAndWaitIndexed(
                tokenB, expB1, "candiru-b1.pdf",
                "3. Hallazgo Candiru B1",
                "MARCADOR_EXCLUSIVO_TENANT_B sobre DevilsTongue y wmiutils.dll."
        );

        // 1. Consulta híbrida sobre expA1: citas estrictas, cero fugas de expA2 o tenantB
        MvcResult queryRes = mockMvc.perform(post("/api/v1/expedientes/" + expA1 + "/query")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "question": "¿Qué infraestructura utiliza Predator e Intellexa?", "topK": 5 }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OK"))
                .andExpect(jsonPath("$.citations.length()").value(1))
                .andReturn();

        JsonNode body = objectMapper.readTree(queryRes.getResponse().getContentAsString(StandardCharsets.UTF_8));
        JsonNode citation = body.get("citations").get(0);
        assertThat(citation.get("originalFilename").asText()).isEqualTo("predator-cytrox.pdf");
        assertThat(citation.get("sha256Hash").asText()).matches("^[0-9a-f]{64}$");
        assertThat(citation.get("pageNumber").asInt()).isEqualTo(1);
        assertThat(citation.get("citationLabel").asText())
                .isEqualTo("[Documento: predator-cytrox.pdf | Pág. 1 | Sección: 1. Infraestructura Cytrox Predator]");
        assertThat(body.get("answer").asText())
                .contains("[Documento: predator-cytrox.pdf | Pág. 1 | Sección: 1. Infraestructura Cytrox Predator]")
                .doesNotContain("MARCADOR_EXCLUSIVO_EXPEDIENTE_A2")
                .doesNotContain("MARCADOR_EXCLUSIVO_TENANT_B");

        // Tenant B intentando consultar Expediente A1 recibe 404
        mockMvc.perform(post("/api/v1/expedientes/" + expA1 + "/query")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "question": "Predator", "topK": 3 }
                                """))
                .andExpect(status().isNotFound());

        // 2. Simular cambio de modelo de embeddings -> debe marcar REINDEX_REQUIRED y advertir al cliente
        activeModelHolder[0] = "local-bge-m3-phase2";
        MvcResult driftRes = mockMvc.perform(post("/api/v1/expedientes/" + expA1 + "/query")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "question": "¿Qué infraestructura utiliza Predator?", "topK": 5 }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REINDEX_REQUIRED"))
                .andExpect(jsonPath("$.reindexRequiredDocuments.length()").value(1))
                .andReturn();

        JsonNode driftJson = objectMapper.readTree(driftRes.getResponse().getContentAsString(StandardCharsets.UTF_8));
        assertThat(driftJson.get("reindexRequiredDocuments").get(0).get("indexedEmbeddingModel").asText())
                .isEqualTo("text-embedding-3-small");
        assertThat(driftJson.get("reindexRequiredDocuments").get(0).get("activeEmbeddingModel").asText())
                .isEqualTo("local-bge-m3-phase2");
        assertThat(driftJson.get("warnings").get(0).asText()).contains("Zero-Retention");
        assertThat(documentRepository.findById(docA1).orElseThrow().getStatus())
                .isEqualTo(DocumentStatus.REINDEX_REQUIRED);
    }

    private UUID uploadPdfAndWaitIndexed(
            String token,
            UUID expId,
            String filename,
            String section,
            String text
    ) throws Exception {
        byte[] pdfBytes;
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                cs.newLineAtOffset(45, 730);
                cs.showText(section);
                cs.newLineAtOffset(0, -22);
                cs.showText(text);
                cs.endText();
            }
            doc.save(baos);
            pdfBytes = baos.toByteArray();
        }

        MvcResult up = mockMvc.perform(multipart("/api/v1/expedientes/" + expId + "/documents")
                        .file(new MockMultipartFile("file", filename, MediaType.APPLICATION_PDF_VALUE, pdfBytes))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isAccepted())
                .andReturn();

        UUID docId = UUID.fromString(objectMapper.readTree(up.getResponse().getContentAsString()).get("id").asText());
        long deadline = System.currentTimeMillis() + 12_000;
        while (System.currentTimeMillis() < deadline) {
            MvcResult st = mockMvc.perform(get("/api/v1/expedientes/" + expId + "/documents/" + docId)
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                    .andExpect(status().isOk())
                    .andReturn();
            if ("INDEXED".equals(objectMapper.readTree(st.getResponse().getContentAsString()).get("status").asText())) {
                return docId;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Timeout indexando " + filename);
    }

    private JsonNode registerTenant(String slug, String name, String email) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantSlug": "%s",
                                  "tenantName": "%s",
                                  "adminEmail": "%s",
                                  "adminPassword": "ClaveSuperSegura2026!",
                                  "adminFullName": "Admin Test"
                                }
                                """.formatted(slug, name, email)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString());
    }

    private UUID createExpediente(String token, String title) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/expedientes")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "title": "%s", "classification": "CONFIDENTIAL" }
                                """.formatted(title)))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText());
    }

    private static float[] semanticVector(String text) {
        float[] vec = new float[1536];
        Arrays.fill(vec, 0.01f);
        String low = text.toLowerCase();
        if (low.contains("predator") || low.contains("intellexa")) {
            vec[0] = 0.9f;
        }
        if (low.contains("candiru")) {
            vec[1] = 0.9f;
        }
        return vec;
    }
}
