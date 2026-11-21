package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.service.DevProjectService;
import java.util.HashMap;
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
class DevPolicyApiIntegrationTest {

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
                    .withDatabaseName("omega_dev_df_test")
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
    void enforcesAdminOnlyPolicyWritesProjectOverridesAndEvaluatesBlockedPackagesAndThresholds() throws Exception {
        String slug = "dev-df-" + UUID.randomUUID().toString().substring(0, 8);
        JsonNode tenant = registerDevTenant(slug);
        String adminToken = tenant.get("accessToken").asText();
        UUID tenantId = UUID.fromString(tenant.get("tenantId").asText());
        UUID adminUserId = UUID.fromString(tenant.get("userId").asText());

        // Crear un usuario ANALYST y verificar que no puede editar políticas (403)
        mockMvc.perform(post("/api/v1/auth/users")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"analyst@" + slug + ".org\",\"password\":\"AnalystPass2026!\",\"fullName\":\"Analyst Dev\",\"role\":\"ANALYST\"}"))
                .andExpect(status().isCreated());
        MvcResult loginRes = mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"analyst@" + slug + ".org\",\"password\":\"AnalystPass2026!\",\"tenantSlug\":\"" + slug + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        String analystToken = objectMapper.readTree(loginRes.getResponse().getContentAsString()).get("accessToken").asText();

        mockMvc.perform(put("/api/v1/dev/policies")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + analystToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"failOnSeverity\":\"MEDIUM\",\"actionOnViolation\":\"FAIL_PIPELINE\",\"allowedPackages\":[],\"blockedPackages\":[\"npm:event-stream\"]}"))
                .andExpect(status().isForbidden());

        // ADMIN configura política global del tenant
        mockMvc.perform(put("/api/v1/dev/policies")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"failOnSeverity\":\"CRITICAL\",\"actionOnViolation\":\"FAIL_PIPELINE\",\"allowedPackages\":[],\"blockedPackages\":[\"npm:event-stream\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.failOnSeverity").value("CRITICAL"))
                .andExpect(jsonPath("$.blockedPackages[0]").value("npm:event-stream"));

        // Crear proyecto
        MvcResult projRes = mockMvc.perform(post("/api/v1/dev/projects")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Gateway Service\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID projectId = UUID.fromString(objectMapper.readTree(projRes.getResponse().getContentAsString()).get("id").asText());

        // Escaneo con paquete bloqueado "event-stream" -> debe evaluar FAIL aunque no haya hallazgos CRITICAL
        Map<String, Object> scanPayload = new HashMap<>();
        scanPayload.put("score", 10.0);
        scanPayload.put("findings", List.of());
        scanPayload.put("dependencies", List.of(Map.of("ecosystem", "npm", "name", "event-stream", "version", "3.3.6")));

        DevScanEntity savedScan = devProjectService.recordScanResult(
                tenantId, adminUserId, projectId, null, null, "main", "CLI", scanPayload
        ).orElseThrow();
        assertThat(savedScan.getPolicyStatus()).isEqualTo("FAIL");
        assertThat(scanPayload).containsKey("policy_evaluation");

        // Override por proyecto a MARK_ONLY y eliminar paquete bloqueado -> evalúa PASS
        mockMvc.perform(put("/api/v1/dev/projects/{id}/policy", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"failOnSeverity\":\"CRITICAL\",\"actionOnViolation\":\"MARK_ONLY\",\"allowedPackages\":[],\"blockedPackages\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectOverride").value(true));

        Map<String, Object> scanPayload2 = new HashMap<>();
        scanPayload2.put("score", 10.0);
        scanPayload2.put("findings", List.of());
        scanPayload2.put("dependencies", List.of(Map.of("ecosystem", "npm", "name", "event-stream", "version", "3.3.6")));
        DevScanEntity savedScan2 = devProjectService.recordScanResult(
                tenantId, adminUserId, projectId, null, null, "main", "CLI", scanPayload2
        ).orElseThrow();
        assertThat(savedScan2.getPolicyStatus()).isEqualTo("PASS");

        // Eliminar override restaura herencia del tenant
        mockMvc.perform(delete("/api/v1/dev/projects/{id}/policy", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.removed").value(true));

        mockMvc.perform(get("/api/v1/dev/projects/{id}/policy", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectOverride").value(false))
                .andExpect(jsonPath("$.blockedPackages[0]").value("npm:event-stream"));
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
