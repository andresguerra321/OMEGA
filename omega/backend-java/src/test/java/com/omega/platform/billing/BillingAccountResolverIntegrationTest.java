package com.omega.platform.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
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
    @Autowired JdbcTemplate jdbc;
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

        // Trigger V30 sincroniza automáticamente la membresía raíz en workspace_memberships
        String syncedRole = jdbc.queryForObject(
                "SELECT role FROM omega_rag.workspace_memberships WHERE tenant_id = ? AND user_id = ? AND active = TRUE",
                String.class, tenantId, userId);
        assertThat(syncedRole).isEqualTo("ANALYST");

        jdbc.update("UPDATE omega_rag.users SET role = 'ADMIN' WHERE id = ?", userId);
        String updatedRole = jdbc.queryForObject(
                "SELECT role FROM omega_rag.workspace_memberships WHERE tenant_id = ? AND user_id = ?",
                String.class, tenantId, userId);
        assertThat(updatedRole).isEqualTo("ADMIN");
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

        // 3. Organización nueva con pagador LEGAL es rechazada; cuenta LEGAL preexistente heredada se permite sin mover pagos
        JsonNode legacyLegal = registerIndividual("LEGAL");
        UUID legacyTenantId = UUID.fromString(legacyLegal.path("tenantId").asText());
        UUID legacyOwnerId = UUID.fromString(legacyLegal.path("userId").asText());
        credits.subscription(legacyTenantId);

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                VALUES (?, 'Nueva Ilegal', ?, ?, ?, FALSE)
                """, UUID.randomUUID(), "nueva-ilegal-" + suffix, legacyTenantId, legacyOwnerId))
                .isInstanceOf(UncategorizedSQLException.class);

        UUID legacyOrgId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO omega_rag.organizations (id, name, slug, billing_tenant_id, owner_user_id, legacy_legal_payer)
                VALUES (?, 'Bufete Heredado', ?, ?, ?, TRUE)
                """, legacyOrgId, "bufete-heredado-" + suffix, legacyTenantId, legacyOwnerId);
        jdbc.update("""
                UPDATE omega_rag.tenants
                   SET account_type = 'ORGANIZATION', organization_id = ?, billing_tenant_id = ?
                 WHERE id = ?
                """, legacyOrgId, legacyTenantId, legacyTenantId);
        assertThat(resolver.resolveBillingTenantId(legacyTenantId)).isEqualTo(legacyTenantId);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM omega_rag.subscriptions WHERE tenant_id = ?", Integer.class, legacyTenantId))
                .isEqualTo(1);

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
}
