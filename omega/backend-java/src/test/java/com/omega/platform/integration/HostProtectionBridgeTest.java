package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import com.omega.platform.integration.forensic.ArchiveSecurityValidator;
import com.omega.platform.integration.forensic.ForensicBridgeService;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.AuditLogService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class HostProtectionBridgeTest {
    private final OmegaPrincipal principal = new OmegaPrincipal(UUID.randomUUID(), UUID.randomUUID(), "owner@example.org", Role.ADMIN, true);
    private final AuditLogService audit = mock(AuditLogService.class);

    private ForensicBridgeService bridge(RestClient client) {
        ForensicBridgeService service = new ForensicBridgeService(client, mock(ArchiveSecurityValidator.class),
                mock(ExpedienteAuthorizationService.class), audit);
        service.setHostWorkerRestClient(client);
        return service;
    }

    @Test
    void statusForwardsOwnerTenantAndPreservesCoverage() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://host.test")
                .defaultHeader("X-Internal-Service-Token", "private-test-token");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://host.test/api/host/realtime/status"))
                .andExpect(header("X-Host-Tenant", principal.tenantId().toString()))
                .andExpect(header("X-Internal-Service-Token", "private-test-token"))
                .andRespond(withSuccess("""
                        {"enabled":true,"active":false,"running":true,"state":"degraded","scope":"native-host",
                        "indicatorCount":2,"dnsCoverage":"unavailable","alerts":[],
                        "capabilities":{"blocking":false,"eventBasedCapture":false}}
                        """, MediaType.APPLICATION_JSON));
        var response = bridge(builder.build()).hostRealtimeStatus(principal);
        assertThat(response.active()).isFalse();
        assertThat(response.dnsCoverage()).isEqualTo("unavailable");
        assertThat(response.capabilities().get("blocking")).isEqualTo(false);
        server.verify();
    }

    @Test
    void toggleIsExplicitAndAudited() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://host.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://host.test/api/host/realtime/toggle"))
                .andExpect(method(HttpMethod.POST)).andExpect(content().json("{\"enabled\":false}"))
                .andExpect(header("X-Host-Tenant", principal.tenantId().toString()))
                .andRespond(withSuccess("{\"enabled\":false,\"state\":\"paused\",\"alerts\":[]}", MediaType.APPLICATION_JSON));
        assertThat(bridge(builder.build()).toggleHostRealtime(principal, false).enabled()).isFalse();
        verify(audit).record(eq(principal.tenantId()), eq(principal.userId()), eq("HOST_WATCH_TOGGLED"), anyString(), anyString(), anyMap());
        server.verify();
    }

    @Test
    void persistencePreservesHashesAndHumanExplanation() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://host.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://host.test/api/host/persistence/audit"))
                .andExpect(method(HttpMethod.POST)).andExpect(header("X-Host-Tenant", principal.tenantId().toString()))
                .andRespond(withSuccess("""
                        {"scope":"native-host","hostname":"workstation","platform":"win32","complete":false,
                         "findings":[{"id":"item","category":"STARTUP","persistenceType":"RunOnce",
                         "location":"HKCU","targetPath":"C:/temp/app.exe","sha256":"abc","signatureStatus":"Unsigned",
                         "severity":"MEDIUM","userFriendlyTitle":"Programa sin firma al iniciar",
                         "userFriendlyExplanation":"Verifica si lo reconoces","recommendedAction":"Consultar soporte",
                         "evidence":{},"ctiMatches":[]}],"processes":[],"processFindings":[],"limitations":["No access"]}
                        """, MediaType.APPLICATION_JSON));
        var response = bridge(builder.build()).auditHostPersistence(principal);
        assertThat(response.complete()).isFalse();
        assertThat(response.findings().getFirst().sha256()).isEqualTo("abc");
        assertThat(response.findings().getFirst().userFriendlyExplanation()).isEqualTo("Verifica si lo reconoces");
        server.verify();
    }
}
