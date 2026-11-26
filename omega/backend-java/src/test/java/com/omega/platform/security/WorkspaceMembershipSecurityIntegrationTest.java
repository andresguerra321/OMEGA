package com.omega.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.billing.AccountSeatService;
import com.omega.platform.billing.CreditOperation;
import com.omega.platform.billing.CreditService;
import com.omega.platform.service.ApiTokenService;
import com.omega.platform.service.PilotOpsService;
import com.omega.platform.service.TwoFactorService;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(properties = "OMEGA_BILLING_ENFORCE=true")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class WorkspaceMembershipSecurityIntegrationTest {

    private static PostgreSQLContainer<?> container;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String external = System.getenv("OMEGA_TEST_DB_URL");
        if (external != null && !external.isBlank()) {
            registry.add("spring.datasource.url", () -> external);
            registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_only"));
        } else {
            container = new PostgreSQLContainer<>(
                    DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres"));
            container.start();
            registry.add("spring.datasource.url", container::getJdbcUrl);
            registry.add("spring.datasource.username", container::getUsername);
            registry.add("spring.datasource.password", container::getPassword);
        }
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate tx;
    @Autowired JwtService jwtService;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired AccountSeatService seats;
    @Autowired CreditService credits;
    @Autowired TwoFactorService twoFactorService;
    @Autowired ApiTokenService apiTokenService;
    @Autowired PilotOpsService pilotOpsService;

    private record TwoSpacesOrg(
            UUID orgId,
            UUID billingTenantId,
            UUID spaceATenantId,
            UUID spaceBTenantId,
            UUID sharedUserId,
            String sharedUserEmail
    ) {}

    private TwoSpacesOrg createPaidOrgWithTwoSpaces(String suffix, String planCode, int maxDevices, int monthlyCredits) {
        TwoSpacesOrg fixture = tx.execute(status -> {
            UUID billingTenantId = UUID.randomUUID();
            UUID spaceATenantId = UUID.randomUUID();
            UUID spaceBTenantId = UUID.randomUUID();
            UUID sharedUserId = UUID.randomUUID();
            UUID orgId = UUID.randomUUID();
            String email = "multi-" + suffix + "@example.invalid";

            jdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type)
                    VALUES (?, ?, ?, TRUE, 'GENERAL', 'ORGANIZATION')
                    """, billingTenantId, "billing-" + suffix, "Pagador " + suffix);

            jdbc.update("""
                    INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                    VALUES (?, ?, ?, ?, 'Usuaria Multi Espacio', 'ADMIN', TRUE)
                    """, sharedUserId, billingTenantId, email, passwordEncoder.encode("OmegaPhase2a1!2026"));

            jdbc.update("UPDATE omega_rag.tenants SET owner_user_id = ? WHERE id = ?", sharedUserId, billingTenantId);

            jdbc.update("""
                    INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer, active)
                    VALUES (?, ?, ?, ?, ?, FALSE, TRUE)
                    """, orgId, "Firma " + suffix, "firma-" + suffix, billingTenantId, sharedUserId);

            jdbc.update("UPDATE omega_rag.tenants SET organization_id = ?, billing_tenant_id = ? WHERE id = ?",
                    orgId, billingTenantId, billingTenantId);

            jdbc.update("""
                    INSERT INTO omega_rag.organization_members (organization_id, user_id, org_role, active, created_by_user_id)
                    VALUES (?, ?, 'ORG_OWNER', TRUE, ?)
                    """, orgId, sharedUserId, sharedUserId);

            jdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id)
                    VALUES (?, ?, 'Espacio Legal A', TRUE, 'LEGAL', 'ORGANIZATION', ?, ?),
                           (?, ?, 'Espacio Legal B', TRUE, 'LEGAL', 'ORGANIZATION', ?, ?)
                    """, spaceATenantId, "legal-a-" + suffix, orgId, billingTenantId,
                    spaceBTenantId, "legal-b-" + suffix, orgId, billingTenantId);

            return new TwoSpacesOrg(orgId, billingTenantId, spaceATenantId, spaceBTenantId, sharedUserId, email);
        });

        credits.subscription(fixture.billingTenantId());
        jdbc.update("""
                UPDATE omega_rag.subscriptions
                   SET plan_code = ?,
                       status = 'ACTIVE',
                       paid_verified = TRUE,
                       billing_interval = 'MONTHLY',
                       source_payment_id = ?,
                       max_devices = ?,
                       monthly_ai_quota = ?,
                       current_period_start = NOW(),
                       current_period_end = NOW() + INTERVAL '1 month',
                       cancel_at_period_end = FALSE,
                       updated_at = NOW()
                 WHERE tenant_id = ?
                """, planCode, "pay-" + fixture.billingTenantId(), maxDevices, monthlyCredits, fixture.billingTenantId());
        return fixture;
    }

    @Test
    void v31IntegrityTriggerRejectsStandaloneAndCrossOrgMembershipsAndAllowsSameOrganization() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());

        // 1. Dos tenants standalone (organization_id IS NULL): membresía cruzada RECHAZADA por trigger V31
        JsonNode standaloneA = mapper.readTree(mvc.perform(post("/api/v1/auth/register").with(csrf())
                        .with(req -> { req.setRemoteAddr("198.18." + ThreadLocalRandom.current().nextInt(256) + ".21"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "fullName", "Standalone Uno",
                                "email", "std1-" + suffix + "@example.invalid",
                                "password", "OmegaStandalone!2026",
                                "profile", "GENERAL"))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());

        JsonNode standaloneB = mapper.readTree(mvc.perform(post("/api/v1/auth/register").with(csrf())
                        .with(req -> { req.setRemoteAddr("198.18." + ThreadLocalRandom.current().nextInt(256) + ".22"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "fullName", "Standalone Dos",
                                "email", "std2-" + suffix + "@example.invalid",
                                "password", "OmegaStandalone!2026",
                                "profile", "GENERAL"))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());

        UUID tenantA = UUID.fromString(standaloneA.path("tenantId").asText());
        UUID userA = UUID.fromString(standaloneA.path("userId").asText());
        UUID tenantB = UUID.fromString(standaloneB.path("tenantId").asText());

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active)
                VALUES (?, ?, 'ANALYST', TRUE)
                """, tenantB, userA))
                .isInstanceOf(UncategorizedSQLException.class)
                .hasMessageContaining("Membresía rechazada");

        // 2. Dos organizaciones distintas: membresía cruzada Org X -> Org Y RECHAZADA; misma organización PERMITIDA
        TwoSpacesOrg orgX = createPaidOrgWithTwoSpaces("orgx-" + suffix, "ENTERPRISE", 25, 3000);
        TwoSpacesOrg orgY = createPaidOrgWithTwoSpaces("orgy-" + suffix, "ENTERPRISE", 25, 3000);

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active)
                VALUES (?, ?, 'ANALYST', TRUE)
                """, orgY.spaceATenantId(), orgX.sharedUserId()))
                .isInstanceOf(UncategorizedSQLException.class)
                .hasMessageContaining("Membresía rechazada");

        seats.assignWorkspaceMembership(orgX.spaceATenantId(), orgX.sharedUserId(), Role.ADMIN, orgX.sharedUserId());
        assertThat(jdbc.queryForObject(
                "SELECT role FROM omega_rag.workspace_memberships WHERE tenant_id = ? AND user_id = ? AND active = TRUE",
                String.class, orgX.spaceATenantId(), orgX.sharedUserId()))
                .isEqualTo("ADMIN");
        assertThat(tenantA).isNotEqualTo(tenantB);
    }

    @Test
    void r1_userWithTwoActiveMembershipsUsingSpaceAJwtCannotReadOrMutateSpaceBResources() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        TwoSpacesOrg org = createPaidOrgWithTwoSpaces("r1-" + suffix, "ENTERPRISE", 25, 3000);

        // El mismo usuario tiene membresía activa ADMIN tanto en Espacio A como en Espacio B
        seats.assignWorkspaceMembership(org.spaceATenantId(), org.sharedUserId(), Role.ADMIN, org.sharedUserId());
        seats.assignWorkspaceMembership(org.spaceBTenantId(), org.sharedUserId(), Role.ADMIN, org.sharedUserId());

        UUID caseInSpaceA = UUID.randomUUID();
        UUID caseInSpaceB = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                VALUES (?, ?, ?, 'Secreto Cliente A', 'CONFIDENTIAL'),
                       (?, ?, ?, 'Secreto Exclusivo Cliente B', 'RESTRICTED')
                """, caseInSpaceA, org.spaceATenantId(), org.sharedUserId(),
                caseInSpaceB, org.spaceBTenantId(), org.sharedUserId());

        String jwtSpaceA = jwtService.issueToken(org.sharedUserId(), org.spaceATenantId(), org.sharedUserEmail(), Role.ADMIN);
        String jwtSpaceB = jwtService.issueToken(org.sharedUserId(), org.spaceBTenantId(), org.sharedUserEmail(), Role.ADMIN);

        // Con JWT del Espacio A ve el expediente de A, pero recibe 404/403 y cero datos al pedir el expediente de B
        mvc.perform(get("/api/v1/expedientes/" + caseInSpaceA).header("Authorization", "Bearer " + jwtSpaceA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Secreto Cliente A"));

        String forbiddenResponse = mvc.perform(get("/api/v1/expedientes/" + caseInSpaceB)
                        .header("Authorization", "Bearer " + jwtSpaceA))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isIn(403, 404))
                .andReturn().getResponse().getContentAsString();
        assertThat(forbiddenResponse).doesNotContain("Secreto Exclusivo Cliente B");

        String listSpaceA = mvc.perform(get("/api/v1/expedientes").header("Authorization", "Bearer " + jwtSpaceA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(listSpaceA).contains("Secreto Cliente A").doesNotContain("Secreto Exclusivo Cliente B");

        // Con JWT del Espacio B ocurre exactamente el inverso
        mvc.perform(get("/api/v1/expedientes/" + caseInSpaceB).header("Authorization", "Bearer " + jwtSpaceB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Secreto Exclusivo Cliente B"));

        mvc.perform(get("/api/v1/expedientes/" + caseInSpaceA).header("Authorization", "Bearer " + jwtSpaceB))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isIn(403, 404));
    }

    @Test
    void r10_roleChangeOrDeactivationInWorkspaceMembershipsTakesEffectImmediatelyWithSameJwtAndEnforcesSeats() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        TwoSpacesOrg org = createPaidOrgWithTwoSpaces("r10-" + suffix, "PRO", 5, 500); // PRO max_users = 1
        seats.assignWorkspaceMembership(org.spaceATenantId(), org.sharedUserId(), Role.ADMIN, org.sharedUserId());

        // Emitimos un único JWT cuyo claim embebido dice ADMIN; nunca se reemite
        String adminIssuedJwt = jwtService.issueToken(
                org.sharedUserId(), org.spaceATenantId(), org.sharedUserEmail(), Role.ADMIN);

        mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + adminIssuedJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.canManageAccount").value(true));

        mvc.perform(get("/api/v1/audit-logs").header("Authorization", "Bearer " + adminIssuedJwt))
                .andExpect(status().isOk());

        // 1. Degradar rol en BD a CLIENT (dejando users.role = 'ADMIN' intacto para probar que NO se lee users.role)
        seats.updateWorkspaceMembershipState(org.spaceATenantId(), org.sharedUserId(), Role.CLIENT, true, org.sharedUserId());

        mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + adminIssuedJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("CLIENT"))
                .andExpect(jsonPath("$.canManageAccount").value(false));

        mvc.perform(get("/api/v1/audit-logs").header("Authorization", "Bearer " + adminIssuedJwt))
                .andExpect(status().isForbidden());

        // 2. Poner workspace_memberships.active = FALSE en BD (con users.active = TRUE): revocación inmediata (401)
        seats.updateWorkspaceMembershipState(org.spaceATenantId(), org.sharedUserId(), Role.CLIENT, false, org.sharedUserId());

        mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + adminIssuedJwt))
                .andExpect(status().isUnauthorized());

        // 3. Todo cambio de rol (CLIENT -> ANALYST) o reactivación respeta requireAvailableSeat
        UUID secondUserId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                VALUES (?, ?, ?, ?, 'Segunda Persona', 'CLIENT', TRUE)
                """, secondUserId, org.billingTenantId(), "sec-" + suffix + "@example.invalid",
                passwordEncoder.encode("OmegaSecond!2026"));

        // Promover CLIENT -> ANALYST con PRO lleno (1/1 ocupado por sharedUserId en billingTenantId) falla con 402
        assertThatThrownBy(() -> seats.updateWorkspaceMembershipState(
                org.billingTenantId(), secondUserId, Role.ANALYST, true, org.sharedUserId()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode().value())
                .isEqualTo(402);

        // Desactivar como CLIENT y tratar de reactivar como ANALYST también falla con 402
        seats.updateWorkspaceMembershipState(org.billingTenantId(), secondUserId, Role.CLIENT, false, org.sharedUserId());
        assertThatThrownBy(() -> seats.updateWorkspaceMembershipState(
                org.billingTenantId(), secondUserId, Role.ANALYST, true, org.sharedUserId()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode().value())
                .isEqualTo(402);
    }

    @Test
    void v31DocumentedReverseSqlRestoresV30UpdateSyncCleanly() throws Exception {
        Path v31Path = Path.of("src/main/resources/db/migration/V31__workspace_membership_integrity_and_insert_only_sync.sql");
        List<String> lines = Files.readAllLines(v31Path, StandardCharsets.UTF_8);
        StringBuilder reverseBuilder = new StringBuilder();
        boolean inReverse = false;
        for (String line : lines) {
            if (line.startsWith("-- Reverse")) {
                inReverse = true;
                continue;
            }
            if (inReverse) {
                if (!line.startsWith("--")) {
                    break;
                }
                reverseBuilder.append(line.length() > 3 ? line.substring(3) : "").append('\n');
            }
        }
        String reverseSql = reverseBuilder.toString().trim();
        assertThat(reverseSql).contains("DROP TRIGGER IF EXISTS trg_workspace_memberships_integrity");

        String dbName = "omega_v31_rev_" + Long.toUnsignedString(System.nanoTime());
        String baseUrl = container != null ? container.getJdbcUrl() : System.getenv("OMEGA_TEST_DB_URL");
        String username = container != null ? container.getUsername() : System.getenv().getOrDefault("OMEGA_TEST_DB_USER", "omega_test");
        String password = container != null ? container.getPassword() : System.getenv().getOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_only");

        try (Connection adminConn = dataSource.getConnection();
             Statement stmt = adminConn.createStatement()) {
            adminConn.setAutoCommit(true);
            stmt.execute("CREATE DATABASE " + dbName);
        }

        int qIdx = baseUrl.indexOf('?');
        String withoutParams = qIdx >= 0 ? baseUrl.substring(0, qIdx) : baseUrl;
        String params = qIdx >= 0 ? baseUrl.substring(qIdx) : "";
        String targetUrl = withoutParams.substring(0, withoutParams.lastIndexOf('/') + 1) + dbName + params;

        DriverManagerDataSource isolatedDs = new DriverManagerDataSource(targetUrl, username, password);
        JdbcTemplate isolatedJdbc = new JdbcTemplate(isolatedDs);
        try {
            Flyway.configure().dataSource(isolatedDs).locations("classpath:db/migration").target("31").load().migrate();
            try (Connection conn = isolatedDs.getConnection();
                 Statement stmt = conn.createStatement()) {
                stmt.execute(reverseSql);
            }
            UUID tId = UUID.randomUUID();
            UUID uId = UUID.randomUUID();
            isolatedJdbc.update("INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type) VALUES (?, 'rev31', 'Rev 31', TRUE, 'GENERAL', 'INDIVIDUAL')", tId);
            isolatedJdbc.update("INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active) VALUES (?, ?, 'r@v31.invalid', 'h', 'Rev', 'ANALYST', TRUE)", uId, tId);
            isolatedJdbc.update("UPDATE omega_rag.users SET role = 'ADMIN' WHERE id = ?", uId);
            assertThat(isolatedJdbc.queryForObject(
                    "SELECT role FROM omega_rag.workspace_memberships WHERE tenant_id = ? AND user_id = ?",
                    String.class, tId, uId)).isEqualTo("ADMIN");
        } finally {
            try (Connection adminConn = dataSource.getConnection();
                 Statement stmt = adminConn.createStatement()) {
                adminConn.setAutoCommit(true);
                stmt.execute("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)");
            }
        }
    }

    @Test
    void v32MakesTenantOrganizationIdImmutableOnceAssignedAndSupportsReverseSql() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        TwoSpacesOrg orgX = createPaidOrgWithTwoSpaces("v32x-" + suffix, "ENTERPRISE", 25, 3000);
        TwoSpacesOrg orgY = createPaidOrgWithTwoSpaces("v32y-" + suffix, "ENTERPRISE", 25, 3000);

        // 1. Cambiar organization_id de un espacio ya asignado hacia otra organización falla por trigger V32
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE omega_rag.tenants SET organization_id = ?, billing_tenant_id = ? WHERE id = ?",
                orgY.orgId(), orgY.billingTenantId(), orgX.spaceATenantId()))
                .isInstanceOf(UncategorizedSQLException.class)
                .hasMessageContaining("organization_id de un espacio es inmutable");

        // 2. Poner organization_id en NULL (junto con billing_tenant_id = NULL) también falla por trigger V32
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE omega_rag.tenants SET organization_id = NULL, billing_tenant_id = NULL WHERE id = ?",
                orgX.spaceATenantId()))
                .isInstanceOf(UncategorizedSQLException.class)
                .hasMessageContaining("organization_id de un espacio es inmutable");

        // 3. Reversa documentada de V32 ejecuta limpio
        Path v32Path = Path.of("src/main/resources/db/migration/V32__immutable_tenant_organization_id.sql");
        List<String> lines = Files.readAllLines(v32Path, StandardCharsets.UTF_8);
        StringBuilder reverseBuilder = new StringBuilder();
        boolean inReverse = false;
        for (String line : lines) {
            if (line.startsWith("-- Reverse")) {
                inReverse = true;
                continue;
            }
            if (inReverse) {
                if (!line.startsWith("--")) {
                    break;
                }
                reverseBuilder.append(line.length() > 3 ? line.substring(3) : "").append('\n');
            }
        }
        String reverseSql = reverseBuilder.toString().trim();
        assertThat(reverseSql).contains("CREATE OR REPLACE FUNCTION omega_rag.protect_billing_payer_tenant()");

        String dbName = "omega_v32_rev_" + Long.toUnsignedString(System.nanoTime());
        String baseUrl = container != null ? container.getJdbcUrl() : System.getenv("OMEGA_TEST_DB_URL");
        String username = container != null ? container.getUsername() : System.getenv().getOrDefault("OMEGA_TEST_DB_USER", "omega_test");
        String password = container != null ? container.getPassword() : System.getenv().getOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_only");

        try (Connection adminConn = dataSource.getConnection();
             Statement stmt = adminConn.createStatement()) {
            adminConn.setAutoCommit(true);
            stmt.execute("CREATE DATABASE " + dbName);
        }

        int qIdx = baseUrl.indexOf('?');
        String withoutParams = qIdx >= 0 ? baseUrl.substring(0, qIdx) : baseUrl;
        String params = qIdx >= 0 ? baseUrl.substring(qIdx) : "";
        String targetUrl = withoutParams.substring(0, withoutParams.lastIndexOf('/') + 1) + dbName + params;

        DriverManagerDataSource isolatedDs = new DriverManagerDataSource(targetUrl, username, password);
        JdbcTemplate isolatedJdbc = new JdbcTemplate(isolatedDs);
        try {
            Flyway.configure().dataSource(isolatedDs).locations("classpath:db/migration").target("32").load().migrate();
            try (Connection conn = isolatedDs.getConnection();
                 Statement stmt = conn.createStatement()) {
                stmt.execute(reverseSql);
            }
            UUID rootT = UUID.randomUUID();
            UUID childT = UUID.randomUUID();
            UUID ownerU = UUID.randomUUID();
            UUID orgId = UUID.randomUUID();
            isolatedJdbc.update("INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type) VALUES (?, 'r32-root', 'R32 Root', TRUE, 'GENERAL', 'ORGANIZATION')", rootT);
            isolatedJdbc.update("INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active) VALUES (?, ?, 'o@r32.invalid', 'h', 'Owner', 'ADMIN', TRUE)", ownerU, rootT);
            isolatedJdbc.update("INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id) VALUES (?, 'Org R32', 'org-r32', ?, ?)", orgId, rootT, ownerU);
            isolatedJdbc.update("UPDATE omega_rag.tenants SET organization_id = ?, billing_tenant_id = ? WHERE id = ?", orgId, rootT, rootT);
            isolatedJdbc.update("INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id) VALUES (?, 'r32-child', 'R32 Child', TRUE, 'DEVELOPER', 'ORGANIZATION', ?, ?)", childT, orgId, rootT);
            isolatedJdbc.update("UPDATE omega_rag.tenants SET organization_id = NULL, billing_tenant_id = NULL WHERE id = ?", childT);
            assertThat(isolatedJdbc.queryForObject("SELECT organization_id FROM omega_rag.tenants WHERE id = ?", UUID.class, childT)).isNull();
        } finally {
            try (Connection adminConn = dataSource.getConnection();
                 Statement stmt = adminConn.createStatement()) {
                adminConn.setAutoCommit(true);
                stmt.execute("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)");
            }
        }
    }

    @Test
    void r4_switchWorkspaceAndOrganizationalLegalEnforceMfaAtTrustedDeviceSingleUseTotpAndStandaloneRegression() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        TwoSpacesOrg org = createPaidOrgWithTwoSpaces("r4-" + suffix, "ENTERPRISE", 25, 3000);

        UUID devTenantId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id)
                VALUES (?, ?, 'Espacio Dev R4', TRUE, 'DEVELOPER', 'ORGANIZATION', ?, ?)
                """, devTenantId, "dev-r4-" + suffix, org.orgId(), org.billingTenantId());

        seats.assignWorkspaceMembership(devTenantId, org.sharedUserId(), Role.ADMIN, org.sharedUserId());
        seats.assignWorkspaceMembership(org.spaceATenantId(), org.sharedUserId(), Role.ADMIN, org.sharedUserId());

        // (a) mfa_enabled = false -> switch-workspace y login a LEGAL organizacional fallan con 403 MFA_REQUIRED
        String noMfaJwt = jwtService.issueToken(org.sharedUserId(), org.billingTenantId(), org.sharedUserEmail(), Role.ADMIN);
        String noMfaSwitchBody = mvc.perform(post("/api/v1/auth/switch-workspace")
                        .header("Authorization", "Bearer " + noMfaJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("targetTenantId", devTenantId))))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();
        assertThat(noMfaSwitchBody).contains("MFA_REQUIRED");

        String noMfaLegalLogin = mvc.perform(post("/api/v1/auth/login").with(csrf())
                        .with(req -> { req.setRemoteAddr("198.18.40.11"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "tenantSlug", "legal-a-r4-" + suffix,
                                "email", org.sharedUserEmail(),
                                "password", "OmegaPhase2a1!2026"))))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();
        assertThat(noMfaLegalLogin).contains("MFA_REQUIRED");

        // Activamos TOTP real en la cuenta canónica
        var setup = twoFactorService.beginTotpSetup(org.sharedUserId());
        Instant setupTime = Instant.now();
        twoFactorService.confirmTotpSetup(org.sharedUserId(), TotpUtil.generateTotpCodeAt(setup.secret(), setupTime));

        // Con múltiples membresías no se permite desactivar MFA
        String disableBody = mvc.perform(post("/api/v1/auth/mfa/disable")
                        .header("Authorization", "Bearer " + noMfaJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("password", "OmegaPhase2a1!2026"))))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();
        assertThat(disableBody).contains("MFA_REQUIRED");

        // (b) Login por trusted-device en espacio neutro emite mfa_at = null, que NO sirve para switch-workspace ni salta 2FA en LEGAL organizacional
        String trustedToken = jwtService.issueTrustedDeviceToken(org.sharedUserId(), 3600L);
        jakarta.servlet.http.Cookie trustedCookie = new jakarta.servlet.http.Cookie("omega_trusted_device", trustedToken);
        JsonNode trustedLogin = mapper.readTree(mvc.perform(post("/api/v1/auth/login").with(csrf())
                        .cookie(trustedCookie)
                        .with(req -> { req.setRemoteAddr("198.18.40.12"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "tenantSlug", "billing-r4-" + suffix,
                                "email", org.sharedUserEmail(),
                                "password", "OmegaPhase2a1!2026"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mfaRequired").value(false))
                .andReturn().getResponse().getContentAsString());

        String trustedSessionJwt = trustedLogin.path("accessToken").asText();
        assertThat(jwtService.parseAndValidate(trustedSessionJwt).mfaAt()).isNull();

        String stepUpMissing = mvc.perform(post("/api/v1/auth/switch-workspace")
                        .header("Authorization", "Bearer " + trustedSessionJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("targetTenantId", devTenantId))))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();
        assertThat(stepUpMissing).contains("MFA_STEP_UP_REQUIRED");

        // Login a espacio LEGAL de organización ignora trusted-device y exige challenge 2FA real
        mvc.perform(post("/api/v1/auth/login").with(csrf())
                        .cookie(trustedCookie)
                        .with(req -> { req.setRemoteAddr("198.18.40.13"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "tenantSlug", "legal-a-r4-" + suffix,
                                "email", org.sharedUserEmail(),
                                "password", "OmegaPhase2a1!2026"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mfaRequired").value(true));

        // (c) Step-up TOTP de un solo uso permite switch-workspace, emite JWT de un solo tid con mfa_at, rota cookie y bloquea replay
        String stepUpCode = TotpUtil.generateTotpCodeAt(setup.secret(), Instant.now().plusSeconds(30));
        var switchResult = mvc.perform(post("/api/v1/auth/switch-workspace")
                        .header("Authorization", "Bearer " + trustedSessionJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "targetTenantId", devTenantId,
                                "totpCode", stepUpCode))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId").value(devTenantId.toString()))
                .andExpect(jsonPath("$.profile").value("DEVELOPER"))
                .andReturn();

        assertThat(switchResult.getResponse().getHeader("Set-Cookie")).contains("omega_session=");
        String switchedDevJwt = mapper.readTree(switchResult.getResponse().getContentAsString()).path("accessToken").asText();
        JwtService.ParsedJwtClaims switchedClaims = jwtService.parseAndValidate(switchedDevJwt);
        assertThat(switchedClaims.tenantId()).isEqualTo(devTenantId);
        assertThat(switchedClaims.mfaAt()).isNotNull();

        // Auditoría WORKSPACE_SWITCHED registrada tanto en origen como en destino
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM omega_rag.audit_logs WHERE tenant_id = ? AND action = 'WORKSPACE_SWITCHED'",
                Integer.class, org.billingTenantId())).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM omega_rag.audit_logs WHERE tenant_id = ? AND action = 'WORKSPACE_SWITCHED'",
                Integer.class, devTenantId)).isGreaterThanOrEqualTo(1);

        // Reusar el MISMO código TOTP es rechazado por anti-replay
        String replayBody = mvc.perform(post("/api/v1/auth/switch-workspace")
                        .header("Authorization", "Bearer " + trustedSessionJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "targetTenantId", devTenantId,
                                "totpCode", stepUpCode))))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();
        assertThat(replayBody).contains("MFA_TOTP_REPLAYED");

        // R2(a): ORG_OWNER sin membresía en spaceBTenantId (LEGAL) NO puede hacer switch-workspace a ese espacio
        mvc.perform(post("/api/v1/auth/switch-workspace")
                        .header("Authorization", "Bearer " + switchedDevJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("targetTenantId", org.spaceBTenantId()))))
                .andExpect(status().isForbidden());

        // Ventana de 15 min para LEGAL organizacional: mfa_at antiguo (>15m) falla al cambiar a LEGAL y en acciones sensibles, pero no en lecturas ordinarias
        String staleLegalJwt = jwtService.issueToken(
                org.sharedUserId(),
                org.spaceATenantId(),
                org.sharedUserEmail(),
                Role.ADMIN,
                Instant.now().minusSeconds(16 * 60));
        String staleDevJwt = jwtService.issueToken(
                org.sharedUserId(),
                devTenantId,
                org.sharedUserEmail(),
                Role.ADMIN,
                Instant.now().minusSeconds(16 * 60));

        String staleToLegal = mvc.perform(post("/api/v1/auth/switch-workspace")
                        .header("Authorization", "Bearer " + staleDevJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("targetTenantId", org.spaceATenantId()))))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();
        assertThat(staleToLegal).contains("MFA_STEP_UP_REQUIRED");

        UUID orgLegalCaseId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                VALUES (?, ?, ?, 'Expediente Sensible Org Legal', 'CONFIDENTIAL')
                """, orgLegalCaseId, org.spaceATenantId(), org.sharedUserId());

        // Lectura ordinaria funciona con JWT vigente aunque mfa_at tenga >15 min
        mvc.perform(get("/api/v1/expedientes").header("Authorization", "Bearer " + staleLegalJwt))
                .andExpect(status().isOk());

        // Acción sensible (exportación/eliminación de expediente) exige mfa_at <= 15 min
        mvc.perform(get("/api/v1/expedientes/" + orgLegalCaseId + "/export/json")
                        .header("Authorization", "Bearer " + staleLegalJwt))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/expedientes/" + orgLegalCaseId)
                        .header("Authorization", "Bearer " + staleLegalJwt))
                .andExpect(status().isForbidden());

        String freshLegalJwt = jwtService.issueToken(
                org.sharedUserId(), org.spaceATenantId(), org.sharedUserEmail(), Role.ADMIN, Instant.now());
        mvc.perform(get("/api/v1/expedientes/" + orgLegalCaseId + "/export/json")
                        .header("Authorization", "Bearer " + freshLegalJwt))
                .andExpect(status().isOk());

        // Rate limit en step-up TOTP (tras alcanzar 5 intentos fallidos devuelve 429)
        for (int i = 0; i < 4; i++) {
            mvc.perform(post("/api/v1/auth/switch-workspace")
                            .header("Authorization", "Bearer " + trustedSessionJwt)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(mapper.writeValueAsString(Map.of(
                                    "targetTenantId", devTenantId,
                                    "totpCode", "000000"))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(post("/api/v1/auth/switch-workspace")
                        .header("Authorization", "Bearer " + trustedSessionJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "targetTenantId", devTenantId,
                                "totpCode", "000000"))))
                .andExpect(status().isTooManyRequests());

        // (d) R8: Cuenta LEGAL standalone (sin organización) sigue operando sin exigir mfa_enabled ni mfa_at
        JsonNode standaloneLegal = mapper.readTree(mvc.perform(post("/api/v1/auth/register").with(csrf())
                        .with(req -> { req.setRemoteAddr("198.18.40.99"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "fullName", "Abogada Independiente",
                                "email", "solo-legal-" + suffix + "@example.invalid",
                                "password", "OmegaSoloLegal!2026",
                                "profile", "LEGAL"))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());

        UUID soloTenantId = UUID.fromString(standaloneLegal.path("tenantId").asText());
        UUID soloUserId = UUID.fromString(standaloneLegal.path("userId").asText());
        String soloBearer = "Bearer " + standaloneLegal.path("accessToken").asText();
        credits.subscription(soloTenantId);
        jdbc.update("""
                UPDATE omega_rag.subscriptions
                   SET plan_code = 'PRO', status = 'ACTIVE', paid_verified = TRUE,
                       current_period_start = NOW(), current_period_end = NOW() + INTERVAL '1 month'
                 WHERE tenant_id = ?
                """, soloTenantId);

        UUID soloCaseId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                VALUES (?, ?, ?, 'Caso Independiente', 'CONFIDENTIAL')
                """, soloCaseId, soloTenantId, soloUserId);

        mvc.perform(get("/api/v1/expedientes/" + soloCaseId + "/export/json")
                        .header("Authorization", soloBearer))
                .andExpect(status().isOk());
    }

    @Test
    void phase2a2_humanClientBlockedFromMeteredOpsAndApiTokensRevokedWhenMembershipLostOrDowngraded() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        TwoSpacesOrg org = createPaidOrgWithTwoSpaces("p2a2-tok-" + suffix, "ENTERPRISE", 25, 3000);

        UUID devTenantId = UUID.randomUUID();
        UUID analystUserId = UUID.randomUUID();
        UUID clientUserId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id)
                VALUES (?, ?, 'Dev Space Tokens', TRUE, 'DEVELOPER', 'ORGANIZATION', ?, ?)
                """, devTenantId, "dev-tok-" + suffix, org.orgId(), org.billingTenantId());

        jdbc.update("""
                INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                VALUES (?, ?, ?, ?, 'Analista CI', 'ANALYST', TRUE),
                       (?, ?, ?, ?, 'Cliente Solo Lectura', 'CLIENT', TRUE)
                """,
                analystUserId, devTenantId, "analyst-ci-" + suffix + "@example.invalid", passwordEncoder.encode("OmegaAnalyst!2026"),
                clientUserId, devTenantId, "client-ro-" + suffix + "@example.invalid", passwordEncoder.encode("OmegaClient!2026"));

        // 1. Usuario humano con rol CLIENT recibe 403 en operaciones medidas (@Metered, queryExpediente en organización y CreditService.reserve)
        String clientJwt = jwtService.issueToken(clientUserId, devTenantId, "client-ro-" + suffix + "@example.invalid", Role.CLIENT);
        mvc.perform(post("/api/v1/osint/assets/" + UUID.randomUUID() + "/scan")
                        .header("Authorization", "Bearer " + clientJwt))
                .andExpect(status().isForbidden());

        seats.assignWorkspaceMembership(org.spaceATenantId(), org.sharedUserId(), Role.ADMIN, org.sharedUserId());
        seats.assignWorkspaceMembership(org.spaceATenantId(), clientUserId, Role.CLIENT, org.sharedUserId());
        UUID legalCaseId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                VALUES (?, ?, ?, 'Caso Org Bloqueado a Client IA', 'CONFIDENTIAL')
                """, legalCaseId, org.spaceATenantId(), org.sharedUserId());
        jdbc.update("""
                INSERT INTO omega_rag.expediente_permissions (id, tenant_id, expediente_id, user_id, permission)
                VALUES (?, ?, ?, ?, 'READ')
                """, UUID.randomUUID(), org.spaceATenantId(), legalCaseId, clientUserId);
        String orgLegalClientJwt = jwtService.issueToken(
                clientUserId, org.spaceATenantId(), "client-ro-" + suffix + "@example.invalid", Role.CLIENT, Instant.now());
        mvc.perform(post("/api/v1/expedientes/" + legalCaseId + "/query")
                        .header("Authorization", "Bearer " + orgLegalClientJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\":\"¿Qué dice el contrato?\"}"))
                .andExpect(status().isForbidden());

        SecurityContextHolderSetup: {
            var clientPrincipal = new OmegaPrincipal(clientUserId, devTenantId, "client-ro@example.invalid", Role.CLIENT, true);
            TenantContext.set(new TenantScope(devTenantId, clientUserId, Role.CLIENT));
            try {
                assertThatThrownBy(() -> credits.reserve(devTenantId, clientUserId, CreditOperation.AI_QUERY, 1, null))
                        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class)
                        .hasMessageContaining("CLIENT");
            } finally {
                TenantContext.clear();
            }
        }

        // 2. Analista emite dos tokens API: uno se revoca al degradar a CLIENT y otro al desactivar directamente en BD
        var tokenOne = apiTokenService.createToken(devTenantId, analystUserId, "CI Pipeline 1", 30, 50);
        assertThat(apiTokenService.authenticate(tokenOne.plainTextToken())).isPresent();

        seats.updateWorkspaceMembershipState(devTenantId, analystUserId, Role.CLIENT, true, org.sharedUserId());
        assertThat(apiTokenService.authenticate(tokenOne.plainTextToken())).isEmpty();
        assertThat(jdbc.queryForObject(
                "SELECT revoked_at IS NOT NULL FROM omega_rag.api_tokens WHERE id = ?",
                Boolean.class, tokenOne.token().id())).isTrue();

        // Reactivamos como ANALYST, creamos segundo token y simulamos baja directa en BD (workspace_memberships.active = FALSE)
        seats.updateWorkspaceMembershipState(devTenantId, analystUserId, Role.ANALYST, true, org.sharedUserId());
        var tokenTwo = apiTokenService.createToken(devTenantId, analystUserId, "CI Pipeline 2", 30, 50);
        assertThat(apiTokenService.authenticate(tokenTwo.plainTextToken())).isPresent();

        jdbc.update("UPDATE omega_rag.workspace_memberships SET active = FALSE WHERE tenant_id = ? AND user_id = ?",
                devTenantId, analystUserId);
        assertThat(apiTokenService.authenticate(tokenTwo.plainTextToken())).isEmpty();
        assertThat(jdbc.queryForObject(
                "SELECT revoked_at IS NOT NULL FROM omega_rag.api_tokens WHERE id = ?",
                Boolean.class, tokenTwo.token().id())).isTrue();
    }

    @Test
    void phase2a2_canonicalUserInvitationReusesUserIdLogsInBySlugAndV33ReverseWorks() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        TwoSpacesOrg org = createPaidOrgWithTwoSpaces("p2a2-inv-" + suffix, "ENTERPRISE", 25, 3000);

        UUID devSpaceId = UUID.randomUUID();
        UUID secAdminId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id)
                VALUES (?, ?, 'Dev Invitaciones', TRUE, 'DEVELOPER', 'ORGANIZATION', ?, ?)
                """, devSpaceId, "dev-inv-" + suffix, org.orgId(), org.billingTenantId());
        jdbc.update("""
                INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                VALUES (?, ?, ?, ?, 'Admin Dev', 'ADMIN', TRUE)
                """, secAdminId, devSpaceId, "admin-dev-" + suffix + "@example.invalid", passwordEncoder.encode("OmegaDevAdmin!2026"));

        var setup = twoFactorService.beginTotpSetup(org.sharedUserId());
        twoFactorService.confirmTotpSetup(org.sharedUserId(), TotpUtil.generateTotpCodeAt(setup.secret(), Instant.now()));

        var devAdminPrincipal = new OmegaPrincipal(
                secAdminId, devSpaceId, "admin-dev-" + suffix + "@example.invalid", Role.ADMIN, true, Instant.now());
        var invitation = pilotOpsService.createInvitation(devAdminPrincipal, org.sharedUserEmail(), Role.ANALYST);

        // Con contraseña equivocada rechaza sin vincular
        assertThatThrownBy(() -> pilotOpsService.acceptInvitation(
                invitation.inviteToken(), "Usuaria Multi Espacio", "ClaveIncorrecta!2026", "198.18.41.10"))
                .isInstanceOf(org.springframework.security.authentication.BadCredentialsException.class);

        // Con contraseña válida reutiliza el MISMO users.id canónico y exige challenge 2FA dirigido a devSpaceId
        var accepted = pilotOpsService.acceptInvitation(
                invitation.inviteToken(), "Usuaria Multi Espacio", "OmegaPhase2a1!2026", "198.18.41.11");
        assertThat(accepted.userId()).isEqualTo(org.sharedUserId());
        assertThat(accepted.tenantId()).isEqualTo(devSpaceId);
        assertThat(accepted.mfaRequired()).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM omega_rag.users WHERE LOWER(email) = LOWER(?)",
                Integer.class, org.sharedUserEmail())).isEqualTo(1);

        String codeForAccept = TotpUtil.generateTotpCodeAt(setup.secret(), Instant.now().plusSeconds(30));
        JsonNode verifiedMfa = mapper.readTree(mvc.perform(post("/api/v1/auth/mfa/verify").with(csrf())
                        .with(req -> { req.setRemoteAddr("198.18.41.12"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "challengeToken", accepted.mfaChallengeToken(),
                                "code", codeForAccept))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId").value(devSpaceId.toString()))
                .andExpect(jsonPath("$.role").value("ANALYST"))
                .andReturn().getResponse().getContentAsString());

        JwtService.ParsedJwtClaims verifiedClaims = jwtService.parseAndValidate(verifiedMfa.path("accessToken").asText());
        assertThat(verifiedClaims.userId()).isEqualTo(org.sharedUserId());
        assertThat(verifiedClaims.tenantId()).isEqualTo(devSpaceId);
        assertThat(verifiedClaims.mfaAt()).isNotNull();

        // Reversa documentada de V33 ejecuta limpio
        List<String> v33Lines = Files.readAllLines(
                Path.of("src/main/resources/db/migration/V33__mfa_challenges_target_tenant.sql"),
                StandardCharsets.UTF_8);
        String v33Reverse = v33Lines.stream()
                .filter(l -> l.startsWith("-- ALTER TABLE"))
                .map(l -> l.substring(3))
                .findFirst()
                .orElseThrow();
        String dbName = "omega_v33_rev_" + Long.toUnsignedString(System.nanoTime());
        String baseUrl = container != null ? container.getJdbcUrl() : System.getenv("OMEGA_TEST_DB_URL");
        String username = container != null ? container.getUsername() : System.getenv().getOrDefault("OMEGA_TEST_DB_USER", "omega_test");
        String password = container != null ? container.getPassword() : System.getenv().getOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_only");
        try (Connection adminConn = dataSource.getConnection();
             Statement stmt = adminConn.createStatement()) {
            adminConn.setAutoCommit(true);
            stmt.execute("CREATE DATABASE " + dbName);
        }
        int qIdx = baseUrl.indexOf('?');
        String withoutParams = qIdx >= 0 ? baseUrl.substring(0, qIdx) : baseUrl;
        String params = qIdx >= 0 ? baseUrl.substring(qIdx) : "";
        String targetUrl = withoutParams.substring(0, withoutParams.lastIndexOf('/') + 1) + dbName + params;
        DriverManagerDataSource isolatedDs = new DriverManagerDataSource(targetUrl, username, password);
        try {
            Flyway.configure().dataSource(isolatedDs).locations("classpath:db/migration").target("33").load().migrate();
            try (Connection conn = isolatedDs.getConnection();
                 Statement stmt = conn.createStatement()) {
                stmt.execute(v33Reverse);
            }
        } finally {
            try (Connection adminConn = dataSource.getConnection();
                 Statement stmt = adminConn.createStatement()) {
                adminConn.setAutoCommit(true);
                stmt.execute("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)");
            }
        }
    }
}
