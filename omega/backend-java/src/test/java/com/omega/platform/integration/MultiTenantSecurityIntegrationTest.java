package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DocumentChunkEntity;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.repository.DocumentChunkRepository;
import com.omega.platform.repository.DocumentRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
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
class MultiTenantSecurityIntegrationTest {

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

    private static String envOrDefault(String key, String fallback) {
        String val = System.getenv(key);
        return (val == null || val.isBlank()) ? fallback : val;
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private DocumentChunkRepository documentChunkRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void enforcesStrictTenantIsolationRbacAndPgvectorTsvectorSchema() throws Exception {
        // 1. Unauthenticated access must return 401 ProblemDetail JSON
        mockMvc.perform(get("/api/v1/expedientes"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.title").value("Autenticación requerida"));

        // 2. Register Tenant A & Tenant B with distinct ADMIN users
        JsonNode tenantA = registerTenant("red-prensa-alpha", "Red Prensa Alpha", "admin@alpha.org", "ClaveSeguraAlpha123!", "Admin Alpha");
        JsonNode tenantB = registerTenant("ngo-bravo", "ONG Bravo", "admin@bravo.org", "ClaveSeguraBravo123!", "Admin Bravo");

        String tokenAdminA = tenantA.get("accessToken").asText();
        UUID tenantAId = UUID.fromString(tenantA.get("tenantId").asText());
        UUID adminAId = UUID.fromString(tenantA.get("userId").asText());
        String tokenAdminB = tenantB.get("accessToken").asText();

        // 3. Provision ANALYST & CLIENT inside Tenant A
        String analystAId = createUser(tokenAdminA, "analyst@alpha.org", "AnalystClave123!", "Analista Alpha", "ANALYST");
        String clientAId = createUser(tokenAdminA, "client@alpha.org", "ClientClave123!", "Periodista Alpha", "CLIENT");

        String tokenAnalystA = login("red-prensa-alpha", "analyst@alpha.org", "AnalystClave123!");
        String tokenClientA = login("red-prensa-alpha", "client@alpha.org", "ClientClave123!");

        // 4. CLIENT cannot create tenant users (403) or expedientes (403)
        mockMvc.perform(post("/api/v1/auth/users")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenClientA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "rogue@alpha.org",
                                  "password": "ClaveLargaValida123!",
                                  "fullName": "Rogue User",
                                  "role": "ADMIN"
                                }
                                """))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/expedientes")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenClientA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Caso no autorizado","classification":"CONFIDENTIAL"}
                                """))
                .andExpect(status().isForbidden());

        // 5. ANALYST A creates an expediente inside Tenant A
        MvcResult expResult = mockMvc.perform(post("/api/v1/expedientes")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenAnalystA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Peritaje Pegasus iOS 16","classification":"RESTRICTED"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tenantId").value(tenantAId.toString()))
                .andReturn();

        UUID expedienteAId = UUID.fromString(
                objectMapper.readTree(expResult.getResponse().getContentAsString()).get("id").asText()
        );

        // 6. Cross-tenant isolation: Admin of Tenant B CANNOT see or access Tenant A's expediente (404, no leak)
        mockMvc.perform(get("/api/v1/expedientes")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenAdminB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        mockMvc.perform(get("/api/v1/expedientes/{id}", expedienteAId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenAdminB)
                        .header("X-Tenant-Id", tenantAId.toString()))
                .andExpect(status().isNotFound());

        // 7. Client in SAME Tenant A without ACL grant gets 403; once granted READ, gets 200
        mockMvc.perform(get("/api/v1/expedientes/{id}", expedienteAId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenClientA))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/expedientes/{id}/permissions", expedienteAId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenAnalystA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":"%s","permission":"READ"}
                                """.formatted(clientAId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.permission").value("READ"));

        mockMvc.perform(get("/api/v1/expedientes/{id}", expedienteAId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenClientA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Peritaje Pegasus iOS 16"));

        // 8. Verify PostgreSQL pgvector(1536) HNSW + GENERATED ALWAYS tsvector + composite FK cross-tenant guard
        DocumentEntity doc = documentRepository.save(new DocumentEntity(
                tenantAId,
                expedienteAId,
                UUID.fromString(analystAId),
                "peritaje_forense.pdf",
                "a".repeat(64),
                12,
                "text-embedding-3-small",
                true,
                DocumentStatus.INDEXED
        ));

        float[] vector = new float[1536];
        vector[0] = 0.85f;
        vector[1] = 0.15f;

        DocumentChunkEntity savedChunk = documentChunkRepository.save(new DocumentChunkEntity(
                tenantAId,
                doc.getId(),
                expedienteAId,
                "Evidencia BLASTPASS CVE-2023-41064 detectada en imagen PassKit del dispositivo.",
                vector,
                4,
                "Análisis Forense iOS",
                0,
                512,
                "text-embedding-3-small"
        ));

        // PostgreSQL automatically materialized search_vector via GENERATED ALWAYS AS STORED
        Boolean ftsMatched = jdbcTemplate.queryForObject(
                """
                SELECT search_vector @@ plainto_tsquery('pg_catalog.simple', 'BLASTPASS')
                FROM omega_rag.document_chunks
                WHERE id = ?
                """,
                Boolean.class,
                savedChunk.getId()
        );
        assertThat(ftsMatched).isTrue();

        // PostgreSQL composite FK strictly forbids linking a chunk of Tenant B to an expediente of Tenant A
        UUID tenantBId = UUID.fromString(tenantB.get("tenantId").asText());
        assertThatThrownBy(() -> documentChunkRepository.saveAndFlush(new DocumentChunkEntity(
                tenantBId,
                doc.getId(),
                expedienteAId,
                "Cross-tenant injection attempt",
                vector,
                1,
                "Tampered",
                1,
                500,
                "text-embedding-3-small"
        ))).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(adminAId).isNotNull();
    }

    private JsonNode registerTenant(
            String slug,
            String name,
            String email,
            String password,
            String fullName
    ) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantSlug": "%s",
                                  "tenantName": "%s",
                                  "adminEmail": "%s",
                                  "adminPassword": "%s",
                                  "adminFullName": "%s"
                                }
                                """.formatted(slug, name, email, password, fullName)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString());
    }

    private String createUser(
            String adminToken,
            String email,
            String password,
            String fullName,
            String role
    ) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/users")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "%s",
                                  "password": "%s",
                                  "fullName": "%s",
                                  "role": "%s"
                                }
                                """.formatted(email, password, fullName, role)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText();
    }

    private String login(String tenantSlug, String email, String password) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantSlug": "%s",
                                  "email": "%s",
                                  "password": "%s"
                                }
                                """.formatted(tenantSlug, email, password)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("accessToken").asText();
    }
}
