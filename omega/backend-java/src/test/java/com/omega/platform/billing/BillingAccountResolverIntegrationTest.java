package com.omega.platform.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.spy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.security.JwtService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.AuthService;
import com.omega.platform.service.PilotOpsService;
import com.omega.platform.web.dto.AuthDtos.CreateTenantUserRequest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(properties = "OMEGA_BILLING_ENFORCE=true")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BillingAccountResolverIntegrationTest {

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
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired TransactionTemplate tx;
    @Autowired BillingAccountResolver resolver;
    @Autowired CreditService credits;
    @Autowired AccountSeatService seats;
    @Autowired AccountAccessService access;
    @Autowired CommercialSaasService saas;
    @Autowired AuthService authService;
    @Autowired PilotOpsService pilotOpsService;
    @Autowired JwtService jwtService;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired DocumentRepository documentRepository;

    private record OrgFixture(
            UUID orgId,
            UUID billingTenantId,
            UUID ownerUserId,
            String ownerEmail,
            UUID devTenantId,
            UUID legalTenantId
    ) {}

    private JsonNode registerIndividual(String profile) throws Exception {
        String email = "orgphase1-" + Long.toUnsignedString(System.nanoTime()) + "@example.invalid";
        JsonNode response = mapper.readTree(mvc.perform(post("/api/v1/auth/register").with(csrf())
                        .with(request -> {
                            request.setRemoteAddr("198.19." + ThreadLocalRandom.current().nextInt(256) + "."
                                    + ThreadLocalRandom.current().nextInt(1, 255));
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "fullName", "Titular Prueba",
                                "email", email,
                                "password", "OmegaOrgPhase1!2026",
                                "profile", profile))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        return response;
    }

    private OrgFixture createMultiSpaceOrganization(String suffix) {
        return tx.execute(status -> {
            UUID billingTenantId = UUID.randomUUID();
            UUID ownerUserId = UUID.randomUUID();
            UUID orgId = UUID.randomUUID();
            UUID devTenantId = UUID.randomUUID();
            UUID legalTenantId = UUID.randomUUID();
            String ownerEmail = "owner-" + suffix + "@example.invalid";

            // Paso 1: espacio administrativo pagador neutro (GENERAL) con organization_id NULL
            jdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type)
                    VALUES (?, ?, ?, TRUE, 'GENERAL', 'ORGANIZATION')
                    """, billingTenantId, "org-root-" + suffix, "Org Root " + suffix);

            jdbc.update("""
                    INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                    VALUES (?, ?, ?, ?, 'Dueña Org', 'ADMIN', TRUE)
                    """, ownerUserId, billingTenantId, ownerEmail, passwordEncoder.encode("OmegaOrgPhase1!2026"));

            jdbc.update("UPDATE omega_rag.tenants SET owner_user_id = ? WHERE id = ?", ownerUserId, billingTenantId);

            // Paso 2: organización apuntando al espacio pagador actual
            jdbc.update("""
                    INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer, active)
                    VALUES (?, ?, ?, ?, ?, FALSE, TRUE)
                    """, orgId, "Empresa " + suffix, "empresa-" + suffix, billingTenantId, ownerUserId);

            // Paso 3: enlazar espacio pagador y registrar ORG_OWNER
            jdbc.update("""
                    UPDATE omega_rag.tenants
                       SET organization_id = ?, billing_tenant_id = ?
                     WHERE id = ?
                    """, orgId, billingTenantId, billingTenantId);
            jdbc.update("""
                    INSERT INTO omega_rag.organization_members (organization_id, user_id, org_role, active, created_by_user_id)
                    VALUES (?, ?, 'ORG_OWNER', TRUE, ?)
                    """, orgId, ownerUserId, ownerUserId);

            // Espacios hijos con perfiles distintos (DEVELOPER y LEGAL) apuntando al mismo billing_tenant_id
            jdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id)
                    VALUES (?, ?, ?, TRUE, 'DEVELOPER', 'ORGANIZATION', ?, ?)
                    """, devTenantId, "org-dev-" + suffix, "Espacio Ingeniería", orgId, billingTenantId);

            jdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id)
                    VALUES (?, ?, ?, TRUE, 'LEGAL', 'ORGANIZATION', ?, ?)
                    """, legalTenantId, "org-legal-" + suffix, "Espacio Jurídico", orgId, billingTenantId);

            return new OrgFixture(orgId, billingTenantId, ownerUserId, ownerEmail, devTenantId, legalTenantId);
        });
    }

    private void activatePaidPlan(UUID billingTenantId, String planCode, int maxDevices, int monthlyCredits) {
        credits.subscription(billingTenantId);
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
                """, planCode, "pay-" + billingTenantId + "-" + planCode, maxDevices, monthlyCredits, billingTenantId);
    }

    @Test
    void standaloneAccountsWithoutOrganizationBehaveIdenticallyAndSyncRootMembership() throws Exception {
        JsonNode account = registerIndividual("GENERAL");
        UUID tenantId = UUID.fromString(account.path("tenantId").asText());
        UUID userId = UUID.fromString(account.path("userId").asText());

        BillingAccountResolver.ResolvedBillingAccount resolved = resolver.resolve(tenantId);
        assertThat(resolved.belongsToOrganization()).isFalse();
        assertThat(resolved.billingTenantId()).isEqualTo(tenantId);
        assertThat(resolved.billingWorkspace()).isTrue();

        // Trigger raíz crea la membresía en INSERT; desde V31 el UPDATE directo en users.role ya no sobrescribe workspace_memberships
        String syncedRole = jdbc.queryForObject(
                "SELECT role FROM omega_rag.workspace_memberships WHERE tenant_id = ? AND user_id = ? AND active = TRUE",
                String.class, tenantId, userId);
        assertThat(syncedRole).isEqualTo("ANALYST");

        jdbc.update("UPDATE omega_rag.users SET role = 'ADMIN' WHERE id = ?", userId);
        String decoupledRole = jdbc.queryForObject(
                "SELECT role FROM omega_rag.workspace_memberships WHERE tenant_id = ? AND user_id = ?",
                String.class, tenantId, userId);
        assertThat(decoupledRole).isEqualTo("ANALYST");
    }

    @Test
    void multiSpaceOrganizationSharesVerifiedSubscriptionCreditPoolDevicesAndAsyncDocReconciliation() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        OrgFixture org = createMultiSpaceOrganization(suffix);

        // Regla #5: sin pago verificado, incluso el espacio GENERAL de una organización exige membresía pagada
        assertThatThrownBy(() -> credits.requireWorkspaceAccess(org.billingTenantId()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode().value())
                .isEqualTo(402);
        assertThatThrownBy(() -> credits.requireWorkspaceAccess(org.devTenantId()))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> credits.requireWorkspaceAccess(org.legalTenantId()))
                .isInstanceOf(ResponseStatusException.class);

        activatePaidPlan(org.billingTenantId(), "PRO", 5, 500);
        seats.assignWorkspaceMembership(org.devTenantId(), org.ownerUserId(), Role.ADMIN, org.ownerUserId());
        seats.assignWorkspaceMembership(org.legalTenantId(), org.ownerUserId(), Role.ADMIN, org.ownerUserId());
        assertThat(credits.summary(org.devTenantId()).get("planCode")).isEqualTo("PRO");
        assertThat(credits.summary(org.legalTenantId()).get("balance")).isEqualTo(530L);

        // Reserva en espacio DEVELOPER y en espacio LEGAL descuentan atómicamente de la misma bolsa y registran workspace_tenant_id
        UUID devRes = credits.reserve(org.devTenantId(), org.ownerUserId(), CreditOperation.AI_QUERY, 2, null);
        credits.settle(org.devTenantId(), devRes, 2);
        assertThat(credits.summary(org.billingTenantId()).get("balance")).isEqualTo(528L);
        assertThat(jdbc.queryForObject(
                "SELECT workspace_tenant_id FROM omega_rag.credit_reservations WHERE id = ?",
                UUID.class, devRes)).isEqualTo(org.devTenantId());

        // Conciliación asíncrona de documento LEGAL en espacio hijo liquida contra el billing_tenant_id compartido
        UUID legalCaseId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                VALUES (?, ?, ?, 'Caso Reservado', 'CONFIDENTIAL')
                """, legalCaseId, org.legalTenantId(), org.ownerUserId());
        DocumentEntity doc = new DocumentEntity(
                org.legalTenantId(), legalCaseId, org.ownerUserId(), "demanda.pdf", "b".repeat(64),
                20, "test-model", false, DocumentStatus.INDEXED);
        documentRepository.saveAndFlush(doc);

        UUID docRes = credits.reserve(org.legalTenantId(), org.ownerUserId(), CreditOperation.LEGAL_INDEX, 2, null);
        credits.attachReference(org.legalTenantId(), docRes, "document:" + doc.getId());

        // Espacio hermano no puede liquidar una reserva originada en otro espacio
        assertThatThrownBy(() -> credits.settle(org.devTenantId(), docRes, 0))
                .isInstanceOf(EmptyResultDataAccessException.class);

        credits.reconcileDocuments();
        assertThat(jdbc.queryForObject("SELECT status FROM omega_rag.credit_reservations WHERE id = ?", String.class, docRes))
                .isEqualTo("CONSUMED");

        // Concurrencia entre espacios hijos sobre el saldo compartido sin sobregiro
        jdbc.update("UPDATE omega_rag.credit_grants SET remaining = 0 WHERE tenant_id = ?", org.billingTenantId());
        jdbc.update("UPDATE omega_rag.credit_grants SET remaining = 20 WHERE tenant_id = ? AND source = 'WELCOME'", org.billingTenantId());
        try (var pool = Executors.newFixedThreadPool(8)) {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<UUID>> futures = new ArrayList<>();
            for (int i = 0; i < 16; i++) {
                UUID space = (i % 2 == 0) ? org.devTenantId() : org.legalTenantId();
                futures.add(pool.submit(() -> {
                    start.await();
                    try {
                        return credits.reserve(space, org.ownerUserId(), CreditOperation.AI_QUERY, 2, null);
                    } catch (ResponseStatusException ex) {
                        return null;
                    }
                }));
            }
            start.countDown();
            long winners = futures.stream().filter(f -> {
                try { return f.get(15, TimeUnit.SECONDS) != null; } catch (Exception e) { throw new RuntimeException(e); }
            }).count();
            assertThat(winners).isEqualTo(10L);
            assertThat(credits.summary(org.billingTenantId()).get("balance")).isEqualTo(0L);
        }

        // Bolsa compartida de dispositivos (max_devices = 5 en PRO) sin mezclar listados entre espacios
        for (int i = 1; i <= 3; i++) {
            saas.registerOrHeartbeatDevice(org.billingTenantId(), org.ownerUserId(), "root-dev-" + i, "pc-" + i, "windows", "2.2.0");
        }
        for (int i = 1; i <= 2; i++) {
            saas.registerOrHeartbeatDevice(org.devTenantId(), org.ownerUserId(), "eng-dev-" + i, "eng-" + i, "linux", "2.2.0");
        }
        assertThatThrownBy(() -> saas.registerOrHeartbeatDevice(
                org.legalTenantId(), org.ownerUserId(), "legal-dev-6", "mac-6", "macos", "2.2.0"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("5/5");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> devSpaceDevices = (List<Map<String, Object>>) saas.getSaasSummary(org.devTenantId(), org.ownerUserId()).get("devices");
        assertThat(devSpaceDevices).hasSize(2);
    }

    @Test
    void billingResolverAndDatabaseRejectCrossOrganizationBillingReferences() {
        OrgFixture orgX = createMultiSpaceOrganization("x-" + Long.toUnsignedString(System.nanoTime()));
        OrgFixture orgY = createMultiSpaceOrganization("y-" + Long.toUnsignedString(System.nanoTime()));
        activatePaidPlan(orgY.billingTenantId(), "ENTERPRISE", 25, 3000);

        // FK compuesta impide apuntar un espacio de Org X al billing_tenant_id de Org Y
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE omega_rag.tenants SET billing_tenant_id = ? WHERE id = ?",
                orgY.billingTenantId(), orgX.devTenantId()))
                .isInstanceOf(DataIntegrityViolationException.class);

        // Si la organización se desactiva, el resolver bloquea inmediatamente el acceso comercial
        jdbc.update("UPDATE omega_rag.organizations SET active = FALSE WHERE id = ?", orgX.orgId());
        assertThatThrownBy(() -> resolver.resolve(orgX.devTenantId()))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void seatCapCountsDistinctAdminAndAnalystHumansExcludesClientsAndBlocksAllCreationPaths() {
        String suffix = Long.toUnsignedString(System.nanoTime());
        OrgFixture org = createMultiSpaceOrganization(suffix);
        activatePaidPlan(org.billingTenantId(), "PRO", 5, 500); // PRO max_users = 1

        // El dueño (ADMIN) en 3 espacios distintos cuenta como 1 única persona (1 puesto ocupado)
        seats.assignWorkspaceMembership(org.devTenantId(), org.ownerUserId(), Role.ADMIN, org.ownerUserId());
        seats.assignWorkspaceMembership(org.legalTenantId(), org.ownerUserId(), Role.ANALYST, org.ownerUserId());
        assertThat(seats.countActiveOccupiedSeats(org.devTenantId())).isEqualTo(1L);

        OmegaPrincipal rootAdmin = new OmegaPrincipal(org.ownerUserId(), org.billingTenantId(), org.ownerEmail(), Role.ADMIN, true);

        // Rol CLIENT no consume puesto ni por alta directa ni por invitación
        authService.createUserInCurrentTenant(rootAdmin, new CreateTenantUserRequest(
                "cliente1-" + suffix + "@example.invalid", "OmegaClient!2026", "Cliente Externo Uno", Role.CLIENT));
        var clientInvite = pilotOpsService.createInvitation(rootAdmin, "cliente2-" + suffix + "@example.invalid", Role.CLIENT);
        pilotOpsService.acceptInvitation(clientInvite.inviteToken(), "Cliente Externo Dos", "OmegaClient!2026", "198.18.0.10");
        assertThat(seats.countActiveOccupiedSeats(org.billingTenantId())).isEqualTo(1L);

        // Camino 1: alta directa de ANALYST/ADMIN por AuthService bloqueada al superar max_users = 1
        assertThatThrownBy(() -> authService.createUserInCurrentTenant(rootAdmin, new CreateTenantUserRequest(
                "analista-extra-" + suffix + "@example.invalid", "OmegaAnalyst!2026", "Analista Extra", Role.ANALYST)))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode().value())
                .isEqualTo(402);

        // Camino 2: creación de invitación para ANALYST/ADMIN bloqueada cuando el cupo ya está lleno
        assertThatThrownBy(() -> pilotOpsService.createInvitation(
                rootAdmin, "invitado-bloqueado-" + suffix + "@example.invalid", Role.ANALYST))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode().value())
                .isEqualTo(402);

        // Camino 3: invitación emitida cuando había cupo en ENTERPRISE falla al aceptarse si el plan bajó o se llenó el tope
        activatePaidPlan(org.billingTenantId(), "ENTERPRISE", 25, 3000); // max_users = 5
        var pendingInvite = pilotOpsService.createInvitation(
                rootAdmin, "invitado-carrera-" + suffix + "@example.invalid", Role.ANALYST);
        activatePaidPlan(org.billingTenantId(), "PRO", 5, 500); // vuelve a max_users = 1
        assertThatThrownBy(() -> pilotOpsService.acceptInvitation(
                pendingInvite.inviteToken(), "Invitado Carrera", "OmegaAnalyst!2026", "198.18.0.11"))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode().value())
                .isEqualTo(402);

        // Camino 4: asignar membresía operativa en espacio hijo a un usuario externo existente también respeta el tope
        OrgFixture externalOrg = createMultiSpaceOrganization("ext-" + suffix);
        assertThatThrownBy(() -> seats.assignWorkspaceMembership(
                org.devTenantId(), externalOrg.ownerUserId(), Role.ANALYST, org.ownerUserId()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode().value())
                .isEqualTo(402);
    }

    @Test
    void payerProtectionsLegacyLegalConversionAndNonPayingSpaceAdminBillingRestrictionHold() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        OrgFixture org = createMultiSpaceOrganization(suffix);
        activatePaidPlan(org.billingTenantId(), "ENTERPRISE", 25, 3000);

        // 1. El espacio pagador neutro no puede cambiar a LEGAL ni por API ni por SQL
        String ownerJwt = jwtService.issueToken(org.ownerUserId(), org.billingTenantId(), org.ownerEmail(), Role.ADMIN);
        mvc.perform(put("/api/v1/profile")
                        .header("Authorization", "Bearer " + ownerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isConflict());
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE omega_rag.tenants SET profile = 'LEGAL' WHERE id = ?", org.billingTenantId()))
                .isInstanceOf(UncategorizedSQLException.class);

        // 2. El espacio pagador no puede desactivarse ni borrarse mientras tenga espacios hijos
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE omega_rag.tenants SET active = FALSE WHERE id = ?", org.billingTenantId()))
                .isInstanceOf(UncategorizedSQLException.class);
        assertThatThrownBy(() -> jdbc.update(
                "DELETE FROM omega_rag.tenants WHERE id = ?", org.billingTenantId()))
                .isInstanceOf(Exception.class);

        // 3. Una cuenta LEGAL creada DESPUÉS de V30 es rechazada como pagador tanto con legacy_legal_payer=FALSE como con TRUE
        //    (incluso si después de V30 adquiere fila en subscriptions o intenta forzar pre_v30_billing_history=TRUE).
        JsonNode postV30Legal = registerIndividual("LEGAL");
        UUID postV30LegalTenantId = UUID.fromString(postV30Legal.path("tenantId").asText());
        UUID postV30LegalOwnerId = UUID.fromString(postV30Legal.path("userId").asText());
        credits.subscription(postV30LegalTenantId);

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                VALUES (?, 'Nueva Ilegal', ?, ?, ?, FALSE)
                """, UUID.randomUUID(), "nueva-ilegal-" + suffix, postV30LegalTenantId, postV30LegalOwnerId))
                .isInstanceOf(UncategorizedSQLException.class);

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                VALUES (?, 'Falso Heredado PostV30', ?, ?, ?, TRUE)
                """, UUID.randomUUID(), "falso-heredado-" + suffix, postV30LegalTenantId, postV30LegalOwnerId))
                .isInstanceOf(UncategorizedSQLException.class);

        assertThatThrownBy(() -> jdbc.update(
                "UPDATE omega_rag.tenants SET pre_v30_billing_history = TRUE WHERE id = ?", postV30LegalTenantId))
                .isInstanceOf(UncategorizedSQLException.class);

        // 4. R9: el ADMIN de un espacio hijo no pagador NO puede hacer checkout, cancelar ni editar datos fiscales
        UUID childAdminId = UUID.randomUUID();
        String childAdminEmail = "child-admin-" + suffix + "@example.invalid";
        jdbc.update("""
                INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                VALUES (?, ?, ?, ?, 'Admin Espacio Hijo', 'ADMIN', TRUE)
                """, childAdminId, org.devTenantId(), childAdminEmail, passwordEncoder.encode("OmegaChildAdmin!2026"));
        jdbc.update("""
                INSERT INTO omega_rag.organization_members (organization_id, user_id, org_role, active, created_by_user_id)
                VALUES (?, ?, 'MEMBER', TRUE, ?)
                """, org.orgId(), childAdminId, org.ownerUserId());

        String childAdminJwt = jwtService.issueToken(childAdminId, org.devTenantId(), childAdminEmail, Role.ADMIN);

        mvc.perform(get("/api/v1/billing/summary").header("Authorization", "Bearer " + childAdminJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planCode").value("ENTERPRISE"))
                .andExpect(jsonPath("$.profile").value("DEVELOPER"))
                .andExpect(jsonPath("$.canManage").value(false));

        mvc.perform(post("/api/v1/billing/subscribe")
                        .header("Authorization", "Bearer " + childAdminJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"PRO\",\"interval\":\"MONTHLY\",\"topup\":false}"))
                .andExpect(status().isForbidden());

        mvc.perform(post("/api/v1/billing/cancel")
                        .header("Authorization", "Bearer " + childAdminJwt))
                .andExpect(status().isForbidden());

        mvc.perform(get("/api/v1/billing/history")
                        .header("Authorization", "Bearer " + childAdminJwt))
                .andExpect(status().isForbidden());

        mvc.perform(put("/api/v1/commercial/billing/customer")
                        .header("Authorization", "Bearer " + childAdminJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of(
                                "legalName", "Intento No Autorizado SAS",
                                "documentType", "NIT",
                                "documentNumber", "900111222-3",
                                "billingEmail", "fake@example.invalid",
                                "address", "Calle 1",
                                "city", "Bogotá"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void childWorkspaceCheckoutAndApprovedPaymentProvisionBillingTenantAndUnlockChildAccess() throws Exception {
        String suffix = Long.toUnsignedString(System.nanoTime());
        OrgFixture org = createMultiSpaceOrganization("e2e-" + suffix);

        // ORG_ADMIN autenticado directamente en el espacio hijo DEVELOPER
        UUID orgAdminInChildId = UUID.randomUUID();
        String orgAdminEmail = "org-admin-dev-" + suffix + "@example.invalid";
        jdbc.update("""
                INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                VALUES (?, ?, ?, ?, 'Admin Financiero en Hijo', 'ADMIN', TRUE)
                """, orgAdminInChildId, org.devTenantId(), orgAdminEmail, passwordEncoder.encode("OmegaChildOrgAdmin!2026"));
        jdbc.update("""
                INSERT INTO omega_rag.organization_members (organization_id, user_id, org_role, active, created_by_user_id)
                VALUES (?, ?, 'ORG_ADMIN', TRUE, ?)
                """, org.orgId(), orgAdminInChildId, org.ownerUserId());

        String childJwt = jwtService.issueToken(orgAdminInChildId, org.devTenantId(), orgAdminEmail, Role.ADMIN);

        // Antes del pago: el espacio hijo DEVELOPER no tiene acceso profesional
        mvc.perform(get("/api/v1/dev/projects").header("Authorization", "Bearer " + childJwt))
                .andExpect(status().isPaymentRequired());
        mvc.perform(get("/api/v1/billing/summary").header("Authorization", "Bearer " + childJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planCode").value("FREE"))
                .andExpect(jsonPath("$.workspaceAccess").value(false))
                .andExpect(jsonPath("$.canManage").value(true));

        // 1. Checkout iniciado DESDE el espacio hijo (actor.tenantId == devTenantId)
        MercadoPagoClient provider = spy(new MercadoPagoClient(
                "test", "token", "123", "secret", "https://backend.invalid", "https://app.invalid"));
        doNothing().when(provider).validateSeller();
        doAnswer(call -> {
            UUID checkoutId = call.getArgument(2);
            return mapper.valueToTree(Map.of(
                    "id", "preapproval-" + checkoutId,
                    "init_point", "https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id=" + checkoutId));
        }).when(provider).post(anyString(), anyMap(), any(UUID.class));

        BillingService service = new BillingService(jdbc, credits, provider, access, resolver, transactionManager);
        OmegaPrincipal childActor = new OmegaPrincipal(
                orgAdminInChildId, org.devTenantId(), orgAdminEmail, Role.ADMIN, true);

        Map<String, Object> checkoutResp = service.checkout(
                childActor, "PRO", "MONTHLY", false, "buyer-test@example.invalid");
        UUID checkoutId = (UUID) checkoutResp.get("checkoutId");
        String preapprovalId = "preapproval-" + checkoutId;

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM omega_rag.billing_checkouts WHERE tenant_id = ?", Integer.class, org.devTenantId()))
                .isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM omega_rag.billing_checkouts WHERE id = ? AND tenant_id = ?",
                Integer.class, checkoutId, org.billingTenantId()))
                .isEqualTo(1);

        // 2. Pago aprobado simulado contra la suscripción creada desde el espacio hijo
        doNothing().when(provider).validatePayment(any(JsonNode.class));
        JsonNode approvedPayment = mapper.valueToTree(Map.of(
                "id", Long.toUnsignedString(System.nanoTime()),
                "status", "approved",
                "transaction_amount", 59900,
                "currency_id", "COP",
                "date_approved", OffsetDateTime.now().toString()));
        service.processPayment(approvedPayment, preapprovalId);

        // 3. Suscripción, pagos y créditos viven únicamente en billing_tenant_id
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM omega_rag.subscriptions WHERE tenant_id = ?", Integer.class, org.devTenantId()))
                .isZero();
        assertThat(jdbc.queryForObject(
                "SELECT plan_code FROM omega_rag.subscriptions WHERE tenant_id = ? AND paid_verified = TRUE",
                String.class, org.billingTenantId()))
                .isEqualTo("PRO");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM omega_rag.billing_payments WHERE tenant_id = ? AND applied = TRUE",
                Integer.class, org.billingTenantId()))
                .isEqualTo(1);
        assertThat(credits.summary(org.billingTenantId()).get("balance")).isEqualTo(530L);

        // 4. El espacio hijo DEVELOPER ve plan PRO, 530 créditos y desbloquea sus endpoints profesionales
        mvc.perform(get("/api/v1/billing/summary").header("Authorization", "Bearer " + childJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planCode").value("PRO"))
                .andExpect(jsonPath("$.balance").value(530))
                .andExpect(jsonPath("$.workspaceAccess").value(true));

        mvc.perform(get("/api/v1/dev/projects").header("Authorization", "Bearer " + childJwt))
                .andExpect(status().isOk());
    }

    @FunctionalInterface
    private interface IsolatedDbCallback {
        void accept(JdbcTemplate isolatedJdbc, DataSource isolatedDs) throws Exception;
    }

    private void withIsolatedDatabase(IsolatedDbCallback callback) throws Exception {
        String dbName = "omega_v30_" + Long.toUnsignedString(System.nanoTime());
        String baseUrl;
        String username;
        String password;
        if (container != null) {
            baseUrl = container.getJdbcUrl();
            username = container.getUsername();
            password = container.getPassword();
        } else {
            baseUrl = System.getenv("OMEGA_TEST_DB_URL");
            username = System.getenv().getOrDefault("OMEGA_TEST_DB_USER", "omega_test");
            password = System.getenv().getOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_only");
        }

        try (Connection adminConn = dataSource.getConnection();
             Statement stmt = adminConn.createStatement()) {
            adminConn.setAutoCommit(true);
            stmt.execute("CREATE DATABASE " + dbName);
        }

        int qIdx = baseUrl.indexOf('?');
        String withoutParams = qIdx >= 0 ? baseUrl.substring(0, qIdx) : baseUrl;
        String params = qIdx >= 0 ? baseUrl.substring(qIdx) : "";
        int slashIdx = withoutParams.lastIndexOf('/');
        String targetUrl = withoutParams.substring(0, slashIdx + 1) + dbName + params;

        DriverManagerDataSource isolatedDs = new DriverManagerDataSource(targetUrl, username, password);
        JdbcTemplate isolatedJdbc = new JdbcTemplate(isolatedDs);
        try {
            callback.accept(isolatedJdbc, isolatedDs);
        } finally {
            try (Connection adminConn = dataSource.getConnection();
                 Statement stmt = adminConn.createStatement()) {
                adminConn.setAutoCommit(true);
                stmt.execute("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)");
            }
        }
    }

    @Test
    void v30MigratesSeededV29DataAndEnforcesPreV30BillingHistoryForLegacyLegalPayer() throws Exception {
        withIsolatedDatabase((migJdbc, migDs) -> {
            // 1. Migrar únicamente hasta V29
            Flyway.configure()
                    .dataSource(migDs)
                    .locations("classpath:db/migration")
                    .target("29")
                    .load()
                    .migrate();

            UUID orgTenantId = UUID.randomUUID();
            UUID orgAdminId = UUID.randomUUID();
            UUID orgAnalystId = UUID.randomUUID();
            UUID orgCaseId = UUID.randomUUID();

            UUID billedLegalTenantId = UUID.randomUUID();
            UUID billedLegalOwnerId = UUID.randomUUID();
            UUID billedLegalCaseId = UUID.randomUUID();

            UUID unbilledLegalTenantId = UUID.randomUUID();
            UUID unbilledLegalOwnerId = UUID.randomUUID();
            UUID unbilledLegalCaseId = UUID.randomUUID();

            UUID freeOnlyLegalTenantId = UUID.randomUUID();
            UUID freeOnlyLegalOwnerId = UUID.randomUUID();
            UUID freeOnlyLegalCaseId = UUID.randomUUID();

            // Sembrar datos reales en esquema V29: varios tenants, usuarios, expedientes con dueño y suscripciones/pagos
            migJdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type)
                    VALUES (?, 'v29-general', 'Empresa V29', TRUE, 'GENERAL', 'ORGANIZATION'),
                           (?, 'v29-legal-paid', 'Bufete Pagador V29', TRUE, 'LEGAL', 'INDIVIDUAL'),
                           (?, 'v29-legal-unpaid', 'Bufete Sin Pagos V29', TRUE, 'LEGAL', 'INDIVIDUAL'),
                           (?, 'v29-legal-free-only', 'Bufete Solo Free V29', TRUE, 'LEGAL', 'INDIVIDUAL')
                    """, orgTenantId, billedLegalTenantId, unbilledLegalTenantId, freeOnlyLegalTenantId);

            String hash = passwordEncoder.encode("OmegaMigration!2026");
            migJdbc.update("""
                    INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                    VALUES (?, ?, 'admin@v29.invalid', ?, 'Admin V29', 'ADMIN', TRUE),
                           (?, ?, 'analyst@v29.invalid', ?, 'Analista V29', 'ANALYST', TRUE),
                           (?, ?, 'socio@paidlegal.invalid', ?, 'Socio Legal Pagador', 'ANALYST', TRUE),
                           (?, ?, 'abogado@unpaidlegal.invalid', ?, 'Abogado Sin Pago', 'ANALYST', TRUE),
                           (?, ?, 'abogado@freelegal.invalid', ?, 'Abogado Solo Free', 'ANALYST', TRUE)
                    """, orgAdminId, orgTenantId, hash,
                    orgAnalystId, orgTenantId, hash,
                    billedLegalOwnerId, billedLegalTenantId, hash,
                    unbilledLegalOwnerId, unbilledLegalTenantId, hash,
                    freeOnlyLegalOwnerId, freeOnlyLegalTenantId, hash);

            migJdbc.update("UPDATE omega_rag.tenants SET owner_user_id = ? WHERE id = ?", orgAdminId, orgTenantId);
            migJdbc.update("UPDATE omega_rag.tenants SET owner_user_id = ? WHERE id = ?", billedLegalOwnerId, billedLegalTenantId);
            migJdbc.update("UPDATE omega_rag.tenants SET owner_user_id = ? WHERE id = ?", unbilledLegalOwnerId, unbilledLegalTenantId);
            migJdbc.update("UPDATE omega_rag.tenants SET owner_user_id = ? WHERE id = ?", freeOnlyLegalOwnerId, freeOnlyLegalTenantId);

            migJdbc.update("""
                    INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                    VALUES (?, ?, ?, 'Caso Corporativo V29', 'INTERNAL'),
                           (?, ?, ?, 'Litigio Pre-V30 Pagado', 'CONFIDENTIAL'),
                           (?, ?, ?, 'Litigio Pre-V30 Sin Suscripción', 'CONFIDENTIAL'),
                           (?, ?, ?, 'Litigio Pre-V30 Solo Free', 'CONFIDENTIAL')
                    """, orgCaseId, orgTenantId, orgAdminId,
                    billedLegalCaseId, billedLegalTenantId, billedLegalOwnerId,
                    unbilledLegalCaseId, unbilledLegalTenantId, unbilledLegalOwnerId,
                    freeOnlyLegalCaseId, freeOnlyLegalTenantId, freeOnlyLegalOwnerId);

            migJdbc.update("""
                    INSERT INTO omega_rag.expediente_permissions (id, tenant_id, expediente_id, user_id, permission)
                    VALUES (?, ?, ?, ?, 'READ')
                    """, UUID.randomUUID(), orgTenantId, orgCaseId, orgAnalystId);

            // Suscripciones previas a V30: ENTERPRISE/PRO verificadas + una fila FREE (paid_verified=FALSE) y un pago rechazado en freeOnlyLegalTenantId
            migJdbc.update("""
                    INSERT INTO omega_rag.subscriptions (id, tenant_id, plan_code, status, paid_verified, billing_interval, max_devices, monthly_ai_quota, current_period_start, current_period_end)
                    VALUES (?, ?, 'ENTERPRISE', 'ACTIVE', TRUE, 'MONTHLY', 25, 3000, NOW(), NOW() + INTERVAL '30 days'),
                           (?, ?, 'PRO', 'ACTIVE', TRUE, 'MONTHLY', 5, 500, NOW(), NOW() + INTERVAL '30 days'),
                           (?, ?, 'FREE', 'ACTIVE', FALSE, 'MONTHLY', 1, 30, NOW(), NOW() + INTERVAL '30 days')
                    """, UUID.randomUUID(), orgTenantId, UUID.randomUUID(), billedLegalTenantId, UUID.randomUUID(), freeOnlyLegalTenantId);

            UUID preV30CheckoutId = UUID.randomUUID();
            UUID rejectedFreeCheckoutId = UUID.randomUUID();
            migJdbc.update("""
                    INSERT INTO omega_rag.billing_checkouts (id, tenant_id, actor_user_id, kind, plan_code, interval, amount, credits, status)
                    VALUES (?, ?, ?, 'SUBSCRIPTION', 'PRO', 'MONTHLY', 59900, 500, 'ACTIVE'),
                           (?, ?, ?, 'SUBSCRIPTION', 'PRO', 'MONTHLY', 59900, 500, 'FAILED')
                    """, preV30CheckoutId, billedLegalTenantId, billedLegalOwnerId,
                    rejectedFreeCheckoutId, freeOnlyLegalTenantId, freeOnlyLegalOwnerId);
            migJdbc.update("""
                    INSERT INTO omega_rag.billing_payments (mp_payment_id, checkout_id, tenant_id, amount, currency, status, approved_at, applied)
                    VALUES ('mp-pre-v30-001', ?, ?, 59900, 'COP', 'approved', NOW(), TRUE),
                           ('mp-pre-v30-rejected', ?, ?, 59900, 'COP', 'rejected', NULL, FALSE)
                    """, preV30CheckoutId, billedLegalTenantId, rejectedFreeCheckoutId, freeOnlyLegalTenantId);

            // 2. Ejecutar migración V30 sobre los datos reales V29
            Flyway.configure()
                    .dataSource(migDs)
                    .locations("classpath:db/migration")
                    .target("30")
                    .load()
                    .migrate();

            // Verificar backfill de las 5 membresías raíz, expedientes y suscripciones intactas
            assertThat(migJdbc.queryForObject("SELECT count(*) FROM omega_rag.workspace_memberships WHERE active = TRUE", Integer.class))
                    .isEqualTo(5);
            assertThat(migJdbc.queryForObject("SELECT count(*) FROM omega_rag.expedientes", Integer.class))
                    .isEqualTo(4);
            assertThat(migJdbc.queryForObject(
                    "SELECT pre_v30_billing_history FROM omega_rag.tenants WHERE id = ?", Boolean.class, billedLegalTenantId))
                    .isTrue();
            assertThat(migJdbc.queryForObject(
                    "SELECT pre_v30_billing_history FROM omega_rag.tenants WHERE id = ?", Boolean.class, unbilledLegalTenantId))
                    .isFalse();
            assertThat(migJdbc.queryForObject(
                    "SELECT pre_v30_billing_history FROM omega_rag.tenants WHERE id = ?", Boolean.class, freeOnlyLegalTenantId))
                    .isFalse();

            // Punto 4a: el tenant LEGAL que YA tenía suscripción pagada / pago aprobado antes de V30 SÍ puede usar legacy_legal_payer=TRUE
            UUID inheritedOrgId = UUID.randomUUID();
            migJdbc.update("""
                    INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                    VALUES (?, 'Bufete Pre-V30 Legítimo', 'bufete-pre-v30', ?, ?, TRUE)
                    """, inheritedOrgId, billedLegalTenantId, billedLegalOwnerId);
            migJdbc.update("""
                    UPDATE omega_rag.tenants
                       SET account_type = 'ORGANIZATION', organization_id = ?, billing_tenant_id = ?
                     WHERE id = ?
                    """, inheritedOrgId, billedLegalTenantId, billedLegalTenantId);

            // Punto 4b: un tenant LEGAL que solo tenía fila FREE (y/o pago rechazado) antes de V30 DEBE SER RECHAZADO como legacy_legal_payer
            assertThatThrownBy(() -> migJdbc.update("""
                    INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                    VALUES (?, 'Bufete Solo Free', 'bufete-solo-free', ?, ?, TRUE)
                    """, UUID.randomUUID(), freeOnlyLegalTenantId, freeOnlyLegalOwnerId))
                    .isInstanceOf(UncategorizedSQLException.class)
                    .hasMessageContaining("legacy_legal_payer");

            // Punto 4c: el tenant LEGAL que NO tenía suscripción ni pagos antes de V30 es RECHAZADO
            // incluso si adquiere una suscripción después de V30.
            migJdbc.update("""
                    INSERT INTO omega_rag.subscriptions (id, tenant_id, plan_code, status, paid_verified, billing_interval, max_devices, monthly_ai_quota, current_period_start, current_period_end)
                    VALUES (?, ?, 'PRO', 'ACTIVE', TRUE, 'MONTHLY', 5, 500, NOW(), NOW() + INTERVAL '30 days')
                    """, UUID.randomUUID(), unbilledLegalTenantId);

            assertThatThrownBy(() -> migJdbc.update("""
                    INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                    VALUES (?, 'Bufete Sin Historial Pre-V30', 'bufete-sin-pre-v30', ?, ?, TRUE)
                    """, UUID.randomUUID(), unbilledLegalTenantId, unbilledLegalOwnerId))
                    .isInstanceOf(UncategorizedSQLException.class);
        });
    }

    private static String extractDocumentedV30ReverseSql() throws Exception {
        Path v30Path = Path.of("src/main/resources/db/migration/V30__organizations_and_shared_billing_spaces.sql");
        List<String> lines = Files.readAllLines(v30Path, StandardCharsets.UTF_8);
        StringBuilder reverseBuilder = new StringBuilder();
        boolean inReverseBlock = false;
        for (String line : lines) {
            if (line.startsWith("-- Reverse")) {
                inReverseBlock = true;
                continue;
            }
            if (inReverseBlock) {
                if (!line.startsWith("--")) {
                    break;
                }
                String sqlLine = line.length() > 3 ? line.substring(3) : "";
                reverseBuilder.append(sqlLine).append('\n');
            }
        }
        return reverseBuilder.toString().trim();
    }

    @Test
    void v30DocumentedReverseSqlAbortsClearlyWhenCrossTenantMembershipsOrOwnersExist() throws Exception {
        String reverseSql = extractDocumentedV30ReverseSql();
        assertThat(reverseSql).contains("Reversa V30 abortada");

        withIsolatedDatabase((migJdbc, migDs) -> {
            Flyway.configure().dataSource(migDs).locations("classpath:db/migration").target("30").load().migrate();

            UUID rootTenantId = UUID.randomUUID();
            UUID childTenantId = UUID.randomUUID();
            UUID rootUserId = UUID.randomUUID();
            UUID orgId = UUID.randomUUID();

            migJdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type)
                    VALUES (?, 'abort-root', 'Abort Root', TRUE, 'GENERAL', 'ORGANIZATION')
                    """, rootTenantId);
            migJdbc.update("""
                    INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                    VALUES (?, ?, 'abort@v30.invalid', ?, 'Admin Abort', 'ADMIN', TRUE)
                    """, rootUserId, rootTenantId, passwordEncoder.encode("OmegaAbort!2026"));
            migJdbc.update("""
                    INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                    VALUES (?, 'Org Abort', 'org-abort', ?, ?, FALSE)
                    """, orgId, rootTenantId, rootUserId);
            migJdbc.update("UPDATE omega_rag.tenants SET organization_id = ?, billing_tenant_id = ? WHERE id = ?",
                    orgId, rootTenantId, rootTenantId);
            migJdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type, organization_id, billing_tenant_id)
                    VALUES (?, 'abort-child', 'Abort Child', TRUE, 'LEGAL', 'ORGANIZATION', ?, ?)
                    """, childTenantId, orgId, rootTenantId);

            // Membresía y expediente con dueño cruzado (rootUserId vive en rootTenantId, pero es miembro/dueño en childTenantId)
            migJdbc.update("""
                    INSERT INTO omega_rag.workspace_memberships (tenant_id, user_id, role, active)
                    VALUES (?, ?, 'ADMIN', TRUE)
                    """, childTenantId, rootUserId);
            migJdbc.update("""
                    INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                    VALUES (?, ?, ?, 'Expediente Cruzado', 'CONFIDENTIAL')
                    """, UUID.randomUUID(), childTenantId, rootUserId);

            assertThatThrownBy(() -> {
                try (Connection conn = migDs.getConnection();
                     Statement stmt = conn.createStatement()) {
                    stmt.execute(reverseSql);
                }
            }).hasMessageContaining("Reversa V30 abortada");

            // El aborto ocurre en el preflight antes de borrar ninguna tabla de V30
            assertThat(migJdbc.queryForObject("""
                    SELECT count(*) FROM information_schema.tables
                     WHERE table_schema = 'omega_rag'
                       AND table_name IN ('organizations', 'organization_members', 'workspace_memberships')
                    """, Integer.class)).isEqualTo(3);
        });
    }

    @Test
    void v30DocumentedReverseSqlRollsBackCleanlyToV29Schema() throws Exception {
        String reverseSql = extractDocumentedV30ReverseSql();
        assertThat(reverseSql).contains("DROP TABLE IF EXISTS omega_rag.organizations");

        withIsolatedDatabase((migJdbc, migDs) -> {
            Flyway.configure().dataSource(migDs).locations("classpath:db/migration").target("29").load().migrate();

            UUID tenantId = UUID.randomUUID();
            UUID userId = UUID.randomUUID();
            UUID caseId = UUID.randomUUID();
            migJdbc.update("""
                    INSERT INTO omega_rag.tenants (id, slug, name, active, profile, account_type)
                    VALUES (?, 'rollback-root', 'Rollback Root', TRUE, 'GENERAL', 'ORGANIZATION')
                    """, tenantId);
            migJdbc.update("""
                    INSERT INTO omega_rag.users (id, tenant_id, email, password_hash, full_name, role, active)
                    VALUES (?, ?, 'rollback@v29.invalid', ?, 'Admin Rollback', 'ADMIN', TRUE)
                    """, userId, tenantId, passwordEncoder.encode("OmegaRollback!2026"));
            migJdbc.update("""
                    INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                    VALUES (?, ?, ?, 'Expediente Sobreviviente', 'CONFIDENTIAL')
                    """, caseId, tenantId, userId);
            migJdbc.update("""
                    INSERT INTO omega_rag.subscriptions (id, tenant_id, plan_code, status, paid_verified, max_devices, monthly_ai_quota)
                    VALUES (?, ?, 'PRO', 'ACTIVE', TRUE, 5, 500)
                    """, UUID.randomUUID(), tenantId);

            // Aplicar V30 y usar las tablas nuevas antes de revertir
            Flyway.configure().dataSource(migDs).locations("classpath:db/migration").target("30").load().migrate();

            UUID orgId = UUID.randomUUID();
            migJdbc.update("""
                    INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                    VALUES (?, 'Org Temporal', 'org-temporal', ?, ?, FALSE)
                    """, orgId, tenantId, userId);
            migJdbc.update("UPDATE omega_rag.tenants SET organization_id = ?, billing_tenant_id = ? WHERE id = ?",
                    orgId, tenantId, tenantId);
            migJdbc.update("""
                    INSERT INTO omega_rag.organization_members (organization_id, user_id, org_role, active)
                    VALUES (?, ?, 'ORG_OWNER', TRUE)
                    """, orgId, userId);
            migJdbc.update("""
                    INSERT INTO omega_rag.credit_reservations (id, tenant_id, workspace_tenant_id, actor_user_id, operation, amount)
                    VALUES (?, ?, ?, ?, 'AI_QUERY', 2)
                    """, UUID.randomUUID(), tenantId, tenantId, userId);

            // Ejecutar literalmente el SQL de reversa documentado en V30
            try (Connection conn = migDs.getConnection();
                 Statement stmt = conn.createStatement()) {
                stmt.execute(reverseSql);
            }

            // Verificar que las tablas y columnas de V30 desaparecieron y los datos V29 siguen intactos y operativos
            assertThat(migJdbc.queryForObject("""
                    SELECT count(*) FROM information_schema.tables
                     WHERE table_schema = 'omega_rag'
                       AND table_name IN ('organizations', 'organization_members', 'workspace_memberships')
                    """, Integer.class)).isZero();

            assertThat(migJdbc.queryForObject("""
                    SELECT count(*) FROM information_schema.columns
                     WHERE table_schema = 'omega_rag'
                       AND ((table_name = 'tenants' AND column_name IN ('organization_id', 'billing_tenant_id', 'pre_v30_billing_history', 'credit_limit_override', 'device_limit_override'))
                         OR (table_name = 'credit_reservations' AND column_name = 'workspace_tenant_id'))
                    """, Integer.class)).isZero();

            assertThat(migJdbc.queryForObject("SELECT count(*) FROM omega_rag.expedientes WHERE id = ?", Integer.class, caseId))
                    .isEqualTo(1);
            assertThat(migJdbc.queryForObject("SELECT count(*) FROM omega_rag.subscriptions WHERE tenant_id = ?", Integer.class, tenantId))
                    .isEqualTo(1);

            // Verificar que la FK restaurada a omega_rag.users(tenant_id, id) sigue funcionando tras la reversa
            UUID postRollbackCaseId = UUID.randomUUID();
            migJdbc.update("""
                    INSERT INTO omega_rag.expedientes (id, tenant_id, owner_user_id, title, classification)
                    VALUES (?, ?, ?, 'Nuevo Expediente Post-Reversa', 'INTERNAL')
                    """, postRollbackCaseId, tenantId, userId);
            assertThat(migJdbc.queryForObject("SELECT count(*) FROM omega_rag.expedientes WHERE tenant_id = ?", Integer.class, tenantId))
                    .isEqualTo(2);
        });
    }
}
