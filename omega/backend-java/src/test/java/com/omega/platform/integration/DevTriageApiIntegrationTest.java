package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.repository.AuditLogRepository;
import com.omega.platform.repository.DevScanRepository;
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
class DevTriageApiIntegrationTest {

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
                    .withDatabaseName("omega_dev_dd_test")
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
    @Autowired private DevScanRepository scanRepository;
    @Autowired private AuditLogRepository auditLogRepository;

    @Test
    void triagesFindingsRedactsSecretsInCommentsManagesSuppressionsAndRecalculatesEffectiveScore() throws Exception {
        JsonNode tenantA = registerDevTenant("dev-dd-a-" + UUID.randomUUID().toString().substring(0, 8));
        JsonNode tenantB = registerDevTenant("dev-dd-b-" + UUID.randomUUID().toString().substring(0, 8));
        String tokenA = tenantA.get("accessToken").asText();
        UUID tenantIdA = UUID.fromString(tenantA.get("tenantId").asText());
        UUID userIdA = UUID.fromString(tenantA.get("userId").asText());
        String tokenB = tenantB.get("accessToken").asText();

        DevScanEntity scan = devProjectService.recordScanResult(
                tenantIdA, userIdA, null, "Core Billing", "https://github.com/acme/billing", "main", "UI",
                Map.of(
                        "score", 60.0,
                        "findings", List.of(
                                Map.of("rule_id", "NPM-POSTINSTALL-EXEC-01", "severity", "HIGH", "title", "Postinstall shell", "location", "package.json:10", "score", 35.0),
                                Map.of("rule_id", "PKG-NEW-OR-RECENT-01", "severity", "LOW", "title", "Recent package", "location", "package.json:20", "score", 25.0)
                        )
                )
        ).orElseThrow();

        // Filtrar hallazgos por severidad HIGH
        MvcResult listHigh = mockMvc.perform(get("/api/v1/dev/findings")
                        .param("projectId", scan.getProjectId().toString())
                        .param("severity", "HIGH")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andReturn();
        JsonNode highFinding = objectMapper.readTree(listHigh.getResponse().getContentAsString()).get(0);
        UUID findingId = UUID.fromString(highFinding.get("id").asText());

        // Añadir comentario con un token accidental -> debe redactarse automáticamente
        MvcResult commentRes = mockMvc.perform(post("/api/v1/dev/findings/{id}/comments", findingId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"Verificado con token ghp_1234567890abcdefghijklmnopqrstuvwx en staging\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String savedBody = objectMapper.readTree(commentRes.getResponse().getContentAsString()).get("body").asText();
        assertThat(savedBody).contains("[REDACTED]").doesNotContain("ghp_1234567890");

        // Crear supresión con motivo y expiración -> recalcula effectiveScore (60 - 35 = 25) y marca hasActiveSuppressions
        MvcResult supRes = mockMvc.perform(post("/api/v1/dev/projects/{id}/suppressions", scan.getProjectId())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ruleId\":\"NPM-POSTINSTALL-EXEC-01\",\"reason\":\"Build nativo interno verificado\",\"expiresInDays\":30}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.active").value(true))
                .andReturn();
        UUID suppressionId = UUID.fromString(objectMapper.readTree(supRes.getResponse().getContentAsString()).get("id").asText());

        DevScanEntity afterSup = scanRepository.findByIdAndTenantId(scan.getId(), tenantIdA).orElseThrow();
        assertThat(afterSup.getEffectiveScore()).isEqualTo(25.0);
        assertThat(afterSup.isHasActiveSuppressions()).isTrue();

        // Cambiar estado de triaje y verificar que Tenant B recibe 404
        mockMvc.perform(patch("/api/v1/dev/findings/{id}/triage", findingId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"CONFIRMED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.triageStatus").value("CONFIRMED"));

        mockMvc.perform(patch("/api/v1/dev/findings/{id}/triage", findingId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"RESOLVED\"}"))
                .andExpect(status().isNotFound());

        // Revocar supresión -> restaura puntaje a 60.0
        mockMvc.perform(delete("/api/v1/dev/suppressions/{id}", suppressionId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        DevScanEntity afterRevoke = scanRepository.findByIdAndTenantId(scan.getId(), tenantIdA).orElseThrow();
        assertThat(afterRevoke.getEffectiveScore()).isEqualTo(60.0);

        // Verificar auditoría sin secretos
        assertThat(auditLogRepository.findAllByTenantIdOrderByChainSeqAsc(tenantIdA))
                .extracting("action")
                .contains("DEV_FINDING_COMMENTED", "DEV_SUPPRESSION_CREATED", "DEV_FINDING_TRIAGED", "DEV_SUPPRESSION_REVOKED");
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
