package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.service.DevMonitoringService;
import com.omega.platform.service.DevProjectService;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
@org.springframework.context.annotation.Import(PaidWorkspaceFixture.class)
class DevMonitoringApiIntegrationTest {

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
                    .withDatabaseName("omega_dev_dg_test")
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
    @Autowired private DevMonitoringService devMonitoringService;
    @Autowired private CommercialSaasService commercialSaasService;

    @Test
    void reEvaluatesStoredDependenciesWithoutCodeDownloadDeduplicatesAlertsAndFlagsStaleFeeds() throws Exception {
        JsonNode tenantA = registerDevTenant("dev-dg-a-" + UUID.randomUUID().toString().substring(0, 8));
        JsonNode tenantB = registerDevTenant("dev-dg-b-" + UUID.randomUUID().toString().substring(0, 8));
        String tokenA = tenantA.get("accessToken").asText();
        String tokenB = tenantB.get("accessToken").asText();
        UUID tenantIdA = UUID.fromString(tenantA.get("tenantId").asText());
        UUID userIdA = UUID.fromString(tenantA.get("userId").asText());

        MvcResult projRes = mockMvc.perform(post("/api/v1/dev/projects")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Order Worker\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID projectId = UUID.fromString(objectMapper.readTree(projRes.getResponse().getContentAsString()).get("id").asText());

        // Escaneo inicial sin hallazgos, pero con dependencia 'event-stream' en SBOM
        devProjectService.recordScanResult(
                tenantIdA, userIdA, projectId, null, null, "main", "UI",
                Map.of(
                        "score", 0.0,
                        "findings", List.of(),
                        "dependencies", List.of(Map.of("ecosystem", "npm", "name", "event-stream", "version", "3.3.6"))
                )
        );

        // 1. Activar suscripción de monitoreo
        mockMvc.perform(put("/api/v1/dev/projects/{id}/monitoring", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\":true,\"channel\":\"WEBHOOK\",\"minSeverity\":\"HIGH\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.feedStaleWarning").value(false));

        // 2. Primera reevaluación sobre SBOM almacenado genera 1 alerta nueva
        mockMvc.perform(post("/api/v1/dev/projects/{id}/monitoring/evaluate", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evaluatedDependencies").value(1))
                .andExpect(jsonPath("$.newAlertsCount").value(1))
                .andExpect(jsonPath("$.deduplicatedCount").value(0));

        // 3. Segunda reevaluación deduplica la alerta (0 nuevas, 1 deduplicada)
        mockMvc.perform(post("/api/v1/dev/projects/{id}/monitoring/evaluate", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newAlertsCount").value(0))
                .andExpect(jsonPath("$.deduplicatedCount").value(1));

        // 4. Simular feed desactualizado (> 48h) y verificar aviso visible feedStaleWarning = true
        devMonitoringService.setLastFeedRefreshAt(Instant.now().minus(72, ChronoUnit.HOURS));
        try {
            mockMvc.perform(get("/api/v1/dev/projects/{id}/monitoring", projectId)
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.feedStaleWarning").value(true));
        } finally {
            devMonitoringService.setLastFeedRefreshAt(Instant.now());
        }

        // 5. Aislamiento cross-tenant: Tenant B recibe 404
        mockMvc.perform(get("/api/v1/dev/projects/{id}/monitoring", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                .andExpect(status().isNotFound());
    }

    @Test
    void schedulerEvaluatesDueSubscriptionsByPlanAndToleratesFeedFailures() throws Exception {
        JsonNode tenant = registerDevTenant("dev-sched-" + UUID.randomUUID().toString().substring(0, 8));
        String token = tenant.get("accessToken").asText();
        UUID tenantId = UUID.fromString(tenant.get("tenantId").asText());
        UUID userId = UUID.fromString(tenant.get("userId").asText());

        // Plan PRO -> frecuencia configurada de 6h
        commercialSaasService.updateSubscriptionPlan(tenantId, "PRO");

        MvcResult projRes = mockMvc.perform(post("/api/v1/dev/projects")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Scheduled Billing API\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        UUID projectId = UUID.fromString(objectMapper.readTree(projRes.getResponse().getContentAsString()).get("id").asText());

        devProjectService.recordScanResult(
                tenantId, userId, projectId, null, null, "main", "UI",
                Map.of(
                        "score", 0.0,
                        "findings", List.of(),
                        "dependencies", List.of(Map.of("ecosystem", "npm", "name", "lodahs", "version", "4.17.1"))
                )
        );

        mockMvc.perform(put("/api/v1/dev/projects/{id}/monitoring", projectId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\":true,\"channel\":\"WEBHOOK\",\"minSeverity\":\"HIGH\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.frequencyHours").value(6))
                .andExpect(jsonPath("$.nextScheduledAt").isNotEmpty());

        Instant t0 = Instant.now();
        // 1. Primera ejecución programada (sin POST /evaluate): evalúa y genera 1 alerta nueva
        var firstRun = devMonitoringService.runScheduledEvaluations(t0);
        assertThat(firstRun.evaluatedCount()).isGreaterThanOrEqualTo(1);
        assertThat(firstRun.newAlertsTotal()).isEqualTo(1);
        assertThat(firstRun.failedCount()).isZero();

        // 2. Dos horas después (< 6h del plan PRO): no vuelve a evaluar esta suscripción
        var beforeDueRun = devMonitoringService.runScheduledEvaluations(t0.plus(2, ChronoUnit.HOURS));
        assertThat(beforeDueRun.evaluatedCount()).isZero();

        // 3. Siete horas después (> 6h del plan PRO) con fallo en el feed: tolera el error y activa alerta visible
        devMonitoringService.setCatalogFetcherOverride((t, p) -> {
            throw new IllegalStateException("Feed OSV temporalmente no disponible");
        });
        try {
            var failedRun = devMonitoringService.runScheduledEvaluations(t0.plus(7, ChronoUnit.HOURS));
            assertThat(failedRun.failedCount()).isGreaterThanOrEqualTo(1);

            mockMvc.perform(get("/api/v1/dev/projects/{id}/monitoring", projectId)
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.feedStaleWarning").value(true));
        } finally {
            devMonitoringService.setCatalogFetcherOverride(null);
            devMonitoringService.clearFeedFailureState();
            devMonitoringService.setLastFeedRefreshAt(Instant.now());
        }

        // 4. Al recuperarse el feed, la siguiente ejecución programada pasa en verde y deduplica
        var recoveredRun = devMonitoringService.runScheduledEvaluations(t0.plus(8, ChronoUnit.HOURS));
        assertThat(recoveredRun.failedCount()).isZero();
        assertThat(recoveredRun.evaluatedCount()).isGreaterThanOrEqualTo(1);
        assertThat(recoveredRun.newAlertsTotal()).isZero();
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
