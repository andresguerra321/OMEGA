package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
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
import com.omega.platform.repository.DocumentRepository;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
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

/**
 * Q10: Búsqueda en todo el despacho con verificación estricta de permisos y aislamiento cross-tenant.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@org.springframework.context.annotation.Import(PaidWorkspaceFixture.class)
class LegalFirmSearchIsolationTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static Path sharedTempDir;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (sharedTempDir == null) {
            sharedTempDir = Files.createTempDirectory("omega-legal-q10-test-");
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

    @Test
    void returnsOnlyPermittedCasesAndNeverLeaksUnauthorizedOrCrossTenantResults() throws Exception {
        when(embeddingProvider.modelName()).thenReturn("text-embedding-3-small");
        when(embeddingProvider.dimensions()).thenReturn(1536);
        when(embeddingProvider.embedBatch(anyList())).thenThrow(new EmbeddingException("lexical"));
        when(embeddingProvider.embedQuery(anyString())).thenThrow(new EmbeddingException("lexical"));

        String marker = "CLAUSULA_UNICA_Q10_" + UUID.randomUUID().toString().substring(0, 6);

        String slugA = "legal-search-a-" + UUID.randomUUID().toString().substring(0, 8);
        String slugB = "legal-search-b-" + UUID.randomUUID().toString().substring(0, 8);
        String adminA = registerLegalTenant(slugA, "admin@" + slugA + ".invalid");
        String adminB = registerLegalTenant(slugB, "admin@" + slugB + ".invalid");
        acceptConsent(adminA);
        acceptConsent(adminB);

        // Usuario CLIENT en Tenant A con acceso SOLO a caseA1 (sin acceso a caseA2)
        String clientEmail = "cliente@" + slugA + ".invalid";
        MvcResult uRes = mockMvc.perform(post("/api/v1/auth/users").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + clientEmail + "\",\"password\":\"OmegaSearch!2026\",\"fullName\":\"Cliente Sintetico\",\"role\":\"CLIENT\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID clientId = UUID.fromString(objectMapper.readTree(uRes.getResponse().getContentAsString()).path("id").asText());
        MvcResult loginRes = mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slugA + "\",\"email\":\"" + clientEmail + "\",\"password\":\"OmegaSearch!2026\"}"))
                .andExpect(status().isOk())
                .andReturn();
        String clientToken = objectMapper.readTree(loginRes.getResponse().getContentAsString()).path("accessToken").asText();

        UUID caseA1 = createCase(adminA, "Caso Permitido A1");
        UUID caseA2 = createCase(adminA, "Caso Restringido A2 " + marker);
        UUID caseB1 = createCase(adminB, "Caso Otro Tenant B1 " + marker);

        mockMvc.perform(post("/api/v1/expedientes/" + caseA1 + "/permissions").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"" + clientId + "\",\"permission\":\"READ\"}"))
                .andExpect(status().isOk());

        uploadAndWait(adminA, caseA1, "a1.pdf", "Texto indexado en A1 con " + marker + ".");
        uploadAndWait(adminA, caseA2, "a2.pdf", "Texto restringido en A2 con " + marker + ".");
        uploadAndWait(adminB, caseB1, "b1.pdf", "Texto de otro tenant en B1 con " + marker + ".");

        // 1. CLIENT en Tenant A solo puede ver resultados de caseA1 (nunca caseA2 ni caseB1)
        MvcResult clientSearch = mockMvc.perform(get("/api/v1/expedientes/search?q=" + marker + "&page=0&size=10")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + clientToken))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode clientBody = objectMapper.readTree(clientSearch.getResponse().getContentAsString());
        assertThat(clientBody.path("totalElements").asLong()).isEqualTo(1);
        assertThat(clientBody.path("content").get(0).path("expedienteId").asText()).isEqualTo(caseA1.toString());
        assertThat(clientBody.path("content").get(0).path("matchType").asText()).isEqualTo("DOCUMENT_TEXT");
        assertThat(clientSearch.getResponse().getContentAsString())
                .doesNotContain(caseA2.toString())
                .doesNotContain(caseB1.toString());

        // 2. ADMIN en Tenant A ve A1 y A2 (con paginación), pero NUNCA B1
        MvcResult adminSearch = mockMvc.perform(get("/api/v1/expedientes/search?q=" + marker + "&page=0&size=2")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminA))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode adminBody = objectMapper.readTree(adminSearch.getResponse().getContentAsString());
        assertThat(adminBody.path("totalElements").asLong()).isGreaterThanOrEqualTo(3);
        assertThat(adminBody.path("content").size()).isEqualTo(2);
        assertThat(adminSearch.getResponse().getContentAsString()).doesNotContain(caseB1.toString());
    }

    private String registerLegalTenant(String slug, String email) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"tenantName\":\"Despacho Sintetico\","
                                + "\"adminEmail\":\"" + email + "\",\"adminPassword\":\"OmegaSearch!2026\","
                                + "\"adminFullName\":\"Admin Sintetico\"}"))
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

    private void acceptConsent(String token) throws Exception {
        MvcResult pol = mockMvc.perform(get("/api/v1/legal/document-ai/policy")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk()).andReturn();
        String fp = objectMapper.readTree(pol.getResponse().getContentAsString()).path("fingerprint").asText();
        mockMvc.perform(post("/api/v1/legal/document-ai/consent").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fingerprint\":\"" + fp + "\"}"))
                .andExpect(status().isNoContent());
    }

    private UUID createCase(String token, String title) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/expedientes").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"" + title + "\",\"classification\":\"CONFIDENTIAL\"}"))
                .andExpect(status().isCreated()).andReturn();
        return UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).path("id").asText());
    }

    private void uploadAndWait(String token, UUID caseId, String filename, String text) throws Exception {
        byte[] pdf;
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                cs.newLineAtOffset(50, 700);
                cs.showText(text);
                cs.endText();
            }
            doc.save(out);
            pdf = out.toByteArray();
        }
        MvcResult res = mockMvc.perform(multipart("/api/v1/expedientes/" + caseId + "/documents")
                        .file(new MockMultipartFile("file", filename, "application/pdf", pdf))
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isAccepted()).andReturn();
        UUID docId = UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).path("id").asText());
        long deadline = System.currentTimeMillis() + 15000;
        while (System.currentTimeMillis() < deadline) {
            var opt = documentRepository.findById(docId);
            if (opt.isPresent() && opt.get().getStatus() == DocumentStatus.INDEXED) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timeout indexando documento " + docId);
    }
}
