package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Q11: Prueba de rendimiento y paginación con 1000 expedientes sintéticos por tenant
 * y un expediente con 500 documentos sintéticos.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LegalScalePerformanceTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) {
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
    @Autowired private JdbcTemplate jdbc;

    @Test
    void paginates1000CasesAnd500DocumentsWithinReasonableLatency() throws Exception {
        String slug = "legal-scale-" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult reg = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"tenantName\":\"Despacho Escala\","
                                + "\"adminEmail\":\"admin@" + slug + ".invalid\",\"adminPassword\":\"OmegaScale!2026\","
                                + "\"adminFullName\":\"Admin Escala\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode regBody = objectMapper.readTree(reg.getResponse().getContentAsString());
        String token = regBody.path("accessToken").asText();
        UUID tenantId = UUID.fromString(regBody.path("tenantId").asText());
        UUID userId = UUID.fromString(regBody.path("userId").asText());

        mockMvc.perform(put("/api/v1/profile").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isOk());

        // Insertar 1000 expedientes sintéticos en lote
        UUID bigCaseId = UUID.randomUUID();
        jdbc.batchUpdate("""
                INSERT INTO omega_rag.expedientes
                    (id, tenant_id, owner_user_id, title, classification, description, case_reference, case_status)
                VALUES (?, ?, ?, ?, 'CONFIDENTIAL', 'Expediente sintético de rendimiento', ?, 'OPEN')
                """, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                ps.setObject(1, i == 0 ? bigCaseId : UUID.randomUUID());
                ps.setObject(2, tenantId);
                ps.setObject(3, userId);
                ps.setString(4, "Expediente Sintético #" + (i + 1));
                ps.setString(5, "REF-SINT-" + (i + 1));
            }
            @Override
            public int getBatchSize() { return 1000; }
        });

        // Insertar 500 documentos sintéticos en bigCaseId
        jdbc.batchUpdate("""
                INSERT INTO omega_rag.documents
                    (id, tenant_id, expediente_id, uploaded_by, original_filename, sha256_hash, total_pages, embedding_model, ocr_applied, status, corpus_scope, document_format)
                VALUES (?, ?, ?, ?, ?, ?, 2, 'lexical-only-tsvector', FALSE, 'INDEXED', 'LEGAL', 'PDF')
                """, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                ps.setObject(1, UUID.randomUUID());
                ps.setObject(2, tenantId);
                ps.setObject(3, bigCaseId);
                ps.setObject(4, userId);
                ps.setString(5, "doc-sintetico-" + (i + 1) + ".pdf");
                ps.setString(6, String.format("%064x", i + 1));
            }
            @Override
            public int getBatchSize() { return 500; }
        });

        // 1. Paginación de 1000 expedientes (< 1500 ms)
        long t0 = System.nanoTime();
        MvcResult casesRes = mockMvc.perform(get("/api/v1/expedientes/page?page=0&size=20")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        long casesMs = (System.nanoTime() - t0) / 1_000_000;
        JsonNode casesPage = objectMapper.readTree(casesRes.getResponse().getContentAsString());
        assertThat(casesPage.path("totalElements").asLong()).isEqualTo(1000);
        assertThat(casesPage.path("totalPages").asInt()).isEqualTo(50);
        assertThat(casesPage.path("content").size()).isEqualTo(20);
        assertThat(casesMs).as("Listado paginado de 1000 expedientes (%d ms)", casesMs).isLessThan(1500);

        // 2. Paginación de 500 documentos (< 1500 ms)
        long t1 = System.nanoTime();
        MvcResult docsRes = mockMvc.perform(get("/api/v1/expedientes/" + bigCaseId + "/documents/page?page=0&size=20")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        long docsMs = (System.nanoTime() - t1) / 1_000_000;
        JsonNode docsPage = objectMapper.readTree(docsRes.getResponse().getContentAsString());
        assertThat(docsPage.path("totalElements").asLong()).isEqualTo(500);
        assertThat(docsPage.path("totalPages").asInt()).isEqualTo(25);
        assertThat(docsPage.path("content").size()).isEqualTo(20);
        assertThat(docsMs).as("Listado paginado de 500 documentos (%d ms)", docsMs).isLessThan(1500);

        // 3. Búsqueda paginada en despacho sobre 1000 expedientes (< 2000 ms)
        long t2 = System.nanoTime();
        MvcResult searchRes = mockMvc.perform(get("/api/v1/expedientes/search?q=REF-SINT-500&page=0&size=20")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        long searchMs = (System.nanoTime() - t2) / 1_000_000;
        JsonNode searchPage = objectMapper.readTree(searchRes.getResponse().getContentAsString());
        assertThat(searchPage.path("totalElements").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(searchMs).as("Búsqueda en despacho sobre 1000 expedientes (%d ms)", searchMs).isLessThan(2000);
    }
}
