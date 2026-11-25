package com.omega.platform.integration;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.RestClientConfig;
import com.omega.platform.domain.CampaignEntity;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.repository.CampaignRepository;
import com.omega.platform.service.AuditLogService;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
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
@org.springframework.context.annotation.Import(PaidWorkspaceFixture.class)
class FrontendGatewayIntegrationTest {

        private static final String EXPECTED_INTERNAL_TOKEN = "omega-test-internal-service-token";
        private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
        private static PostgreSQLContainer<?> pgContainer;
        private static HttpServer mockWorker;
        private static final AtomicReference<String> LAST_INTERNAL_TOKEN = new AtomicReference<>();
        private static final AtomicBoolean FORCE_WRONG_IOS_PASSWORD = new AtomicBoolean(false);
        private static final AtomicBoolean FORCE_INVALID_INTERNAL_TOKEN = new AtomicBoolean(false);

        @DynamicPropertySource
        static void registerProps(DynamicPropertyRegistry registry) throws Exception {
                if (mockWorker == null) {
                        mockWorker = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);

                        mockWorker.createContext("/api/ioc/verify/text", exchange -> {
                                LAST_INTERNAL_TOKEN.set(exchange.getRequestHeaders()
                                                .getFirst(RestClientConfig.INTERNAL_TOKEN_HEADER));
                                writeJson(exchange, 200, """
                                                {
                                                  "detected_format": "plain_indicators",
                                                  "analyzed_indicators": 2,
                                                  "total_matches": 1,
                                                  "breakdown": {"domain": 1},
                                                  "ephemeral_notice": "Procesado en RAM",
                                                  "matches": [{
                                                    "ioc_type": "domain",
                                                    "ioc_value": "bad-pegasus.example",
                                                    "match_precision": "exact",
                                                    "artifact_origin": "consulta_manual.txt",
                                                    "context": "C2 server",
                                                    "campaign": "Pegasus Test",
                                                    "spyware_family": "Pegasus",
                                                    "source_report": "Citizen Lab",
                                                    "organization": "Citizen Lab",
                                                    "source_url": "https://citizenlab.ca"
                                                  }]
                                                }
                                                """);
                        });

                        mockWorker.createContext("/api/triage/pc-live", exchange -> {
                                LAST_INTERNAL_TOKEN.set(exchange.getRequestHeaders()
                                                .getFirst(RestClientConfig.INTERNAL_TOKEN_HEADER));
                                writeJson(exchange, 200, """
                                                {
                                                  "pipeline_mode": "PC Host Live Audit",
                                                  "total_files": 1,
                                                  "total_indicators_analyzed": 8,
                                                  "total_matches": 0,
                                                  "yara_hits": [],
                                                  "diagnosis": {
                                                    "verdict_code": "CLEAN_NO_MATCHES",
                                                    "verdict_label": "Sin coincidencias en host",
                                                    "confidence": "HIGH",
                                                    "is_likely_false_positive": false,
                                                    "rationale": "Ningún socket o proceso sospechoso",
                                                    "recommended_actions": []
                                                  }
                                                }
                                                """);
                        });

                        mockWorker.createContext("/api/triage/ios-manifest-decrypt", exchange -> {
                                String token = exchange.getRequestHeaders()
                                                .getFirst(RestClientConfig.INTERNAL_TOKEN_HEADER);
                                LAST_INTERNAL_TOKEN.set(token);
                                if (FORCE_INVALID_INTERNAL_TOKEN.get() || !EXPECTED_INTERNAL_TOKEN.equals(token)) {
                                        writeJson(exchange, 401,
                                                        "{\"detail\":\"Acceso denegado: X-Internal-Service-Token ausente o inválido.\"}");
                                        return;
                                }
                                if (FORCE_WRONG_IOS_PASSWORD.get()) {
                                        writeJson(exchange, 401,
                                                        "{\"detail\":\"Contraseña incorrecta para la copia de seguridad iOS.\"}");
                                        return;
                                }
                                writeJson(exchange, 200,
                                                """
                                                                {
                                                                  "manifest_encrypted": true,
                                                                  "targets_count": 2,
                                                                  "targets": [{"file_id": "abc123", "domain": "HomeDomain", "relative_path": "Library/SMS/sms.db"}]
                                                                }
                                                                """);
                        });

                        mockWorker.createContext("/api/campaigns/", exchange -> {
                                LAST_INTERNAL_TOKEN.set(exchange.getRequestHeaders()
                                                .getFirst(RestClientConfig.INTERNAL_TOKEN_HEADER));
                                writeJson(exchange, 200, """
                                                {
                                                  "campaign_id": "test-id",
                                                  "campaign_name": "Test Spyware",
                                                  "filename": "omega_triage.sh",
                                                  "ioc_count": 3,
                                                  "script": "#!/usr/bin/env bash\\necho OMEGA"
                                                }
                                                """);
                        });

                        mockWorker.start();
                }
                registry.add("omega.forensic-worker.base-url",
                                () -> "http://127.0.0.1:" + mockWorker.getAddress().getPort());

                if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
                        registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
                        registry.add("spring.datasource.username",
                                        () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
                        registry.add("spring.datasource.password",
                                        () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
                        return;
                }
                if (pgContainer == null) {
                        @SuppressWarnings("resource") // Container Testcontainers singleton gestionado por Ryuk al terminar la JVM.
                        PostgreSQLContainer<?> container = new PostgreSQLContainer<>(
                                        DockerImageName.parse("pgvector/pgvector:pg16")
                                                        .asCompatibleSubstituteFor("postgres"))
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

        @AfterAll
        static void shutdownWorker() {
                if (mockWorker != null) {
                        mockWorker.stop(0);
                        mockWorker = null;
                }
        }

        private static String envOrDefault(String key, String fallback) {
                String val = System.getenv(key);
                return (val == null || val.isBlank()) ? fallback : val;
        }

        private static void writeJson(com.sun.net.httpserver.HttpExchange exchange, int status, String payload)
                        throws java.io.IOException {
                byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(status, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                        os.write(bytes);
                }
        }

        @Autowired
        private MockMvc mockMvc;

        @Autowired
        private ObjectMapper objectMapper;

        @Autowired
        private CampaignRepository campaignRepository;

        @Autowired
        private AuditLogService auditLogService;

        @MockBean
        private EmbeddingProvider embeddingProvider;

        private JsonNode registerTenant(String prefix) throws Exception {
                long bits = UUID.randomUUID().getMostSignificantBits() & 0xFFFF_FFFFL;
                char[] consonants = "bdfgklmnprstv".toCharArray();
                char[] vowels = "aeiou".toCharArray();
                StringBuilder tag = new StringBuilder();
                for (int i = 0; i < 4; i++) {
                        tag.append(consonants[(int) (bits % consonants.length)]);
                        bits /= consonants.length;
                        tag.append(vowels[(int) (bits % vowels.length)]);
                        bits /= vowels.length;
                }
                String suffix = tag.toString();
                String slug = prefix + "-" + suffix;
                MvcResult result = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "tenantSlug": "%s",
                                                  "tenantName": "Org %s",
                                                  "adminEmail": "admin@%s.example",
                                                  "adminPassword": "OmegaStrongPassword123!",
                                                  "adminFullName": "Admin User"
                                                }
                                                """.formatted(slug, suffix, slug)))
                                .andExpect(status().isCreated())
                                .andReturn();
                return objectMapper.readTree(result.getResponse().getContentAsString());
        }

        private String loginTenantUser(String tenantSlug, String adminToken, String email, String role)
                        throws Exception {
                mockMvc.perform(post("/api/v1/auth/users").with(csrf())
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "email": "%s",
                                                  "password": "OmegaClientPassword123!",
                                                  "fullName": "Member User",
                                                  "role": "%s"
                                                }
                                                """.formatted(email, role)))
                                .andExpect(status().isCreated());

                MvcResult login = mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "tenantSlug": "%s",
                                                  "email": "%s",
                                                  "password": "OmegaClientPassword123!"
                                                }
                                                """.formatted(tenantSlug, email)))
                                .andExpect(status().isOk())
                                .andReturn();
                return objectMapper.readTree(login.getResponse().getContentAsString()).get("accessToken").asText();
        }

        @Test
        void authConfigAndCorsPreflightWorkWithoutJwt() throws Exception {
                mockMvc.perform(get("/api/v1/auth/config"))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.tenantSelfRegistrationEnabled").value(true))
                                .andExpect(jsonPath("$.bootstrapSecretRequired").value(false))
                                .andExpect(jsonPath("$.cookieAuthEnabled").value(true))
                                .andExpect(jsonPath("$.passkeysSupported").value(false))
                                .andExpect(jsonPath("$.localAccessEnabled").value(false));

                mockMvc.perform(post("/api/v1/auth/local-session").with(csrf()))
                                .andExpect(status().isUnauthorized());

                mockMvc.perform(options("/api/v1/auth/config")
                                .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                                .andExpect(status().isOk())
                                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN,
                                                "http://localhost:5173"));
        }

        @Test
        void extendedForensicBridgeHandlesIocPcLiveIosDecryptWithoutJwtFalseLogoutAndMvt() throws Exception {
                JsonNode tenant = registerTenant("forensic-gw");
                String adminToken = tenant.get("accessToken").asText();
                String tenantSlug = tenant.get("tenantSlug").asText();
                String clientToken = loginTenantUser(tenantSlug, adminToken, "client-" + tenantSlug + "@example.org",
                                "CLIENT");

                // IOC text verification (cualquier usuario autenticado)
                mockMvc.perform(post("/api/v1/forensics/ioc/verify/text")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + clientToken)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"indicators_text\":\"bad-pegasus.example\\n198.51.100.7\"}"))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.total_matches").value(1));
                assertThat(LAST_INTERNAL_TOKEN.get()).isEqualTo(EXPECTED_INTERNAL_TOKEN);

                // PC Live triage bloqueado para CLIENT (RBAC) y permitido para ADMIN
                mockMvc.perform(post("/api/v1/forensics/triage/pc-live")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + clientToken)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"platform\":\"win32\",\"host\":{\"hostname\":\"demo\"}}"))
                                .andExpect(status().isForbidden());

                mockMvc.perform(post("/api/v1/forensics/triage/pc-live")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"platform\":\"win32\",\"host\":{\"hostname\":\"demo\"}}"))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.diagnosis.verdict_code").value("CLEAN_NO_MATCHES"));

                // iOS decrypt contraseña errónea -> 400 (nunca 401 hacia SPA), token interno
                // inválido -> 502 fail-closed
                MockMultipartFile plist = new MockMultipartFile("manifest_plist", "Manifest.plist",
                                "application/octet-stream", "bplist00".getBytes());
                MockMultipartFile db = new MockMultipartFile("manifest_db", "Manifest.db", "application/octet-stream",
                                "SQLite format 3".getBytes());

                FORCE_WRONG_IOS_PASSWORD.set(true);
                try {
                        mockMvc.perform(multipart("/api/v1/forensics/triage/ios-manifest-decrypt")
                                        .file(plist)
                                        .file(db)
                                        .param("password", "wrongpass")
                                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                                        .andExpect(status().isBadRequest())
                                        .andExpect(jsonPath("$.title").value("Archivo inválido"));
                } finally {
                        FORCE_WRONG_IOS_PASSWORD.set(false);
                }

                FORCE_INVALID_INTERNAL_TOKEN.set(true);
                try {
                        mockMvc.perform(multipart("/api/v1/forensics/triage/ios-manifest-decrypt")
                                        .file(plist)
                                        .file(db)
                                        .param("password", "goodpass")
                                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                                        .andExpect(status().isBadGateway());
                } finally {
                        FORCE_INVALID_INTERNAL_TOKEN.set(false);
                }

                mockMvc.perform(multipart("/api/v1/forensics/triage/ios-manifest-decrypt")
                                .file(plist)
                                .file(db)
                                .param("password", "goodpass")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.targets_count").value(2));

                // MVT script export
                UUID sampleCampId = UUID.randomUUID();
                mockMvc.perform(get("/api/v1/forensics/campaigns/" + sampleCampId + "/mvt-script")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.filename").value("omega_triage.sh"));
        }

        @Test
        void ctiDossierSsrfProtectionGovernanceAndMultiTenantOsintConsent() throws Exception {
                JsonNode tenantA = registerTenant("osint-a");
                JsonNode tenantB = registerTenant("osint-b");
                String tokenA = tenantA.get("accessToken").asText();
                UUID tenantAId = UUID.fromString(tenantA.get("tenantId").asText());
                String tokenB = tenantB.get("accessToken").asText();
                String clientAToken = loginTenantUser(
                                tenantA.get("tenantSlug").asText(),
                                tokenA,
                                "peer-" + tenantA.get("tenantSlug").asText() + "@example.org",
                                "ANALYST");

                // Seed campaña en omega_rag y comprobar dosier + listado
                CampaignEntity campaign = new CampaignEntity(
                                "report--" + UUID.randomUUID(),
                                "Campaign Gateway Test " + UUID.randomUUID().toString().substring(0, 6),
                                "Pegasus",
                                "Test Actor",
                                "Gateway test campaign description",
                                "Amnesty STIX",
                                Instant.now());
                campaign = campaignRepository.save(campaign);

                mockMvc.perform(get("/api/v1/cti/campaigns")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.campaigns").isArray());

                mockMvc.perform(get("/api/v1/cti/campaigns/" + campaign.getId())
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.spyware_family").value("Pegasus"));

                // Consulta corpus público degradada limpiamente si public.document_chunks no
                // existe
                mockMvc.perform(post("/api/v1/cti/query")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"question\":\"CVE-2021-30860 ForcedEntry\",\"topK\":4}"))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.answer").isString());

                // SSRF protection en webloader-scan bloquea localhost e IP de metadata cloud
                mockMvc.perform(post("/api/v1/cti/webloader-scan")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"url\":\"http://127.0.0.1:8080/actuator/health\"}"))
                                .andExpect(status().isBadRequest());

                mockMvc.perform(post("/api/v1/cti/webloader-scan")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"url\":\"http://169.254.169.254/latest/meta-data/\"}"))
                                .andExpect(status().isBadRequest());

                // Governance multi-tenant
                mockMvc.perform(get("/api/v1/system/governance")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.workspace_id").value(tenantAId.toString()))
                                .andExpect(jsonPath("$.audit_chain_valid").value(true));

                // OSINT rechaza consentimiento en falso
                mockMvc.perform(post("/api/v1/osint/assets")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "asset_type": "domain",
                                                  "asset_value": "medios-defensa.example",
                                                  "explicit_consent": false
                                                }
                                                """))
                                .andExpect(status().isBadRequest());

                // OSINT acepta registro con consentimiento explícito y aísla por tenant y
                // usuario (anti-IDOR 404)
                MvcResult created = mockMvc.perform(post("/api/v1/osint/assets")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "asset_type": "domain",
                                                  "asset_value": "medios-defensa.example",
                                                  "explicit_consent": true
                                                }
                                                """))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.explicit_consent").value(true))
                                .andReturn();
                String assetId = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asText();

                mockMvc.perform(post("/api/v1/osint/assets/" + assetId + "/scan")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                                .andExpect(status().isNotFound());

                mockMvc.perform(post("/api/v1/osint/assets/" + assetId + "/scan")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + clientAToken))
                                .andExpect(status().isNotFound());

                mockMvc.perform(post("/api/v1/osint/assets/" + assetId + "/scan")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.asset_value").value("medios-defensa.example"))
                                .andExpect(jsonPath("$.dns_posture.domain").value("medios-defensa.example"));

                mockMvc.perform(delete("/api/v1/osint/assets/" + assetId)
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.status").value("revoked"));

                assertThat(auditLogService.verifyTenantChain(tenantAId).valid()).isTrue();
        }

        @Test
        void standardAccountRegistrationAndEmailOnlyLoginWorkCleanly() throws Exception {
                MvcResult reg = mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Camila Vega",
                                                  "email": "camila@redaccion.org",
                                                  "password": "OmegaPassword!2026",
                                                  "organizationName": "Redacción Segura"
                                                }
                                                """))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.accessToken").isString())
                                .andExpect(jsonPath("$.email").value("camila@redaccion.org"))
                                .andExpect(jsonPath("$.role").value("ADMIN"))
                                .andReturn();

                String regToken = objectMapper.readTree(reg.getResponse().getContentAsString()).get("accessToken")
                                .asText();

                mockMvc.perform(get("/api/v1/expedientes")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + regToken))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$[0].title").value("Espacio personal"));

                mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Camila Duplicada",
                                                  "email": "camila@redaccion.org",
                                                  "password": "OmegaPassword!2026"
                                                }
                                                """))
                                .andExpect(status().isConflict());

                mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "email": "camila@redaccion.org",
                                                  "password": "OmegaPassword!2026"
                                                }
                                                """))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.accessToken").isString())
                                .andExpect(jsonPath("$.email").value("camila@redaccion.org"));
        }

        @Test
        void invalidRegistrationPayloadsAreRejectedWithFieldErrors() throws Exception {
                mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Juan123!",
                                                  "email": "barrabasadas@localhost",
                                                  "password": "            ",
                                                  "organizationName": "@@@@"
                                                }
                                                """))
                                .andExpect(status().isBadRequest())
                                .andExpect(jsonPath("$.title").value("Error de validación"))
                                .andExpect(jsonPath("$.fieldErrors.fullName").isString())
                                .andExpect(jsonPath("$.fieldErrors.email").isString())
                                .andExpect(jsonPath("$.fieldErrors.password").isString())
                                .andExpect(jsonPath("$.fieldErrors.organizationName").isString());

                mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "akjriuqw2iu3i3123.2.q..qw..wqe.r.34",
                                                  "email": "akjriuqw2iu3i3123.2.q.qw.wqe.r.34@gmail.com",
                                                  "password": "OmegaPassword!2026",
                                                  "organizationName": "akjriuqw2iu3i3123.2.q..qw..wqe.r.34"
                                                }
                                                """))
                                .andExpect(status().isBadRequest())
                                .andExpect(jsonPath("$.fieldErrors.fullName").isString())
                                .andExpect(jsonPath("$.fieldErrors.email").isString())
                                .andExpect(jsonPath("$.fieldErrors.organizationName").isString());

                JsonNode tenant = registerTenant("gibberish-osint");
                String token = tenant.get("accessToken").asText();

                mockMvc.perform(post("/api/v1/osint/assets")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "asset_type": "domain",
                                                  "asset_value": "akjriuqw2iu3i3123.2.q.qw.wqe.r.com",
                                                  "explicit_consent": true
                                                }
                                                """))
                                .andExpect(status().isBadRequest());

                mockMvc.perform(post("/api/v1/osint/assets")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "asset_type": "organization",
                                                  "asset_value": "akjriuqw2iu3i3123.2.q..qw..wqe.r.34",
                                                  "explicit_consent": true
                                                }
                                                """))
                                .andExpect(status().isBadRequest());
        }

        @Test
        void loginEndpointRateLimitsAfterFiveFailedAttemptsAndReturns429WithRetryAfter() throws Exception {
                mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Lucia Navarro",
                                                  "email": "lucia.bruteforce@redaccion.org",
                                                  "password": "OmegaPassword!2026",
                                                  "organizationName": "Redaccion Limite"
                                                }
                                                """))
                                .andExpect(status().isCreated());

                var attackerIp = (org.springframework.test.web.servlet.request.RequestPostProcessor) request -> {
                        request.setRemoteAddr("198.51.100.77");
                        return request;
                };

                for (int attempt = 1; attempt <= 5; attempt++) {
                        mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                                        .with(attackerIp)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("""
                                                        {
                                                          "email": "lucia.bruteforce@redaccion.org",
                                                          "password": "WrongPassword123!"
                                                        }
                                                        """))
                                        .andExpect(status().isUnauthorized());
                }

                // Sexto intento (incluso con contraseña correcta) debe quedar bloqueado con
                // HTTP 429 + Retry-After
                mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                                .with(attackerIp)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "email": "lucia.bruteforce@redaccion.org",
                                                  "password": "OmegaPassword!2026"
                                                }
                                                """))
                                .andExpect(status().isTooManyRequests())
                                .andExpect(header().exists(HttpHeaders.RETRY_AFTER))
                                .andExpect(jsonPath("$.title").value("Demasiados intentos de autenticación"))
                                .andExpect(jsonPath("$.retryAfterSeconds").isNumber());

                // Otra IP legítima no queda bloqueada por el ataque desde 198.51.100.77
                mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                                .with(request -> {
                                        request.setRemoteAddr("198.51.100.88");
                                        return request;
                                })
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "email": "lucia.bruteforce@redaccion.org",
                                                  "password": "OmegaPassword!2026"
                                                }
                                                """))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.accessToken").isString());
        }

        @Test
        void httpOnlyCookieAuthenticatesWithoutLocalStorageAndLogoutClearsCookieAndGovernanceExposesFreshness()
                        throws Exception {
                MvcResult loginReg = mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Mateo Cookie",
                                                  "email": "mateo.cookie@redaccion.org",
                                                  "password": "OmegaPassword!2026",
                                                  "organizationName": "Cookie Lab"
                                                }
                                                """))
                                .andExpect(status().isCreated())
                                .andExpect(header().string(HttpHeaders.SET_COOKIE,
                                                org.hamcrest.Matchers.allOf(
                                                                org.hamcrest.Matchers.containsString("omega_session="),
                                                                org.hamcrest.Matchers.containsString("HttpOnly"),
                                                                org.hamcrest.Matchers.containsString("SameSite=Strict"))))
                                .andReturn();

                String token = objectMapper.readTree(loginReg.getResponse().getContentAsString())
                                .get("accessToken").asText();

                mockMvc.perform(get("/api/v1/auth/me")
                                .cookie(new jakarta.servlet.http.Cookie("omega_session", token)))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.email").value("mateo.cookie@redaccion.org"))
                                .andExpect(jsonPath("$.tenantSlug").isString());

                mockMvc.perform(get("/api/v1/system/governance")
                                .cookie(new jakarta.servlet.http.Cookie("omega_session", token)))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.catalog_freshness.catalog_cutoff_date").isString())
                                .andExpect(jsonPath("$.os_scope_notice").value(
                                                org.hamcrest.Matchers.containsString("kernel")));

                mockMvc.perform(post("/api/v1/auth/logout").with(csrf())
                                .cookie(new jakarta.servlet.http.Cookie("omega_session", token)))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.loggedOut").value(true))
                                .andExpect(header().string(HttpHeaders.SET_COOKIE,
                                                org.hamcrest.Matchers.containsString("Max-Age=0")));
        }

        @Test
        void personalRegistrationGetsAnalystWithProfileAndOrgRegistrationRequiresAdminConfirmation() throws Exception {
                mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Diego Rojas",
                                                  "email": "diego.personal.dev@redaccion.org",
                                                  "password": "OmegaPassword!2026",
                                                  "profile": "DEVELOPER"
                                                }
                                                """))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.role").value("ANALYST"))
                                .andExpect(jsonPath("$.profile").value("DEVELOPER"));

                mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Elena Vargas",
                                                  "email": "elena.unconfirmed@redaccion.org",
                                                  "password": "OmegaPassword!2026",
                                                  "organizationName": "Lab Seguridad",
                                                  "organizationAdminConfirmed": false,
                                                  "profile": "DEVELOPER"
                                                }
                                                """))
                                .andExpect(status().isBadRequest());

                MvcResult orgAdmin = mockMvc.perform(post("/api/v1/auth/register").with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                                {
                                                  "fullName": "Elena Vargas",
                                                  "email": "elena.admin.dev@redaccion.org",
                                                  "password": "OmegaPassword!2026",
                                                  "organizationName": "Lab Seguridad",
                                                  "organizationAdminConfirmed": true,
                                                  "profile": "DEVELOPER"
                                                }
                                                """))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.role").value("ADMIN"))
                                .andExpect(jsonPath("$.profile").value("DEVELOPER"))
                                .andReturn();

                String token = objectMapper.readTree(orgAdmin.getResponse().getContentAsString())
                                .get("accessToken").asText();
                mockMvc.perform(get("/api/v1/auth/me")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.role").value("ADMIN"))
                                .andExpect(jsonPath("$.profile").value("DEVELOPER"));
        }
}
