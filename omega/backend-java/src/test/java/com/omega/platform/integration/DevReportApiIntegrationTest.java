package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.service.DevProjectService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
class DevReportApiIntegrationTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;

    @DynamicPropertySource
    static void registerDatasourceProperties(DynamicPropertyRegistry registry) {
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
                    .withDatabaseName("omega_dev_dk_test")
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
    @Autowired private DevProjectService devProjectService;

    @Test
    void exportsOrganizationAndProjectReportsInJsonAndPdfWithoutSensitiveEvidence() throws Exception {
        String slug = "dev-dk-" + UUID.randomUUID().toString().substring(0, 8);
        JsonNode tenant = registerDevTenant(slug);
        String token = tenant.get("accessToken").asText();
        UUID tenantId = UUID.fromString(tenant.get("tenantId").asText());
        UUID userId = UUID.fromString(tenant.get("userId").asText());

        MvcResult projRes = mockMvc.perform(post("/api/v1/dev/projects")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Auth Microservice\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID projectId = UUID.fromString(objectMapper.readTree(projRes.getResponse().getContentAsString()).get("id").asText());

        String syntheticToken = "ghp_" + "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8";
        devProjectService.recordScanResult(
                tenantId, userId, projectId, null, null, "main", "UI",
                Map.of(
                        "score", 45.0,
                        "findings", List.of(
                                Map.of(
                                        "rule_id", "SECRET-CREDENTIAL-GITHUB-01",
                                        "severity", "CRITICAL",
                                        "title", "Token en archivo " + syntheticToken,
                                        "location", "src/auth.js:12",
                                        "score", 45.0
                                )
                        ),
                        "dependencies", List.of(Map.of("ecosystem", "npm", "name", "jsonwebtoken", "version", "9.0.2"))
                )
        );

        // 1. Reporte JSON nunca contiene el secreto sintético
        MvcResult jsonRes = mockMvc.perform(get("/api/v1/dev/reports/export/json")
                        .param("projectId", projectId.toString())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("PROJECT"))
                .andExpect(jsonPath("$.projectsCount").value(1))
                .andExpect(jsonPath("$.severityCounts.CRITICAL").value(1))
                .andReturn();
        String jsonBody = jsonRes.getResponse().getContentAsString();
        assertThat(jsonBody).doesNotContain(syntheticToken);

        // 2. Reporte PDF legible y sin secretos
        MvcResult pdfRes = mockMvc.perform(get("/api/v1/dev/reports/export/pdf")
                        .param("projectId", projectId.toString())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        byte[] pdfBytes = pdfRes.getResponse().getContentAsByteArray();
        assertThat(new String(pdfBytes, 0, 5, StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
        try (var parsed = Loader.loadPDF(pdfBytes)) {
            String extracted = new PDFTextStripper().getText(parsed);
            assertThat(extracted).contains("OMEGA DEVELOPER SECURITY", "Auth Microservice", "SECRET-CREDENTIAL-GITHUB-01");
            assertThat(extracted).doesNotContain(syntheticToken);
        }
    }

    private JsonNode registerDevTenant(String slug) throws Exception {
        String payload = String.format(
                "{\"tenantSlug\":\"%s\",\"tenantName\":\"Org %s\",\"adminEmail\":\"admin@%s.org\","
                        + "\"adminPassword\":\"DevStrongPass2026!\",\"adminFullName\":\"Ana Dev\",\"profile\":\"DEVELOPER\"}",
                slug, slug, slug);
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString());
    }
}
