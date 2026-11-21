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
class DevSbomApiIntegrationTest {

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
                    .withDatabaseName("omega_dev_de_test")
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
    void listsDependenciesCorrelatesSignalsAndExportsValidCycloneDx15AndSpdx23Json() throws Exception {
        JsonNode tenantA = registerDevTenant("dev-de-a-" + UUID.randomUUID().toString().substring(0, 8));
        JsonNode tenantB = registerDevTenant("dev-de-b-" + UUID.randomUUID().toString().substring(0, 8));
        String tokenA = tenantA.get("accessToken").asText();
        String tokenB = tenantB.get("accessToken").asText();
        UUID tenantIdA = UUID.fromString(tenantA.get("tenantId").asText());
        UUID userIdA = UUID.fromString(tenantA.get("userId").asText());

        MvcResult createRes = mockMvc.perform(post("/api/v1/dev/projects")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Checkout Core\",\"repoUrl\":\"https://github.com/acme/checkout\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID projectId = UUID.fromString(objectMapper.readTree(createRes.getResponse().getContentAsString()).get("id").asText());

        devProjectService.recordScanResult(
                tenantIdA, userIdA, projectId, null, null, "main", "UI",
                Map.of(
                        "score", 40.0,
                        "findings", List.of(
                                Map.of("rule_id", "PKG-TYPOSQUAT-01", "severity", "HIGH", "title", "Typosquatting en lodahs", "location", "package.json:dependencies.lodahs", "score", 40.0)
                        ),
                        "dependencies", List.of(
                                Map.of("ecosystem", "npm", "name", "lodahs", "version", "1.0.0", "purl", "pkg:npm/lodahs@1.0.0", "manifest_path", "package.json", "direct", true),
                                Map.of("ecosystem", "pypi", "name", "fastapi", "version", "0.115.0", "purl", "pkg:pypi/fastapi@0.115.0", "manifest_path", "requirements.txt", "direct", true)
                        )
                )
        );

        // 1. Inventario de dependencias y correlación con señal activa
        mockMvc.perform(get("/api/v1/dev/projects/{id}/dependencies", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalDependencies").value(2))
                .andExpect(jsonPath("$.dependenciesWithSignals").value(1));

        // 2. Filtro por ecosistema
        mockMvc.perform(get("/api/v1/dev/projects/{id}/dependencies", projectId)
                        .param("ecosystem", "npm")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalDependencies").value(1))
                .andExpect(jsonPath("$.dependencies[0].name").value("lodahs"))
                .andExpect(jsonPath("$.dependencies[0].signals[0].ruleId").value("PKG-TYPOSQUAT-01"));

        // 3. Exportar CycloneDX 1.5 válido
        MvcResult cdxRes = mockMvc.perform(get("/api/v1/dev/projects/{id}/sbom", projectId)
                        .param("format", "cyclonedx")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bomFormat").value("CycloneDX"))
                .andExpect(jsonPath("$.specVersion").value("1.5"))
                .andExpect(jsonPath("$.components.length()").value(2))
                .andReturn();
        JsonNode cdx = objectMapper.readTree(cdxRes.getResponse().getContentAsString());
        assertThat(cdx.get("serialNumber").asText()).startsWith("urn:uuid:");
        assertThat(cdx.get("metadata").get("component").get("name").asText()).isEqualTo("Checkout Core");

        // 4. Exportar SPDX 2.3 válido
        MvcResult spdxRes = mockMvc.perform(get("/api/v1/dev/projects/{id}/sbom", projectId)
                        .param("format", "spdx")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.spdxVersion").value("SPDX-2.3"))
                .andExpect(jsonPath("$.dataLicense").value("CC0-1.0"))
                .andExpect(jsonPath("$.SPDXID").value("SPDXRef-DOCUMENT"))
                .andExpect(jsonPath("$.packages.length()").value(3))
                .andReturn();
        JsonNode spdx = objectMapper.readTree(spdxRes.getResponse().getContentAsString());
        assertThat(spdx.get("relationships").size()).isGreaterThanOrEqualTo(3);

        // 5. Aislamiento cross-tenant
        mockMvc.perform(get("/api/v1/dev/projects/{id}/sbom", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
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
