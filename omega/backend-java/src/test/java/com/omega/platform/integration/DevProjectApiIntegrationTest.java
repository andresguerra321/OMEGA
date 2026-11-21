package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.service.DevProjectService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
class DevProjectApiIntegrationTest {

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
                    .withDatabaseName("omega_dev_dc_test")
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
    void managesProjectsScanHistoryTrendComparisonAndCascadeDeletionWithTenantIsolation() throws Exception {
        JsonNode tenantA = registerDevTenant("dev-dc-a-" + UUID.randomUUID().toString().substring(0, 8));
        JsonNode tenantB = registerDevTenant("dev-dc-b-" + UUID.randomUUID().toString().substring(0, 8));
        String tokenA = tenantA.get("accessToken").asText();
        UUID tenantIdA = UUID.fromString(tenantA.get("tenantId").asText());
        UUID userIdA = UUID.fromString(tenantA.get("userId").asText());
        String tokenB = tenantB.get("accessToken").asText();

        MvcResult createRes = mockMvc.perform(post("/api/v1/dev/projects")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Payments Service\",\"repoUrl\":\"https://github.com/acme/payments\",\"defaultBranch\":\"main\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.slug").value("payments-service"))
                .andReturn();
        UUID projectId = UUID.fromString(objectMapper.readTree(createRes.getResponse().getContentAsString()).get("id").asText());

        // Registrar escaneo 1 (base) con 2 hallazgos
        DevScanEntity scan1 = devProjectService.recordScanResult(
                tenantIdA, userIdA, projectId, null, null, "main", "UI",
                Map.of(
                        "score", 60.0,
                        "findings", List.of(
                                Map.of("rule_id", "NPM-POSTINSTALL-EXEC-01", "severity", "HIGH", "title", "Postinstall shell", "location", "package.json:10", "score", 35.0),
                                Map.of("rule_id", "SECRET-EXFIL-01", "severity", "MEDIUM", "title", "Webhook exfil", "location", "index.js:44", "score", 25.0)
                        ),
                        "dependencies", List.of(Map.of("ecosystem", "npm", "name", "lodash", "version", "4.17.21"))
                )
        ).orElseThrow();

        // Registrar escaneo 2 (head): se resolvió SECRET-EXFIL-01 y apareció PKG-TYPOSQUAT-01
        DevScanEntity scan2 = devProjectService.recordScanResult(
                tenantIdA, userIdA, projectId, null, null, "main", "UI",
                Map.of(
                        "score", 60.0,
                        "findings", List.of(
                                Map.of("rule_id", "NPM-POSTINSTALL-EXEC-01", "severity", "HIGH", "title", "Postinstall shell", "location", "package.json:10", "score", 35.0),
                                Map.of("rule_id", "PKG-TYPOSQUAT-01", "severity", "MEDIUM", "title", "Typosquatting", "location", "package.json:15", "score", 25.0)
                        ),
                        "dependencies", List.of(Map.of("ecosystem", "npm", "name", "lodahs", "version", "1.0.0"))
                )
        ).orElseThrow();

        // Comparar scan1 vs scan2
        MvcResult cmpRes = mockMvc.perform(get("/api/v1/dev/projects/{id}/compare", projectId)
                        .param("baseScanId", scan1.getId().toString())
                        .param("headScanId", scan2.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.added.length()").value(1))
                .andExpect(jsonPath("$.added[0].ruleId").value("PKG-TYPOSQUAT-01"))
                .andExpect(jsonPath("$.resolved.length()").value(1))
                .andExpect(jsonPath("$.resolved[0].ruleId").value("SECRET-EXFIL-01"))
                .andExpect(jsonPath("$.unchanged.length()").value(1))
                .andReturn();
        assertThat(cmpRes.getResponse().getStatus()).isEqualTo(200);

        // Tenant B recibe 404 al intentar leer o borrar el proyecto de Tenant A
        mockMvc.perform(get("/api/v1/dev/projects/{id}", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/v1/dev/projects/{id}", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        // Borrado por Tenant A elimina proyecto e historial
        mockMvc.perform(delete("/api/v1/dev/projects/{id}", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true));

        mockMvc.perform(get("/api/v1/dev/projects/{id}", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isNotFound());
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
