package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DocumentChunkEntity;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.ingest.AsyncDocumentProcessor;
import com.omega.platform.repository.DocumentChunkRepository;
import com.omega.platform.repository.DocumentRepository;
import java.io.ByteArrayOutputStream;
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
 * Verificación de punta a punta del Bloque DA:
 * Un tenant DEVELOPER que ingesta documentos de cadena de suministro guarda `corpus_scope = 'DEVELOPER'`
 * y recibe citas al consultar el RAG (no cero resultados), manteniendo aislamiento multi-tenant.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DeveloperRagScopeIntegrationTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;

    @DynamicPropertySource
    static void registerDatasourceProperties(DynamicPropertyRegistry registry) {
        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username",
                    () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password",
                    () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            @SuppressWarnings("resource")
            PostgreSQLContainer<?> container = new PostgreSQLContainer<>(
                    DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_rag_dev_test")
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

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private DocumentChunkRepository documentChunkRepository;

    @Test
    void developerTenantIngestsWithDeveloperScopeAndReceivesSupplyChainCitations() throws Exception {
        String slugA = "dev-rag-a-" + UUID.randomUUID().toString().substring(0, 8);
        String slugB = "dev-rag-b-" + UUID.randomUUID().toString().substring(0, 8);

        String tokenA = registerDeveloperTenant(slugA, "dev-a@" + slugA + ".org");
        String tokenB = registerDeveloperTenant(slugB, "dev-b@" + slugB + ".org");

        MvcResult expRes = mockMvc.perform(post("/api/v1/expedientes")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Supply Chain Audit NPM\",\"classification\":\"CONFIDENTIAL\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID expedienteId = UUID.fromString(objectMapper.readTree(expRes.getResponse().getContentAsString()).get("id").asText());

        byte[] pdfBytes = createSimplePdf("Advisory MAL-2025-9999 npm postinstall supply chain exfiltration vector");
        MockMultipartFile pdfPart = new MockMultipartFile("file", "supply-chain-advisory.pdf", "application/pdf", pdfBytes);

        MvcResult uploadRes = mockMvc.perform(multipart("/api/v1/expedientes/{id}/documents", expedienteId)
                        .file(pdfPart)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isAccepted())
                .andReturn();
        JsonNode docNode = objectMapper.readTree(uploadRes.getResponse().getContentAsString());
        UUID docId = UUID.fromString(docNode.get("id").asText());
        UUID tenantIdA = UUID.fromString(docNode.get("tenantId").asText());

        // Esperar a que el procesador asíncrono termine de indexar el PDF real
        DocumentEntity persisted = documentRepository.findByIdAndTenantId(docId, tenantIdA).orElseThrow();
        assertThat(persisted.getCorpusScope()).isEqualTo("DEVELOPER");
        long deadline = System.currentTimeMillis() + 8000L;
        while (persisted.getStatus() == DocumentStatus.PROCESSING && System.currentTimeMillis() < deadline) {
            Thread.sleep(100L);
            persisted = documentRepository.findByIdAndTenantId(docId, tenantIdA).orElseThrow();
        }
        assertThat(persisted.getStatus()).isEqualTo(DocumentStatus.INDEXED);
        assertThat(documentChunkRepository.countByTenantIdAndDocumentId(tenantIdA, docId)).isGreaterThan(0);

        MvcResult queryRes = mockMvc.perform(post("/api/v1/expedientes/{id}/query", expedienteId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\":\"postinstall supply chain exfiltration\",\"topK\":5}"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode body = objectMapper.readTree(queryRes.getResponse().getContentAsString());
        assertThat(body.get("citations").size()).isGreaterThan(0);
        assertThat(body.get("citations").get(0).get("excerpt").asText()).contains("postinstall");

        // Aislamiento multi-tenant: tenant B recibe 404 sin filtrar existencia
        mockMvc.perform(post("/api/v1/expedientes/{id}/query", expedienteId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\":\"postinstall supply chain\",\"topK\":5}"))
                .andExpect(status().isNotFound());
    }

    private String registerDeveloperTenant(String slug, String email) throws Exception {
        String payload = String.format(
                "{\"tenantSlug\":\"%s\",\"tenantName\":\"Org %s\",\"adminEmail\":\"%s\","
                        + "\"adminPassword\":\"DevStrongPass2026!\",\"adminFullName\":\"Ana Dev\",\"profile\":\"DEVELOPER\"}",
                slug, slug, email);
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("accessToken").asText();
    }

    private static byte[] createSimplePdf(String text) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                cs.newLineAtOffset(50, 700);
                cs.showText(text);
                cs.endText();
            }
            doc.save(out);
            return out.toByteArray();
        }
    }
}
