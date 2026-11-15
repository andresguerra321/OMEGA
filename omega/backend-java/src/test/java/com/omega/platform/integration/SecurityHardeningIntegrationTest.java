package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.RestClientConfig;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.service.AuditLogService;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
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
class SecurityHardeningIntegrationTest {

    private static final String EXPECTED_INTERNAL_TOKEN = "omega-test-internal-service-token";
    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static HttpServer strictTokenWorker;
    private static final AtomicBoolean WORKER_REJECT_VALID_TOKEN = new AtomicBoolean(false);
    private static final AtomicReference<String> LAST_RECEIVED_INTERNAL_TOKEN = new AtomicReference<>();

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (strictTokenWorker == null) {
            strictTokenWorker = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            strictTokenWorker.createContext("/api/yara", exchange -> {
                String provided = exchange.getRequestHeaders().getFirst(RestClientConfig.INTERNAL_TOKEN_HEADER);
                LAST_RECEIVED_INTERNAL_TOKEN.set(provided);
                if (WORKER_REJECT_VALID_TOKEN.get() || !EXPECTED_INTERNAL_TOKEN.equals(provided)) {
                    byte[] denied = "{\"detail\":\"Acceso denegado: X-Internal-Service-Token ausente o inválido.\"}"
                            .getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    exchange.sendResponseHeaders(401, denied.length);
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(denied);
                    }
                    return;
                }
                byte[] ok = """
                        {
                          "files_scanned": 1,
                          "total_hits": 0,
                          "yara_hits": [],
                          "yara_engine": {"yara_available": true},
                          "ephemeral_notice": "Escaneo YARA en RAM"
                        }
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, ok.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(ok);
                }
            });
            strictTokenWorker.start();
        }
        registry.add("omega.forensic-worker.base-url",
                () -> "http://127.0.0.1:" + strictTokenWorker.getAddress().getPort());

        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            @SuppressWarnings("resource") // Container Testcontainers singleton gestionado por Ryuk al terminar la JVM.
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

    @AfterAll
    static void shutdownWorker() {
        if (strictTokenWorker != null) {
            strictTokenWorker.stop(0);
            strictTokenWorker = null;
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
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuditLogService auditLogService;

    @MockBean
    private EmbeddingProvider embeddingProvider;

    @Test
    void enforcesForensicBridgeRbacAndFailClosedInternalToken() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        MvcResult reg = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantSlug": "sec-%s",
                                  "tenantName": "Sec Lab",
                                  "adminEmail": "admin@%s.org",
                                  "adminPassword": "ClaveSuperSegura2026!",
                                  "adminFullName": "Admin Sec"
                                }
                                """.formatted(suffix, suffix)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode adminJson = objectMapper.readTree(reg.getResponse().getContentAsString());
        String adminToken = adminJson.get("accessToken").asText();
        UUID tenantId = UUID.fromString(adminJson.get("tenantId").asText());

        mockMvc.perform(post("/api/v1/auth/users")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "client@%s.org",
                                  "password": "ClienteClave2026!",
                                  "fullName": "Cliente Sec",
                                  "role": "CLIENT"
                                }
                                """.formatted(suffix)))
                .andExpect(status().isCreated());

        MvcResult clientLogin = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantSlug": "sec-%s",
                                  "email": "client@%s.org",
                                  "password": "ClienteClave2026!"
                                }
                                """.formatted(suffix, suffix)))
                .andExpect(status().isOk())
                .andReturn();
        String clientToken = objectMapper.readTree(clientLogin.getResponse().getContentAsString())
                .get("accessToken").asText();

        // 1. Endpoint sin JWT responde 401
        mockMvc.perform(multipart("/api/v1/forensics/yara/scan")
                        .file(new MockMultipartFile("files", "sample.bin", "application/octet-stream", "test".getBytes())))
                .andExpect(status().isUnauthorized());

        // 2. Rol CLIENT no puede ejecutar escaneo YARA ni triage forense (403)
        mockMvc.perform(multipart("/api/v1/forensics/yara/scan")
                        .file(new MockMultipartFile("files", "sample.bin", "application/octet-stream", "test".getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + clientToken))
                .andExpect(status().isForbidden());

        mockMvc.perform(multipart("/api/v1/forensics/triage")
                        .file(new MockMultipartFile("files", "sample.json", "application/json", "{}".getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + clientToken))
                .andExpect(status().isForbidden());

        // 3. Llamada autorizada transmite el X-Internal-Service-Token exacto y registra auditoría
        WORKER_REJECT_VALID_TOKEN.set(false);
        mockMvc.perform(multipart("/api/v1/forensics/yara/scan")
                        .file(new MockMultipartFile("files", "clean.txt", "text/plain", "benign".getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.files_scanned").value(1));
        assertThat(LAST_RECEIVED_INTERNAL_TOKEN.get()).isEqualTo(EXPECTED_INTERNAL_TOKEN);

        // 4. Fail-closed: si el worker interno rechaza (401) un token desincronizado, Java devuelve 502 controlado
        WORKER_REJECT_VALID_TOKEN.set(true);
        try {
            mockMvc.perform(multipart("/api/v1/forensics/yara/scan")
                            .file(new MockMultipartFile("files", "clean.txt", "text/plain", "benign".getBytes()))
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                    .andExpect(status().isBadGateway())
                    .andExpect(jsonPath("$.title").value("Error del microservicio forense interno"));
        } finally {
            WORKER_REJECT_VALID_TOKEN.set(false);
        }

        assertThat(auditLogService.listRecent(tenantId, 5))
                .anySatisfy(e -> assertThat(e.getAction()).isEqualTo("FORENSIC_YARA_SCANNED"));
    }

    @Test
    void enforcesDatabaseCheckConstraintForExplicitOsintConsent() throws Exception {
        Path initSqlPath = resolveInitSqlPath();
        String initSql = Files.readString(initSqlPath, StandardCharsets.UTF_8);

        Matcher m = Pattern.compile(
                "CREATE TABLE\\s+osint_monitored_assets\\s*\\((.*?)\\);",
                Pattern.DOTALL | Pattern.CASE_INSENSITIVE
        ).matcher(initSql);
        assertThat(m.find())
                .as("db/init.sql debe definir la tabla osint_monitored_assets con restricción de consentimiento")
                .isTrue();

        String tableDdl = "CREATE TABLE IF NOT EXISTS public.osint_monitored_assets (" + m.group(1) + ");";
        assertThat(tableDdl).containsIgnoringCase("CHECK (explicit_consent = TRUE)");

        jdbcTemplate.execute(tableDdl);
        jdbcTemplate.execute("TRUNCATE TABLE public.osint_monitored_assets;");

        // 1. explicit_consent = FALSE debe violar restricción CHECK (SQLState 23514)
        assertThatThrownBy(() -> jdbcTemplate.update(
                """
                INSERT INTO public.osint_monitored_assets (owner_token, asset_type, asset_value, explicit_consent)
                VALUES (?, ?, ?, ?)
                """,
                "tenant-sec-test", "domain", "target-no-consent.org", false
        ))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(ex -> assertThat(extractSqlState(ex)).isEqualTo("23514"));

        // 2. explicit_consent = NULL debe violar restricción NOT NULL (SQLState 23502)
        assertThatThrownBy(() -> jdbcTemplate.update(
                """
                INSERT INTO public.osint_monitored_assets (owner_token, asset_type, asset_value, explicit_consent)
                VALUES (?, ?, ?, ?)
                """,
                "tenant-sec-test", "domain", "target-null-consent.org", null
        ))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(ex -> assertThat(extractSqlState(ex)).isEqualTo("23502"));

        // 3. explicit_consent = TRUE debe persistir correctamente
        int inserted = jdbcTemplate.update(
                """
                INSERT INTO public.osint_monitored_assets (owner_token, asset_type, asset_value, explicit_consent)
                VALUES (?, ?, ?, ?)
                """,
                "tenant-sec-test", "domain", "owned-newsroom.org", true
        );
        assertThat(inserted).isEqualTo(1);
    }

    private static Path resolveInitSqlPath() {
        for (Path candidate : new Path[] {
                Path.of("../db/init.sql"),
                Path.of("omega/db/init.sql"),
                Path.of("/omega/db/init.sql")
        }) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("No se encontró omega/db/init.sql desde el directorio de pruebas.");
    }

    private static String extractSqlState(Throwable err) {
        Throwable cursor = err;
        while (cursor != null) {
            if (cursor instanceof SQLException sqlEx && sqlEx.getSQLState() != null) {
                return sqlEx.getSQLState();
            }
            cursor = cursor.getCause();
        }
        return "";
    }
}
