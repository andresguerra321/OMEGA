package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.LegalQuotaProperties;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.config.SensorHmac;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.multimodal.MultimodalThreatQueryService;
import com.omega.platform.repository.ApiTokenRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.security.TooManyLoginAttemptsException;
import com.omega.platform.service.ApiTokenService;
import com.omega.platform.service.LegalQuotaService;
import com.omega.platform.service.OsintExposureService;
import com.omega.platform.web.PublicMultimodalController;
import com.omega.platform.web.RepoScannerProxyController;
import java.net.URI;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@org.springframework.context.annotation.Import(PaidWorkspaceFixture.class)
class SecurityAuditWave2HardeningTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static org.testcontainers.containers.PostgreSQLContainer<?> pgContainer;

    @DynamicPropertySource
    static void wave2Props(DynamicPropertyRegistry registry) {
        registry.add("omega.osint.external-lookups-enabled", () -> "false");
        registry.add("omega.osint.max-scans-per-window", () -> "2");
        registry.add("omega.security.allow-tenant-self-registration", () -> "true");
        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            @SuppressWarnings("resource")
            var container = new org.testcontainers.containers.PostgreSQLContainer<>(
                    org.testcontainers.utility.DockerImageName.parse("pgvector/pgvector:pg16")
                            .asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_wave2_test")
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

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired ApiTokenService apiTokenService;
    @Autowired ApiTokenRepository apiTokenRepository;
    @Autowired LegalQuotaService legalQuotaService;
    @Autowired LegalQuotaProperties legalQuotaProperties;
    @Autowired DocumentRepository documentRepository;
    @Autowired TenantRepository tenantRepository;
    @Autowired OsintExposureService osintExposureService;
    @Autowired OmegaProperties omegaProperties;

    private record TenantSession(UUID tenantId, UUID userId, String token, String email) {}

    private TenantSession registerTenant(String prefix, String remoteIp) throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String slug = "wave-" + prefix + "-" + suffix;
        String email = "admin@" + slug + ".invalid";
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .with(csrf())
                        .with(req -> {
                            req.setRemoteAddr(remoteIp);
                            return req;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "tenantSlug", slug,
                                "tenantName", "Org " + slug,
                                "adminEmail", email,
                                "adminPassword", "Wave2Strong!Pass99",
                                "adminFullName", "Admin Wave"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString());
        return new TenantSession(
                UUID.fromString(json.get("tenantId").asText()),
                UUID.fromString(json.get("userId").asText()),
                json.get("accessToken").asText(),
                email
        );
    }

    // -------------------------------------------------------------------------
    // B-05: GitHub redirect allowlist + Authorization stripping across hosts
    // -------------------------------------------------------------------------
    @Test
    void b05_githubRedirectAllowlistAndAuthorizationStripping() {
        HttpRequest initial = HttpRequest.newBuilder()
                .uri(URI.create("https://api.github.com/repos/org/repo/tarball"))
                .header("Authorization", "Bearer ghp_super_secret")
                .GET()
                .build();

        // Cross-host redirect to allowed codeload.github.com MUST strip Authorization
        HttpRequest toCodeload = RepoScannerProxyController.buildValidatedRedirectRequest(
                initial, "https://codeload.github.com/org/repo/legacy.tar.gz/main");
        assertThat(toCodeload.uri().getHost()).isEqualTo("codeload.github.com");
        assertThat(toCodeload.headers().firstValue("Authorization")).isEmpty();

        // Same-host redirect on api.github.com preserves Authorization
        HttpRequest sameHost = RepoScannerProxyController.buildValidatedRedirectRequest(
                initial, "https://api.github.com/repos/org/repo/tarball/main");
        assertThat(sameHost.headers().firstValue("Authorization")).contains("Bearer ghp_super_secret");

        // Disallowed host or non-HTTPS redirect MUST be rejected with 502
        assertThatThrownBy(() -> RepoScannerProxyController.buildValidatedRedirectRequest(
                initial, "https://evil.example.com/steal-token"))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.BAD_GATEWAY);

        assertThatThrownBy(() -> RepoScannerProxyController.buildValidatedRedirectRequest(
                initial, "http://codeload.github.com/org/repo/tarball"))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.BAD_GATEWAY);
    }

    // -------------------------------------------------------------------------
    // B-06: Atomic consumption of API token maxUses and monthly quota (no TOCTOU)
    // -------------------------------------------------------------------------
    @Test
    void b06_atomicApiTokenAndMonthlyQuotaConsumptionUnderConcurrency() throws Exception {
        TenantSession session = registerTenant("b06", "198.51.100.11");
        // Provision subscription once before concurrent token/quota consumption
        apiTokenService.resolveMonthlyScanQuota(session.tenantId());
        int maxUses = 3;
        var created = apiTokenService.createToken(session.tenantId(), session.userId(), "wave2-atomic", 7, maxUses);
        UUID tokenId = created.token().id();

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger successes = new AtomicInteger();
        AtomicInteger rateLimited = new AtomicInteger();
        List<Future<?>> futures = new ArrayList<>();

        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                try {
                    start.await();
                    apiTokenService.consumeScanQuotaAndTokenUse(session.tenantId(), tokenId);
                    successes.incrementAndGet();
                } catch (ResponseStatusException ex) {
                    if (ex.getStatusCode().value() == 429) {
                        rateLimited.incrementAndGet();
                    }
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                }
            }));
        }
        start.countDown();
        for (Future<?> f : futures) {
            f.get();
        }
        pool.shutdownNow();

        assertThat(successes.get()).isEqualTo(maxUses);
        assertThat(rateLimited.get()).isEqualTo(threads - maxUses);
        assertThat(apiTokenRepository.findByIdAndTenantId(tokenId, session.tenantId()).orElseThrow().getUsesCount())
                .isEqualTo(maxUses);
    }

    // -------------------------------------------------------------------------
    // B-07: maxTotalBytesPerCase, OSINT tenant quota, AuthController rate limits
    // -------------------------------------------------------------------------
    @Test
    void b07_legalMaxTotalBytesPerCaseAndOsintAndAuthRateLimits() throws Exception {
        TenantSession session = registerTenant("b07", "198.51.100.12");

        // Switch tenant to LEGAL profile to test maxTotalBytesPerCase
        var tenant = tenantRepository.findById(session.tenantId()).orElseThrow();
        tenant.setProfile(TenantProfile.LEGAL);
        tenantRepository.saveAndFlush(tenant);

        MvcResult expRes = mockMvc.perform(post("/api/v1/expedientes")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + session.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Expediente Cuota Bytes",
                                "description", "Prueba B-07"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        UUID expedienteId = UUID.fromString(
                objectMapper.readTree(expRes.getResponse().getContentAsString()).get("id").asText());

        OmegaPrincipal principal = new OmegaPrincipal(
                session.userId(), session.tenantId(), session.email(), Role.ADMIN, true);
        long planMaxBytes = legalQuotaService.currentPlanSummary(principal).maxTotalBytesPerCase();

        // Persist a document occupying almost the entire case byte quota
        DocumentEntity doc = new DocumentEntity(
                session.tenantId(), expedienteId, session.userId(),
                "existing.pdf", "a".repeat(64), 1, "test-emb", false, DocumentStatus.INDEXED);
        doc.setFileSizeBytes(planMaxBytes - 512L);
        documentRepository.saveAndFlush(doc);

        // A 1024-byte incoming upload must be rejected atomically by reserveUploadSlot
        assertThatThrownBy(() -> legalQuotaService.reserveUploadSlot(principal, expedienteId, 1024L))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        // A 256-byte incoming upload fits within maxTotalBytesPerCase
        var okSlot = legalQuotaService.reserveUploadSlot(principal, expedienteId, 256L);
        assertThat(okSlot.active()).isTrue();
        legalQuotaService.releaseUploadReservation(okSlot);

        // OSINT per-tenant rate limit (configured to 2 per window in @DynamicPropertySource)
        var asset = osintExposureService.registerAsset(principal, "domain", "wave2-osint.example.com", true);
        osintExposureService.scanAsset(principal, asset.id());
        osintExposureService.scanAsset(principal, asset.id());
        assertThatThrownBy(() -> osintExposureService.scanAsset(principal, asset.id()))
                .isInstanceOf(TooManyLoginAttemptsException.class);

        // AuthController persistent rate limiting on /mfa/disable (5 failed password attempts -> 429 on 6th)
        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/v1/auth/mfa/disable")
                            .with(csrf())
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + session.token())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("password", "WrongPass!123"))))
                    .andExpect(status().isUnauthorized());
        }
        mockMvc.perform(post("/api/v1/auth/mfa/disable")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + session.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("password", "WrongPass!123"))))
                .andExpect(status().isTooManyRequests());

        // AuthController persistent rate limiting on /recovery-key (5 calls -> 429 on 6th)
        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/v1/auth/recovery-key")
                            .with(csrf())
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + session.token())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("password", "WrongPass!123"))))
                    .andExpect(status().isUnauthorized());
        }
        mockMvc.perform(post("/api/v1/auth/recovery-key")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + session.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("password", "WrongPass!123"))))
                .andExpect(status().isTooManyRequests());
    }

    // -------------------------------------------------------------------------
    // B-08: @Size(max = 2000) on RagQueryController + pre-heap size check on PublicMultimodalController
    // -------------------------------------------------------------------------
    @Test
    void b08_ragQuestionLengthLimitAndPublicMultimodalSizeCheckBeforeReadingBytes() throws Exception {
        TenantSession session = registerTenant("b08", "198.51.100.13");
        MockMultipartFile tinyPng = new MockMultipartFile(
                "image", "tiny.png", "image/png", new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47});

        // RagQueryController rejects question > 2000 chars with 400 Bad Request
        mockMvc.perform(multipart("/api/v1/expedientes/{id}/query/multimodal", UUID.randomUUID())
                        .file(tinyPng)
                        .param("question", "a".repeat(2001))
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + session.token()))
                .andExpect(status().isBadRequest());

        // PublicMultimodalController rejects oversized image BEFORE calling image.getBytes()
        MultimodalThreatQueryService multimodalMock = mock(MultimodalThreatQueryService.class);
        PublicMultimodalController controller = new PublicMultimodalController(multimodalMock, omegaProperties);
        MultipartFile hugeFile = mock(MultipartFile.class);
        when(hugeFile.isEmpty()).thenReturn(false);
        when(hugeFile.getSize()).thenReturn(omegaProperties.ingest().maxImageBytes() + 1L);

        assertThatThrownBy(() -> controller.queryPublicMultimodal(null, hugeFile, "check"))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        verify(hugeFile, never()).getBytes();
    }

    // -------------------------------------------------------------------------
    // C-09: Java <-> Python HMAC canonicalization parity
    // -------------------------------------------------------------------------
    @Test
    void c09_sensorHmacCanonicalizesActorAndContentTypeConsistently() {
        byte[] zeroKey = new byte[32];
        String sig1 = SensorHmac.sign(
                zeroKey, "request", "POST", "/api/containment/execute",
                "1700000000", "0123456789abcdef0123456789abcdef",
                "{}".getBytes(StandardCharsets.UTF_8),
                "actor-42", "application/json; charset=utf-8");
        String sig2 = SensorHmac.sign(
                zeroKey, "request", "POST", "/api/containment/execute",
                "1700000000", "0123456789abcdef0123456789abcdef",
                "{}".getBytes(StandardCharsets.UTF_8),
                "  actor-42  ", "APPLICATION/JSON; boundary=xyz");
        assertThat(sig1).isEqualTo(sig2).hasSize(64);
    }
}
