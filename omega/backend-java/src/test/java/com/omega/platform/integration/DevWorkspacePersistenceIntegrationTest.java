package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DevDependencyEntity;
import com.omega.platform.domain.DevFindingCommentEntity;
import com.omega.platform.domain.DevFindingEntity;
import com.omega.platform.domain.DevMonitorSubscriptionEntity;
import com.omega.platform.domain.DevPolicyEntity;
import com.omega.platform.domain.DevProjectEntity;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.domain.DevSuppressionEntity;
import com.omega.platform.repository.DevDependencyRepository;
import com.omega.platform.repository.DevFindingCommentRepository;
import com.omega.platform.repository.DevFindingRepository;
import com.omega.platform.repository.DevMonitorSubscriptionRepository;
import com.omega.platform.repository.DevPolicyRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DevScanRepository;
import com.omega.platform.repository.DevSuppressionRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Verificación del Bloque DB (migración V20):
 * Persistencia de proyectos, escaneos, hallazgos, comentarios, supresiones, dependencias,
 * políticas y suscripciones; borrado en cascada completo y aislamiento estricto por tenant.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DevWorkspacePersistenceIntegrationTest {

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
                    .withDatabaseName("omega_dev_v20_test")
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
    @Autowired private TransactionTemplate transactionTemplate;
    @Autowired private DevProjectRepository projectRepository;
    @Autowired private DevScanRepository scanRepository;
    @Autowired private DevFindingRepository findingRepository;
    @Autowired private DevFindingCommentRepository commentRepository;
    @Autowired private DevSuppressionRepository suppressionRepository;
    @Autowired private DevDependencyRepository dependencyRepository;
    @Autowired private DevPolicyRepository policyRepository;
    @Autowired private DevMonitorSubscriptionRepository monitorRepository;

    @Test
    void persistsDerivedDevMetadataEnforcesTenantIsolationAndCascadesOnDelete() throws Exception {
        JsonNode tenantA = registerDevTenant("dev-v20-a-" + UUID.randomUUID().toString().substring(0, 8));
        JsonNode tenantB = registerDevTenant("dev-v20-b-" + UUID.randomUUID().toString().substring(0, 8));
        UUID tenantIdA = UUID.fromString(tenantA.get("tenantId").asText());
        UUID userIdA = UUID.fromString(tenantA.get("userId").asText());
        UUID tenantIdB = UUID.fromString(tenantB.get("tenantId").asText());

        DevProjectEntity project = projectRepository.saveAndFlush(new DevProjectEntity(
                tenantIdA, userIdA, "Checkout API", "checkout-api",
                "https://github.com/acme/checkout-api", "main", "GITHUB_URL"));

        DevScanEntity scan = scanRepository.saveAndFlush(new DevScanEntity(
                tenantIdA, project.getId(), userIdA, "URL", "2.0.0", "abc1234", "main",
                35.0, 35.0, false, "[{\"rule\":\"NPM-POSTINSTALL-EXEC-01\",\"points\":35}]",
                "{\"max_bytes\":52428800,\"files_scanned\":12}", 1, 1, "FAIL"));

        DevFindingEntity finding = findingRepository.saveAndFlush(new DevFindingEntity(
                tenantIdA, project.getId(), scan.getId(),
                "a".repeat(64), "NPM-POSTINSTALL-EXEC-01", "static", "HIGH",
                "Script postinstall sospechoso", "package.json:12",
                "Se detectó un script de instalación con ejecución de shell.", 35.0));

        commentRepository.saveAndFlush(new DevFindingCommentEntity(
                tenantIdA, finding.getId(), userIdA, "Revisando con el equipo de build."));

        suppressionRepository.saveAndFlush(new DevSuppressionEntity(
                tenantIdA, project.getId(), "NPM-POSTINSTALL-EXEC-01", finding.getFingerprint(),
                "Compilación nativa interna verificada", userIdA, Instant.now().plus(30, ChronoUnit.DAYS)));

        dependencyRepository.saveAndFlush(new DevDependencyEntity(
                tenantIdA, project.getId(), scan.getId(), "npm", "lodash", "4.17.21",
                "pkg:npm/lodash@4.17.21", "package.json", true));

        policyRepository.saveAndFlush(new DevPolicyEntity(
                tenantIdA, project.getId(), "HIGH", "FAIL_PIPELINE", "[\"lodash\"]", "[\"evil-pkg\"]", userIdA));

        monitorRepository.saveAndFlush(new DevMonitorSubscriptionEntity(
                tenantIdA, project.getId(), "WEBHOOK", "HIGH", userIdA));

        // Aislamiento por tenant: Tenant B no ve el proyecto ni puede borrarlo
        assertThat(projectRepository.findByIdAndTenantId(project.getId(), tenantIdB)).isEmpty();
        assertThat(scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantIdB, project.getId())).isEmpty();
        assertThat(findingRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantIdB, project.getId())).isEmpty();
        long deletedByB = transactionTemplate.execute(tx -> projectRepository.deleteByIdAndTenantId(project.getId(), tenantIdB));
        assertThat(deletedByB).isZero();
        assertThat(projectRepository.findByIdAndTenantId(project.getId(), tenantIdA)).isPresent();

        // Borrado por Tenant A elimina en cascada TODO lo derivado
        long deletedByA = transactionTemplate.execute(tx -> projectRepository.deleteByIdAndTenantId(project.getId(), tenantIdA));
        assertThat(deletedByA).isEqualTo(1L);

        assertThat(projectRepository.findByIdAndTenantId(project.getId(), tenantIdA)).isEmpty();
        assertThat(scanRepository.countByTenantIdAndProjectId(tenantIdA, project.getId())).isZero();
        assertThat(findingRepository.countByTenantIdAndProjectId(tenantIdA, project.getId())).isZero();
        assertThat(commentRepository.countByTenantIdAndFindingId(tenantIdA, finding.getId())).isZero();
        assertThat(suppressionRepository.countByTenantIdAndProjectId(tenantIdA, project.getId())).isZero();
        assertThat(dependencyRepository.countByTenantIdAndProjectId(tenantIdA, project.getId())).isZero();
        assertThat(policyRepository.countByTenantIdAndProjectId(tenantIdA, project.getId())).isZero();
        assertThat(monitorRepository.countByTenantIdAndProjectId(tenantIdA, project.getId())).isZero();
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
