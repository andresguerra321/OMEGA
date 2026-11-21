package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.LegalQuotaProperties;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.LegalQuotaService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Q8 (hardening): Prueba de concurrencia real sobre PostgreSQL (Testcontainers) verificando que
 * los contadores en omega_rag.legal_rate_limit_windows y omega_rag.legal_indexing_inflight son
 * persistentes, atómicos bajo contención multi-hilo y reversibles ante fallo.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LegalQuotaConcurrencyTest {

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
    @Autowired private LegalQuotaService quotaService;
    @Autowired private LegalQuotaProperties quotaProperties;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void enforcesAtomicPersistentRateLimitsUnderMultiThreadContentionAndReversesFailedUploads() throws Exception {
        String slug = "legal-conc-" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult reg = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"tenantName\":\"Despacho Concurrencia\","
                                + "\"adminEmail\":\"admin@" + slug + ".invalid\",\"adminPassword\":\"OmegaConc!2026\","
                                + "\"adminFullName\":\"Admin Concurrencia\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode body = objectMapper.readTree(reg.getResponse().getContentAsString());
        String token = body.path("accessToken").asText();
        UUID tenantId = UUID.fromString(body.path("tenantId").asText());
        UUID userId = UUID.fromString(body.path("userId").asText());

        mockMvc.perform(put("/api/v1/profile").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isOk());

        var personal = quotaProperties.forPlan("PERSONAL");
        int origQueryLimit = personal.getQueryPerMinute();
        int origUploadLimit = personal.getUploadPerMinute();
        int origConcurrent = personal.getMaxConcurrentIndexing();
        personal.setQueryPerMinute(3);
        personal.setUploadPerMinute(2);
        personal.setMaxConcurrentIndexing(2);

        OmegaPrincipal actor = new OmegaPrincipal(userId, tenantId, "admin@" + slug + ".invalid", Role.ADMIN, true);
        UUID caseId = UUID.randomUUID();
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            // 1. 8 hilos compiten simultáneamente por queryPerMinute = 3 -> EXACTAMENTE 3 deben pasar, 5 deben recibir 429
            CountDownLatch ready = new CountDownLatch(8);
            CountDownLatch go = new CountDownLatch(1);
            AtomicInteger querySuccess = new AtomicInteger();
            AtomicInteger queryRateLimited = new AtomicInteger();
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    try { go.await(); } catch (InterruptedException ignored) {}
                    try {
                        quotaService.checkQueryRate(actor);
                        querySuccess.incrementAndGet();
                    } catch (ResponseStatusException ex) {
                        if (ex.getStatusCode().value() == 429) {
                            queryRateLimited.incrementAndGet();
                        } else {
                            throw ex;
                        }
                    }
                }));
            }
            ready.await();
            go.countDown();
            for (Future<?> f : futures) f.get();

            assertThat(querySuccess.get()).isEqualTo(3);
            assertThat(queryRateLimited.get()).isEqualTo(5);

            // Verificar persistencia real en PostgreSQL
            Integer dbQueryCount = jdbc.queryForObject(
                    "SELECT request_count FROM omega_rag.legal_rate_limit_windows WHERE tenant_id = ? AND bucket_type = 'QUERY'",
                    Integer.class, tenantId);
            assertThat(dbQueryCount).isEqualTo(3);

            // 2. Reserva de carga y reversión atómica en BD
            var r1 = quotaService.reserveUploadSlot(actor, caseId);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.legal_indexing_inflight WHERE tenant_id = ?", Integer.class, tenantId))
                    .isEqualTo(1);
            quotaService.releaseUploadReservation(r1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM omega_rag.legal_indexing_inflight WHERE tenant_id = ?", Integer.class, tenantId))
                    .isEqualTo(0);
            Integer dbUploadAfterRelease = jdbc.queryForObject(
                    "SELECT request_count FROM omega_rag.legal_rate_limit_windows WHERE tenant_id = ? AND bucket_type = 'UPLOAD'",
                    Integer.class, tenantId);
            assertThat(dbUploadAfterRelease).isEqualTo(0);

            // 3. 6 hilos compiten por uploadPerMinute = 2 -> EXACTAMENTE 2 pasan
            CountDownLatch uReady = new CountDownLatch(6);
            CountDownLatch uGo = new CountDownLatch(1);
            AtomicInteger uploadSuccess = new AtomicInteger();
            AtomicInteger uploadLimited = new AtomicInteger();
            List<Future<?>> uFutures = new ArrayList<>();
            for (int i = 0; i < 6; i++) {
                uFutures.add(pool.submit(() -> {
                    uReady.countDown();
                    try { uGo.await(); } catch (InterruptedException ignored) {}
                    try {
                        var res = quotaService.reserveUploadSlot(actor, caseId);
                        quotaService.commitUploadReservation(res);
                        uploadSuccess.incrementAndGet();
                    } catch (ResponseStatusException ex) {
                        if (ex.getStatusCode().value() == 429) {
                            uploadLimited.incrementAndGet();
                        } else {
                            throw ex;
                        }
                    }
                }));
            }
            uReady.await();
            uGo.countDown();
            for (Future<?> f : uFutures) f.get();
            assertThat(uploadSuccess.get()).isEqualTo(2);
            assertThat(uploadLimited.get()).isEqualTo(4);
        } finally {
            pool.shutdownNow();
            personal.setQueryPerMinute(origQueryLimit);
            personal.setUploadPerMinute(origUploadLimit);
            personal.setMaxConcurrentIndexing(origConcurrent);
        }
    }
}
