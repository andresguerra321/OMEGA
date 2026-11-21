package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Q9: Prueba de ciclo de vida completo en perfil LEGAL:
 * - Exportar dossier para el cliente
 * - Borrar expediente en cascada completa (documentos, fragmentos, embeddings, cronología, permisos)
 * - Verificar en SQL que no queda ningún dato derivado y que audit_logs solo conserva IDs sin contenido.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LegalDataLifecycleCascadeTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static Path sharedTempDir;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (sharedTempDir == null) {
            sharedTempDir = Files.createTempDirectory("omega-legal-q9-test-");
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
    @Autowired private JdbcTemplate jdbc;

    @MockBean private EmbeddingProvider embeddingProvider;

    @Test
    void cascadesDeletionAcrossDocumentsChunksTimelineAndPermissionsLeavingOnlyIdAuditTrail() throws Exception {
        when(embeddingProvider.modelName()).thenReturn("text-embedding-3-small");
        when(embeddingProvider.dimensions()).thenReturn(1536);
        when(embeddingProvider.embedBatch(anyList())).thenThrow(new EmbeddingException("lexical"));
        when(embeddingProvider.embedQuery(anyString())).thenThrow(new EmbeddingException("lexical"));

        String slug = "q9-" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult reg = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"tenantName\":\"Despacho Sintetico\","
                                + "\"adminEmail\":\"admin@" + slug + ".invalid\",\"adminPassword\":\"OmegaLife!2026\","
                                + "\"adminFullName\":\"Admin Sintetico\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String token = objectMapper.readTree(reg.getResponse().getContentAsString()).path("accessToken").asText();
        UUID tenantId = UUID.fromString(objectMapper.readTree(reg.getResponse().getContentAsString()).path("tenantId").asText());

        mockMvc.perform(put("/api/v1/profile").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isOk());

        // Aceptar consentimiento IA
        MvcResult pol = mockMvc.perform(get("/api/v1/legal/document-ai/policy")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        String fp = objectMapper.readTree(pol.getResponse().getContentAsString()).path("fingerprint").asText();
        mockMvc.perform(post("/api/v1/legal/document-ai/consent").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fingerprint\":\"" + fp + "\"}"))
                .andExpect(status().isNoContent());

        // Crear usuario colaborador y expediente
        MvcResult uRes = mockMvc.perform(post("/api/v1/auth/users").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"colab@" + slug + ".invalid\",\"password\":\"OmegaLife!2026\",\"fullName\":\"Colaborador Sintetico\",\"role\":\"CLIENT\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID colabId = UUID.fromString(objectMapper.readTree(uRes.getResponse().getContentAsString()).path("id").asText());

        MvcResult caseRes = mockMvc.perform(post("/api/v1/expedientes").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Expediente Supresion Q9\",\"classification\":\"CONFIDENTIAL\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID caseId = UUID.fromString(objectMapper.readTree(caseRes.getResponse().getContentAsString()).path("id").asText());

        mockMvc.perform(post("/api/v1/expedientes/" + caseId + "/permissions").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"" + colabId + "\",\"permission\":\"READ\"}"))
                .andExpect(status().isOk());

        // Subir PDF sintético con fecha para generar chunks + timeline
        byte[] pdf = buildPdf("Acta sintética del 2024-05-10 con dato sensible BORRABLE_MARKER_Q9_991.");
        MvcResult up = mockMvc.perform(multipart("/api/v1/expedientes/" + caseId + "/documents")
                        .file(new MockMultipartFile("file", "NOMBRE_ARCHIVO_CONFIDENCIAL_Q9.pdf", "application/pdf", pdf))
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isAccepted())
                .andReturn();
        UUID docId = UUID.fromString(objectMapper.readTree(up.getResponse().getContentAsString()).path("id").asText());

        long deadline = System.currentTimeMillis() + 15000;
        while (System.currentTimeMillis() < deadline) {
            var opt = documentRepository.findById(docId);
            if (opt.isPresent() && opt.get().getStatus() == DocumentStatus.INDEXED) break;
            Thread.sleep(100);
        }

        // Extraer cronología y exportar dossier antes de suprimir
        mockMvc.perform(post("/api/v1/expedientes/" + caseId + "/timeline/extract").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/expedientes/" + caseId + "/export/json")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk());

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.documents WHERE expediente_id = ?", Integer.class, caseId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.document_chunks WHERE expediente_id = ?", Integer.class, caseId)).isGreaterThan(0);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.legal_timeline_events WHERE expediente_id = ?", Integer.class, caseId)).isGreaterThan(0);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.expediente_permissions WHERE expediente_id = ?", Integer.class, caseId)).isEqualTo(1);

        // Supresión en cascada del expediente
        mockMvc.perform(delete("/api/v1/expedientes/" + caseId).with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isNoContent());

        // Verificar que no queda NINGÚN dato derivado
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.expedientes WHERE id = ?", Integer.class, caseId)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.documents WHERE expediente_id = ?", Integer.class, caseId)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.document_chunks WHERE expediente_id = ?", Integer.class, caseId)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.legal_timeline_events WHERE expediente_id = ?", Integer.class, caseId)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.expediente_permissions WHERE expediente_id = ?", Integer.class, caseId)).isZero();

        // Verificar que audit_logs conserva el registro de borrado solo con IDs y cero contenido/nombres
        var auditRows = jdbc.queryForList(
                "SELECT action, metadata_json FROM omega_rag.audit_logs WHERE tenant_id = ?", tenantId);
        assertThat(auditRows).anySatisfy(row -> assertThat(row.get("action")).isEqualTo("EXPEDIENTE_DELETED"));
        String allAudit = auditRows.toString();
        assertThat(allAudit)
                .doesNotContain("BORRABLE_MARKER_Q9_991")
                .doesNotContain("NOMBRE_ARCHIVO_CONFIDENCIAL_Q9");
    }

    private static byte[] buildPdf(String text) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                cs.newLineAtOffset(50, 700);
                cs.showText(text.replaceAll("[^\\x20-\\x7EáéíóúÁÉÍÓÚñÑ¿¡]", " "));
                cs.endText();
            }
            doc.save(out);
            return out.toByteArray();
        }
    }
}
