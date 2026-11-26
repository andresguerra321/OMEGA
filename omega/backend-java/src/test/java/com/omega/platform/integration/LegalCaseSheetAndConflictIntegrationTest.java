package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.service.AuditLogService;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ClassPathResource;
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
@Import(PaidWorkspaceFixture.class)
class LegalCaseSheetAndConflictIntegrationTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static Path sharedTempDir;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (sharedTempDir == null) {
            sharedTempDir = Files.createTempDirectory("omega-legal-ficha-test-");
        }
        registry.add("omega.ingest.temp-dir", () -> sharedTempDir.toAbsolutePath().toString());
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
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private AuditLogService auditLogService;

    @Test
    void persistsAndValidatesCaseSheetFieldsWhilePreservingLegacyNullCases() throws Exception {
        String slug = "legal-sheet-" + UUID.randomUUID().toString().substring(0, 8);
        String adminToken = registerLegalTenant(slug, "admin@" + slug + ".invalid");

        // 1. Compatibilidad hacia atrás: caso existente sin los 5 campos nuevos
        MvcResult legacyRes = mockMvc.perform(post("/api/v1/expedientes/full").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Caso Histórico Sin Ficha",
                                "classification", "CONFIDENTIAL",
                                "description", "Creado con payload anterior",
                                "reference", "RAD-HIST-001",
                                "status", "OPEN"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode legacyJson = objectMapper.readTree(legacyRes.getResponse().getContentAsString());
        UUID legacyId = UUID.fromString(legacyJson.path("id").asText());
        assertThat(legacyJson.path("reference").asText()).isEqualTo("RAD-HIST-001");
        assertThat(legacyJson.path("clientName").isNull()).isTrue();
        assertThat(legacyJson.path("counterpartyName").isNull()).isTrue();
        assertThat(legacyJson.path("courtName").isNull()).isTrue();
        assertThat(legacyJson.path("processType").isNull()).isTrue();
        assertThat(legacyJson.path("caseStage").isNull()).isTrue();

        mockMvc.perform(get("/api/v1/expedientes/" + legacyId + "/metadata")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/expedientes/" + legacyId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/expedientes/page")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk());

        // 2. Creación y actualización con ficha completa + trim de espacios
        MvcResult fullCreate = mockMvc.perform(post("/api/v1/expedientes/full").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "  Demanda Ejecutiva Andina  ",
                                "classification", "CONFIDENTIAL",
                                "description", "  Cobro de pagarés  ",
                                "reference", "  11001-31-03-004-2026-00123-00  ",
                                "status", "OPEN",
                                "clientName", "  Inversiones Córdoba S.A.S.  ",
                                "counterpartyName", "  Comercializadora Pérez Ltda.  ",
                                "courtName", "  Juzgado 04 Civil del Circuito de Bogotá  ",
                                "processType", "  civil  ",
                                "caseStage", "  Admisión de demanda  "
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode created = objectMapper.readTree(fullCreate.getResponse().getContentAsString());
        UUID caseId = UUID.fromString(created.path("id").asText());
        assertThat(created.path("title").asText()).isEqualTo("Demanda Ejecutiva Andina");
        assertThat(created.path("reference").asText()).isEqualTo("11001-31-03-004-2026-00123-00");
        assertThat(created.path("clientName").asText()).isEqualTo("Inversiones Córdoba S.A.S.");
        assertThat(created.path("counterpartyName").asText()).isEqualTo("Comercializadora Pérez Ltda.");
        assertThat(created.path("courtName").asText()).isEqualTo("Juzgado 04 Civil del Circuito de Bogotá");
        assertThat(created.path("processType").asText()).isEqualTo("CIVIL");
        assertThat(created.path("caseStage").asText()).isEqualTo("Admisión de demanda");

        // PUT /{id}/metadata actualiza campos y convierte cadenas en blanco opcionales a NULL
        MvcResult updatedRes = mockMvc.perform(put("/api/v1/expedientes/" + caseId + "/metadata").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Demanda Ejecutiva Andina",
                                "classification", "RESTRICTED",
                                "description", "Audiencia inicial programada",
                                "reference", "11001-31-03-004-2026-00123-00",
                                "status", "OPEN",
                                "clientName", "Inversiones Córdoba S.A.S.",
                                "counterpartyName", "Comercializadora Pérez Ltda.",
                                "courtName", "   ",
                                "processType", "COMERCIAL",
                                "caseStage", "Audiencia inicial"
                        ))))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode updated = objectMapper.readTree(updatedRes.getResponse().getContentAsString());
        assertThat(updated.path("courtName").isNull()).isTrue();
        assertThat(updated.path("processType").asText()).isEqualTo("COMERCIAL");
        assertThat(updated.path("caseStage").asText()).isEqualTo("Audiencia inicial");

        MvcResult metaGet = mockMvc.perform(get("/api/v1/expedientes/" + caseId + "/metadata")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode metaJson = objectMapper.readTree(metaGet.getResponse().getContentAsString());
        assertThat(metaJson.path("clientName").asText()).isEqualTo("Inversiones Córdoba S.A.S.");
        assertThat(metaJson.path("processType").asText()).isEqualTo("COMERCIAL");

        // 3. Validaciones de longitud y CHECK de process_type
        mockMvc.perform(put("/api/v1/expedientes/" + caseId + "/metadata").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Demanda Ejecutiva Andina",
                                "classification", "CONFIDENTIAL",
                                "description", "",
                                "reference", "",
                                "status", "OPEN",
                                "processType", "TRIBUTARIO"
                        ))))
                .andExpect(status().isBadRequest());

        mockMvc.perform(put("/api/v1/expedientes/" + caseId + "/metadata").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Demanda Ejecutiva Andina",
                                "classification", "CONFIDENTIAL",
                                "description", "",
                                "reference", "",
                                "status", "OPEN",
                                "clientName", "X".repeat(201)
                        ))))
                .andExpect(status().isBadRequest());

        mockMvc.perform(put("/api/v1/expedientes/" + caseId + "/metadata").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Demanda Ejecutiva Andina",
                                "classification", "CONFIDENTIAL",
                                "description", "",
                                "reference", "",
                                "status", "OPEN",
                                "caseStage", "S".repeat(61)
                        ))))
                .andExpect(status().isBadRequest());

        assertThatThrownBy(() -> jdbcTemplate.update(
                "UPDATE omega_rag.expedientes SET process_type = 'INVALIDO' WHERE id = ?", caseId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void enforcesTenantIsolationPermissionMaskingSpecialCharSafetyAndNameFreeAuditOnConflicts() throws Exception {
        String slugA = "legal-conf-a-" + UUID.randomUUID().toString().substring(0, 8);
        String slugB = "legal-conf-b-" + UUID.randomUUID().toString().substring(0, 8);
        String adminA = registerLegalTenant(slugA, "admin@" + slugA + ".invalid");
        String adminB = registerLegalTenant(slugB, "admin@" + slugB + ".invalid");

        UUID tenantAId = jdbcTemplate.queryForObject(
                "SELECT id FROM omega_rag.tenants WHERE slug = ?", UUID.class, slugA);

        UUID partialAnalystId = createUser(adminA, "parcial@" + slugA + ".invalid", "ANALYST");
        createUser(adminA, "sinpermiso@" + slugA + ".invalid", "ANALYST");
        String partialToken = login(slugA, "parcial@" + slugA + ".invalid");
        String zeroPermToken = login(slugA, "sinpermiso@" + slugA + ".invalid");

        // Casos en Tenant A:
        // 1) Caso propio de partialAnalyst (ambos roles coinciden con "Ávila")
        UUID ownCaseId = createCaseWithParties(partialToken,
                "Reorganización Grupo Ávila", "RAD-OWN-01",
                "Grupo Ávila Holding", "Inmobiliaria Ávila Sur", "COMERCIAL");
        // 2) Caso de adminA donde partialAnalyst recibe permiso READ (coincide como CLIENT)
        UUID sharedCaseId = createCaseWithParties(adminA,
                "Ordinario Laboral Ávila", "RAD-SHR-02",
                "Constructora Ávila S.A.S.", "Sindicato Nacional", "LABORAL");
        mockMvc.perform(post("/api/v1/expedientes/" + sharedCaseId + "/permissions").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"" + partialAnalystId + "\",\"permission\":\"READ\"}"))
                .andExpect(status().isOk());
        // 3) Dos casos restringidos en Tenant A sin permiso para partialAnalyst ni zeroPermToken
        UUID restricted1 = createCaseWithParties(adminA,
                "Investigación Penal Secreta 901", "RAD-SEC-901",
                "Ministerio Público", "Constructora Avila Ltda.", "PENAL");
        UUID restricted2 = createCaseWithParties(adminA,
                "Sucesión Reservada 902", "RAD-SEC-902",
                "MARÍA ÁVILA GÓMEZ", "Herederos Indeterminados", "FAMILIA");

        // 4) Caso con caracteres especiales en Tenant A (accesible a adminA)
        createCaseWithParties(adminA,
                "Póliza Especial 100%", "RAD-SPEC-77",
                "Fondo 100% Seguro O'Connor_1", "Aseguradora Ruta\\Norte", "CIVIL");

        // 5) Caso en OTRO tenant (Tenant B) con el mismo nombre exacto y otro exclusivo de Tenant B
        UUID otherTenantSameName = createCaseWithParties(adminB,
                "Secreto Externo Tenant B", "RAD-EXT-B1",
                "Constructora Ávila S.A.S.", "Entidad Externa Córdoba", "ADMINISTRATIVO");

        // --- A. Longitud mínima 4 ---
        mockMvc.perform(get("/api/v1/legal/conflicts").param("name", "avi")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + partialToken))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/legal/conflicts").param("name", "  ab  ")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + partialToken))
                .andExpect(status().isBadRequest());

        // --- B. Aislamiento cross-tenant: término exclusivo de Tenant B jamás aparece ni suma en Tenant A ---
        MvcResult crossCheck = mockMvc.perform(get("/api/v1/legal/conflicts").param("name", "Cordoba")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminA))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode crossBody = objectMapper.readTree(crossCheck.getResponse().getContentAsString());
        assertThat(crossBody.path("totalMatches").asInt()).isZero();
        assertThat(crossBody.path("restrictedMatches").asInt()).isZero();
        assertThat(crossBody.path("matches")).isEmpty();

        // --- C. Coincidencia sin mayúsculas ni tildes + enmascaramiento parcial (partialAnalyst) ---
        MvcResult partialRes = mockMvc.perform(get("/api/v1/legal/conflicts").param("name", "avila")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + partialToken))
                .andExpect(status().isOk())
                .andReturn();
        String partialRaw = partialRes.getResponse().getContentAsString();
        JsonNode partialBody = objectMapper.readTree(partialRaw);
        assertThat(partialBody.path("totalMatches").asInt()).isEqualTo(4);
        assertThat(partialBody.path("restrictedMatches").asInt()).isEqualTo(2);
        assertThat(partialBody.path("matches")).hasSize(2);

        List<String> returnedCodes = new ArrayList<>();
        for (JsonNode m : partialBody.path("matches")) {
            String code = m.path("code").asText();
            returnedCodes.add(code);
            List<String> roles = new ArrayList<>();
            m.path("roles").forEach(r -> roles.add(r.asText()));
            if ("RAD-OWN-01".equals(code)) {
                assertThat(m.path("title").asText()).isEqualTo("Reorganización Grupo Ávila");
                assertThat(roles).containsExactly("CLIENT", "COUNTERPARTY");
            } else if ("RAD-SHR-02".equals(code)) {
                assertThat(m.path("title").asText()).isEqualTo("Ordinario Laboral Ávila");
                assertThat(roles).containsExactly("CLIENT");
            }
        }
        assertThat(returnedCodes).containsExactlyInAnyOrder("RAD-OWN-01", "RAD-SHR-02");
        assertThat(partialRaw)
                .doesNotContain("RAD-SEC-901")
                .doesNotContain("RAD-SEC-902")
                .doesNotContain("Investigación Penal Secreta 901")
                .doesNotContain("Sucesión Reservada 902")
                .doesNotContain(restricted1.toString())
                .doesNotContain(restricted2.toString())
                .doesNotContain("RAD-EXT-B1")
                .doesNotContain("Secreto Externo Tenant B")
                .doesNotContain(otherTenantSameName.toString());

        // excludeCaseId omite el expediente propio que se está editando
        MvcResult excludedRes = mockMvc.perform(get("/api/v1/legal/conflicts")
                        .param("name", "ÁVILA")
                        .param("excludeCaseId", ownCaseId.toString())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + partialToken))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode excludedBody = objectMapper.readTree(excludedRes.getResponse().getContentAsString());
        assertThat(excludedBody.path("totalMatches").asInt()).isEqualTo(3);
        assertThat(excludedBody.path("restrictedMatches").asInt()).isEqualTo(2);
        assertThat(excludedBody.path("matches")).hasSize(1);
        assertThat(excludedBody.path("matches").get(0).path("code").asText()).isEqualTo("RAD-SHR-02");

        // --- D. Enmascaramiento total: usuario sin permiso recibe SOLO el conteo ---
        MvcResult zeroPermRes = mockMvc.perform(get("/api/v1/legal/conflicts").param("name", "avila")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + zeroPermToken))
                .andExpect(status().isOk())
                .andReturn();
        String zeroPermRaw = zeroPermRes.getResponse().getContentAsString();
        JsonNode zeroPermBody = objectMapper.readTree(zeroPermRaw);
        assertThat(zeroPermBody.path("totalMatches").asInt()).isEqualTo(4);
        assertThat(zeroPermBody.path("restrictedMatches").asInt()).isEqualTo(4);
        assertThat(zeroPermBody.path("matches")).isEmpty();
        assertThat(zeroPermRaw)
                .doesNotContain("RAD-OWN-01")
                .doesNotContain("RAD-SHR-02")
                .doesNotContain("RAD-SEC-901")
                .doesNotContain("RAD-SEC-902")
                .doesNotContain("Ávila")
                .doesNotContain("Avila");

        // --- E. Caracteres especiales (% _ ' \) ni rompen ni amplían la búsqueda ---
        for (String wildcardProbe : List.of("%%%%", "____", "%_%_", "%' OR 1=1 --", "Fondo 1000 Seguro", "O'ConnorX1")) {
            MvcResult probeRes = mockMvc.perform(get("/api/v1/legal/conflicts").param("name", wildcardProbe)
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminA))
                    .andExpect(status().isOk())
                    .andReturn();
            JsonNode probeBody = objectMapper.readTree(probeRes.getResponse().getContentAsString());
            assertThat(probeBody.path("totalMatches").asInt())
                    .as("La sonda '%s' no debe ampliar comodines", wildcardProbe)
                    .isZero();
        }

        for (String literalMatch : List.of("100% Seguro", "O'Connor_1", "Ruta\\Norte")) {
            MvcResult litRes = mockMvc.perform(get("/api/v1/legal/conflicts").param("name", literalMatch)
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminA))
                    .andExpect(status().isOk())
                    .andReturn();
            JsonNode litBody = objectMapper.readTree(litRes.getResponse().getContentAsString());
            assertThat(litBody.path("totalMatches").asInt())
                    .as("Coincidencia literal esperada para '%s'", literalMatch)
                    .isEqualTo(1);
            assertThat(litBody.path("matches").get(0).path("code").asText()).isEqualTo("RAD-SPEC-77");
        }

        // --- F. Auditoría LEGAL_CONFLICT_CHECK con conteos y SIN guardar el nombre buscado ---
        List<String> metadataRows = jdbcTemplate.queryForList(
                "SELECT metadata_json FROM omega_rag.audit_logs WHERE tenant_id = ? AND action = 'LEGAL_CONFLICT_CHECK' ORDER BY chain_seq ASC",
                String.class,
                tenantAId
        );
        assertThat(metadataRows).isNotEmpty();
        for (String meta : metadataRows) {
            assertThat(meta)
                    .contains("totalMatches")
                    .contains("accessibleMatches")
                    .contains("restrictedMatches")
                    .doesNotContainIgnoringCase("avila")
                    .doesNotContainIgnoringCase("cordoba")
                    .doesNotContainIgnoringCase("connor")
                    .doesNotContainIgnoringCase("seguro")
                    .doesNotContain("\"name\"");
        }
        assertThat(auditLogService.verifyTenantChain(tenantAId).valid()).isTrue();
    }

    @Test
    void reverseBlockCleanlyRollsBackV34Migration() throws Exception {
        if (pgContainer == null) {
            return;
        }
        String isolatedDb = "omega_v34_rev_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        try (Connection adminConn = pgContainer.createConnection("");
             Statement st = adminConn.createStatement()) {
            st.execute("CREATE DATABASE " + isolatedDb);
        }
        String baseJdbc = pgContainer.getJdbcUrl();
        int slash = baseJdbc.lastIndexOf('/');
        int qm = baseJdbc.indexOf('?', slash);
        String prefix = baseJdbc.substring(0, slash + 1);
        String suffix = qm >= 0 ? baseJdbc.substring(qm) : "";
        String sep = suffix.isEmpty() ? "?" : "&";
        String isolatedUrl = prefix + isolatedDb + suffix + sep + "currentSchema=omega_rag,public";

        var isolatedDs = DataSourceBuilder.create()
                .url(isolatedUrl)
                .username(pgContainer.getUsername())
                .password(pgContainer.getPassword())
                .build();
        Flyway.configure()
                .dataSource(isolatedDs)
                .locations("classpath:db/migration")
                .target("34")
                .load()
                .migrate();

        JdbcTemplate isoJdbc = new JdbcTemplate(isolatedDs);
        assertThat(isoJdbc.queryForObject("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = 'omega_rag' AND table_name = 'expedientes'
                  AND column_name IN ('client_name', 'counterparty_name', 'court_name', 'process_type', 'case_stage')
                """, Integer.class)).isEqualTo(5);

        String migrationSql = new ClassPathResource("db/migration/V34__legal_case_sheet.sql")
                .getContentAsString(StandardCharsets.UTF_8);
        String reverseSql = migrationSql.lines()
                .takeWhile(line -> line.startsWith("--"))
                .filter(line -> !line.trim().equals("-- Reverse:"))
                .map(line -> line.replaceFirst("^--\\s?", ""))
                .collect(Collectors.joining("\n"));
        isoJdbc.execute(reverseSql);

        assertThat(isoJdbc.queryForObject("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = 'omega_rag' AND table_name = 'expedientes'
                  AND column_name IN ('client_name', 'counterparty_name', 'court_name', 'process_type', 'case_stage')
                """, Integer.class)).isZero();
    }

    private String registerLegalTenant(String slug, String email) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"tenantName\":\"Despacho " + slug + "\","
                                + "\"adminEmail\":\"" + email + "\",\"adminPassword\":\"OmegaLegal!2026\","
                                + "\"adminFullName\":\"Admin Legal\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String token = objectMapper.readTree(res.getResponse().getContentAsString()).path("accessToken").asText();
        mockMvc.perform(put("/api/v1/profile").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isOk());
        return token;
    }

    private UUID createUser(String adminToken, String email, String role) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/users").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"OmegaLegal!2026\",\"fullName\":\"Usuario Legal\",\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).path("id").asText());
    }

    private String login(String slug, String email) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"email\":\"" + email + "\",\"password\":\"OmegaLegal!2026\"}"))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).path("accessToken").asText();
    }

    private UUID createCaseWithParties(String token, String title, String reference,
            String clientName, String counterpartyName, String processType) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/expedientes/full").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", title,
                                "classification", "CONFIDENTIAL",
                                "description", "Caso sintético de prueba",
                                "reference", reference,
                                "status", "OPEN",
                                "clientName", clientName,
                                "counterpartyName", counterpartyName,
                                "courtName", "Juzgado Sintético",
                                "processType", processType,
                                "caseStage", "Trámite inicial"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).path("id").asText());
    }
}
