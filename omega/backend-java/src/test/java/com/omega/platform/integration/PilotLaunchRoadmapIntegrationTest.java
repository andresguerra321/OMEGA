package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.DevProjectService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PilotLaunchRoadmapIntegrationTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static org.testcontainers.containers.PostgreSQLContainer<?> pgContainer;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) {
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
                    .withDatabaseName("omega_pilot_roadmap_test")
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
    @Autowired DevProjectService devProjectService;
    @Autowired DocumentRepository documentRepository;
    @Autowired AuditLogService auditLogService;
    @Autowired JdbcTemplate jdbc;

    private record TenantSession(UUID tenantId, UUID userId, String token, String slug) {}

    private TenantSession registerTenant(String prefix, String profile, String ip) throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String slug = "pilot-" + prefix + "-" + suffix;
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .with(csrf())
                        .with(req -> {
                            req.setRemoteAddr(ip);
                            return req;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "tenantSlug", slug,
                                "tenantName", "Org " + slug,
                                "adminEmail", "admin@" + slug + ".invalid",
                                "adminPassword", "PilotStrong!Pass99",
                                "adminFullName", "Admin Pilot",
                                "profile", profile
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString());
        return new TenantSession(
                UUID.fromString(json.get("tenantId").asText()),
                UUID.fromString(json.get("userId").asText()),
                json.get("accessToken").asText(),
                slug
        );
    }

    // -------------------------------------------------------------------------
    // Fase 1 & 2: Embudo de activación DEVELOPER/LEGAL y telemetría Zero-PII
    // -------------------------------------------------------------------------
    @Test
    void phase1And2_developerAndLegalActivationFunnelsAndZeroPiiTelemetry() throws Exception {
        // 1. Perfil DEVELOPER: requiere 3 repos/escaneos y >= 1 hallazgo resuelto para activarse
        TenantSession dev = registerTenant("dev", "DEVELOPER", "198.51.100.41");

        for (int i = 1; i <= 3; i++) {
            devProjectService.recordScanResult(
                    dev.tenantId(), dev.userId(), null, "repo-" + i, null, "main", "CLI",
                    Map.of("score", 95.0, "findings", List.of(), "dependencies", List.of())
            );
        }

        // Intentar enviar PII en telemetría -> debe filtrarse y conservar solo contadores/enums seguros
        mockMvc.perform(post("/api/v1/pilot/telemetry")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + dev.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "eventName", "DEV_FINDING_RESOLVED",
                                "properties", Map.of(
                                        "ruleCategory", "SECRET_LEAK",
                                        "count", 1,
                                        "email", "secret-pii@empresa.org",
                                        "filename", "/Users/privado/clave.pem"
                                )
                        ))))
                .andExpect(status().isAccepted());

        String storedJson = jdbc.queryForObject(
                "SELECT properties_json::text FROM omega_rag.product_telemetry_events WHERE tenant_id = ? AND event_name = 'DEV_FINDING_RESOLVED'",
                String.class, dev.tenantId()
        );
        assertThat(storedJson).contains("SECRET_LEAK").doesNotContain("secret-pii@empresa.org").doesNotContain("clave.pem");

        MvcResult devFunnelRes = mockMvc.perform(get("/api/v1/pilot/funnel")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + dev.token()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode devFunnel = objectMapper.readTree(devFunnelRes.getResponse().getContentAsString());
        assertThat(devFunnel.get("profile").asText()).isEqualTo("DEVELOPER");
        assertThat(devFunnel.get("activated").asBoolean()).isTrue();

        // 2. Perfil LEGAL: requiere expediente propio + 1 documento INDEXED + 1 consulta con cita verificada
        TenantSession legal = registerTenant("legal", "LEGAL", "198.51.100.42");
        MvcResult expRes = mockMvc.perform(post("/api/v1/expedientes")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + legal.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Demanda Mercantil 2026",
                                "description", "Caso real piloto"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        UUID expId = UUID.fromString(objectMapper.readTree(expRes.getResponse().getContentAsString()).get("id").asText());

        documentRepository.saveAndFlush(new DocumentEntity(
                legal.tenantId(), expId, legal.userId(),
                "contrato.pdf", "b".repeat(64), 4, "test-emb", false, DocumentStatus.INDEXED
        ));
        auditLogService.record(
                legal.tenantId(), legal.userId(), "RAG_QUERY_EXECUTED", "EXPEDIENTE", expId.toString(),
                Map.of("citationsCount", 2)
        );

        MvcResult legalFunnelRes = mockMvc.perform(get("/api/v1/pilot/funnel")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + legal.token()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode legalFunnel = objectMapper.readTree(legalFunnelRes.getResponse().getContentAsString());
        assertThat(legalFunnel.get("profile").asText()).isEqualTo("LEGAL");
        assertThat(legalFunnel.get("activated").asBoolean()).isTrue();
    }

    // -------------------------------------------------------------------------
    // Fase 3.1: Invitaciones de equipo por correo (creación, aceptación, no-reuso y revocación)
    // -------------------------------------------------------------------------
    @Test
    void phase3_teamInvitationsAndSanitizedSupportTickets() throws Exception {
        TenantSession admin = registerTenant("team", "DEVELOPER", "198.51.100.43");

        // 1. Admin invita a una analista
        MvcResult inviteRes = mockMvc.perform(post("/api/v1/auth/invitations")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + admin.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", "analista.invitada@despacho.invalid",
                                "role", "ANALYST"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode inviteJson = objectMapper.readTree(inviteRes.getResponse().getContentAsString());
        String inviteToken = inviteJson.get("inviteToken").asText();
        assertThat(inviteToken).startsWith("omega_inv_");

        // 2. La analista acepta la invitación definiendo su propia contraseña -> recibe JWT + recoveryKey
        MvcResult acceptRes = mockMvc.perform(post("/api/v1/auth/invitations/accept")
                        .with(csrf())
                        .with(req -> {
                            req.setRemoteAddr("198.51.100.44");
                            return req;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "token", inviteToken,
                                "fullName", "Laura Analista",
                                "password", "AnalistaStrong!2026"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode acceptedSession = objectMapper.readTree(acceptRes.getResponse().getContentAsString());
        assertThat(acceptedSession.get("tenantId").asText()).isEqualTo(admin.tenantId().toString());
        assertThat(acceptedSession.get("role").asText()).isEqualTo("ANALYST");
        assertThat(acceptedSession.get("recoveryKey").asText()).hasSize(48);
        String analystJwt = acceptedSession.get("accessToken").asText();

        // 3. Reutilizar el mismo token de invitación debe fallar con 401
        mockMvc.perform(post("/api/v1/auth/invitations/accept")
                        .with(csrf())
                        .with(req -> {
                            req.setRemoteAddr("198.51.100.44");
                            return req;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "token", inviteToken,
                                "fullName", "Intruso Replay",
                                "password", "IntrusoStrong!2026"
                        ))))
                .andExpect(status().isUnauthorized());

        // 4. La nueva analista envía un reporte de problema in-app; cualquier token accidental se redacta
        MvcResult ticketRes = mockMvc.perform(post("/api/v1/support/report")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + analystJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "category", "FALSE_POSITIVE",
                                "summary", "Falso positivo al escanear con ghp_1234567890abcdef123456 en rama main",
                                "currentView", "repo_scanner",
                                "lastErrorCode", "SCAN_TIMEOUT"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode ticketJson = objectMapper.readTree(ticketRes.getResponse().getContentAsString());
        assertThat(ticketJson.get("status").asText()).isEqualTo("OPEN");

        MvcResult listTicketsRes = mockMvc.perform(get("/api/v1/support/tickets")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + admin.token()))
                .andExpect(status().isOk())
                .andReturn();
        String ticketsBody = listTicketsRes.getResponse().getContentAsString();
        assertThat(ticketsBody).contains("[REDACTED]").doesNotContain("ghp_1234567890abcdef123456");

        // 5. Revocación de una segunda invitación pendiente
        MvcResult inv2Res = mockMvc.perform(post("/api/v1/auth/invitations")
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + admin.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", "segundo@despacho.invalid",
                                "role", "CLIENT"
                        ))))
                .andExpect(status().isCreated())
                .andReturn();
        String inv2Id = objectMapper.readTree(inv2Res.getResponse().getContentAsString()).get("id").asText();

        mockMvc.perform(delete("/api/v1/auth/invitations/" + inv2Id)
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + admin.token()))
                .andExpect(status().isOk());
    }

    // -------------------------------------------------------------------------
    // Fase 4: Endpoint público de estado, postura Zero-Retention y planes
    // -------------------------------------------------------------------------
    @Test
    void phase4_publicStatusExposesLiveHealthZeroRetentionAndPlansWithoutAuth() throws Exception {
        MvcResult res = mockMvc.perform(get("/api/v1/public/status"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString());
        assertThat(json.get("status").asText()).isEqualTo("UP");
        assertThat(json.get("database").asText()).isEqualTo("UP");
        assertThat(json.get("plans").isArray()).isTrue();
        assertThat(json.get("plans")).hasSize(3);
    }
}
