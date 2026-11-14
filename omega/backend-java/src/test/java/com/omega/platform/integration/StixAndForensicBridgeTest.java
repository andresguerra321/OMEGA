package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.cti.StixCatalogService.StixSyncSummary;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.service.AuditLogService;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
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
class StixAndForensicBridgeTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static HttpServer mockWorkerServer;
    private static final AtomicReference<String> CAPTURED_INTERNAL_TOKEN = new AtomicReference<>();

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (mockWorkerServer == null) {
            mockWorkerServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            mockWorkerServer.createContext("/api/triage/parallel", exchange -> {
                CAPTURED_INTERNAL_TOKEN.set(exchange.getRequestHeaders().getFirst("X-Internal-Service-Token"));
                byte[] json = """
                        {
                          "pipeline_mode": "Unified In-RAM Triage",
                          "total_files": 1,
                          "total_indicators_analyzed": 12,
                          "total_matches": 1,
                          "crash_anomalies": [],
                          "behavioral_anomalies": [],
                          "manifest_findings": [],
                          "yara_hits": [],
                          "device_summary": {},
                          "hardening_checks": [],
                          "abuse_alerts": [],
                          "live_sockets": [],
                          "live_sockets_total": 0,
                          "cached_dns_count": 0,
                          "cached_dns_sample": [],
                          "timeline": [],
                          "timeline_summary": {},
                          "yara_engine": {"yara_available": true},
                          "diagnosis": {
                            "verdict_code": "CORROBORATED_INFECTION_PATTERN",
                            "verdict_label": "Coincidencia confirmada en RAM",
                            "confidence": "Alta",
                            "is_likely_false_positive": false,
                            "rationale": "Patrón validado.",
                            "recommended_actions": ["Preservar evidencia"]
                          },
                          "subagents": [],
                          "ephemeral_notice": "0 bytes en disco"
                        }
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, json.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(json);
                }
            });
            mockWorkerServer.createContext("/api/link/verify", exchange -> {
                CAPTURED_INTERNAL_TOKEN.set(exchange.getRequestHeaders().getFirst("X-Internal-Service-Token"));
                byte[] json = """
                        {
                          "normalized_url": "https://free247downloads.com/login",
                          "host": "free247downloads.com",
                          "root_domain": "free247downloads.com",
                          "scheme": "https",
                          "path": "/login",
                          "risk_level": "HIGH",
                          "verdict": "Peligroso",
                          "recommendation": "No abrir",
                          "heuristics": [],
                          "passive_ct_certificates": 1,
                          "cti_matches": [],
                          "privacy_notice": "Consulta pasiva sin contactar destino"
                        }
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, json.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(json);
                }
            });
            mockWorkerServer.start();
        }
        registry.add("omega.forensic-worker.base-url",
                () -> "http://127.0.0.1:" + mockWorkerServer.getAddress().getPort());

        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            pgContainer = new PostgreSQLContainer<>(
                    DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_rag_test")
                    .withUsername("omega_test")
                    .withPassword("omega_test_secret");
            pgContainer.start();
        }
        String baseUrl = pgContainer.getJdbcUrl();
        String sep = baseUrl.contains("?") ? "&" : "?";
        registry.add("spring.datasource.url", () -> baseUrl + sep + "currentSchema=omega_rag,public");
        registry.add("spring.datasource.username", pgContainer::getUsername);
        registry.add("spring.datasource.password", pgContainer::getPassword);
    }

    @AfterAll
    static void stopMockWorker() {
        if (mockWorkerServer != null) {
            mockWorkerServer.stop(0);
            mockWorkerServer = null;
        }
    }

    private static String envOrDefault(String key, String fallback) {
        String val = System.getenv(key);
        return (val == null || val.isBlank()) ? fallback : val;
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StixCatalogService stixCatalogService;

    @Autowired
    private AuditLogService auditLogService;

    @MockBean
    private EmbeddingProvider embeddingProvider;

    @Test
    void ingestsStix2BundlesIdempotentlyAndEnforcesArchiveSafetyAndInternalServiceToken() throws Exception {
        // 1. Ingesta idempotente STIX 2.1 (incluye normalización de IP dentro de domain-name:value)
        Path tempStixDir = Files.createTempDirectory("omega-stix-test-");
        Files.writeString(
                tempStixDir.resolve("novispy-sample.stix2"),
                """
                {
                  "type": "bundle",
                  "id": "bundle--test-001",
                  "objects": [
                    {
                      "type": "malware",
                      "spec_version": "2.1",
                      "id": "malware--test-novispy",
                      "name": "NoviSpy",
                      "created": "2024-12-16T00:00:00Z"
                    },
                    {
                      "type": "indicator",
                      "spec_version": "2.1",
                      "id": "indicator--test-ip",
                      "pattern": "[domain-name:value='176.223.111.131']"
                    },
                    {
                      "type": "indicator",
                      "spec_version": "2.1",
                      "id": "indicator--test-dom",
                      "pattern": "[domain-name:value='free247downloads.com']"
                    },
                    {
                      "type": "relationship",
                      "relationship_type": "indicates",
                      "source_ref": "indicator--test-ip",
                      "target_ref": "malware--test-novispy"
                    },
                    {
                      "type": "relationship",
                      "relationship_type": "indicates",
                      "source_ref": "indicator--test-dom",
                      "target_ref": "malware--test-novispy"
                    }
                  ]
                }
                """,
                StandardCharsets.UTF_8
        );

        StixSyncSummary firstSync = stixCatalogService.syncDirectory(tempStixDir);
        StixSyncSummary secondSync = stixCatalogService.syncDirectory(tempStixDir);
        assertThat(firstSync.indicatorsParsed()).isEqualTo(2);
        assertThat(secondSync.netIndicatorsInserted()).isZero();
        assertThat(stixCatalogService.lookupIndicator("176.223.111.131"))
                .anySatisfy(ind -> assertThat(ind.getIocType()).isEqualTo("ip"));

        // 2. Autenticar Tenant para pruebas del puente forense
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        MvcResult reg = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantSlug": "bridge-%s",
                                  "tenantName": "Bridge Lab",
                                  "adminEmail": "lead@%s.org",
                                  "adminPassword": "ClaveSuperSegura2026!",
                                  "adminFullName": "Lead Analyst"
                                }
                                """.formatted(suffix, suffix)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode tenant = objectMapper.readTree(reg.getResponse().getContentAsString());
        String token = tenant.get("accessToken").asText();
        UUID tenantId = UUID.fromString(tenant.get("tenantId").asText());

        // 3. Bloqueo de Zip Slip antes de enviar al worker
        byte[] zipSlip = createSingleEntryZip("../../etc/passwd", "root:x:0:0".getBytes(StandardCharsets.UTF_8));
        mockMvc.perform(multipart("/api/v1/forensics/triage")
                        .file(new MockMultipartFile("files", "evil.zip", "application/zip", zipSlip))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("Zip Slip")));

        // 4. Bloqueo de bomba de descompresión (>32MB descomprimidos en entrada única)
        byte[] bombZip = createSingleEntryZip("huge.json", new byte[33 * 1024 * 1024]);
        mockMvc.perform(multipart("/api/v1/forensics/triage")
                        .file(new MockMultipartFile("files", "bomb.zip", "application/zip", bombZip))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnprocessableEntity());

        // 5. Llamada legítima envía X-Internal-Service-Token al worker forense y registra auditoría
        mockMvc.perform(multipart("/api/v1/forensics/triage")
                        .file(new MockMultipartFile("files", "safari.json", "application/json",
                                "{\"history\":[]}".getBytes(StandardCharsets.UTF_8)))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.diagnosis.verdict_code").value("CORROBORATED_INFECTION_PATTERN"));

        assertThat(CAPTURED_INTERNAL_TOKEN.get()).isEqualTo("omega-test-internal-service-token");

        mockMvc.perform(post("/api/v1/forensics/link/verify")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "url": "https://free247downloads[.]com/login" }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.risk_level").value("HIGH"));

        mockMvc.perform(get("/api/v1/cti/indicators/lookup?value=176.223.111.131")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].iocType").value("ip"));

        assertThat(auditLogService.listRecent(tenantId, 10))
                .anySatisfy(e -> assertThat(e.getAction()).isEqualTo("FORENSIC_TRIAGE_EXECUTED"))
                .anySatisfy(e -> assertThat(e.getAction()).isEqualTo("FORENSIC_LINK_VERIFIED"));
        assertThat(auditLogService.verifyTenantChain(tenantId).valid()).isTrue();
    }

    private static byte[] createSingleEntryZip(String entryName, byte[] payload) throws Exception {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos)) {
            zos.putNextEntry(new ZipEntry(entryName));
            zos.write(payload);
            zos.closeEntry();
            zos.finish();
            return baos.toByteArray();
        }
    }
}
