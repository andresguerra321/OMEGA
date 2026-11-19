package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.integration.forensic.ForensicWorkerException;
import com.omega.platform.integration.forensic.ForensicWorkerTransport;
import com.omega.platform.integration.forensic.HostSensorBridge;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.AuditLogService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class HostSensorAvailabilityTest {
    private final OmegaPrincipal principal = new OmegaPrincipal(UUID.randomUUID(), UUID.randomUUID(), "owner@example.org", Role.ADMIN, true);

    @Test
    void dockerWorkerIsReportedUnavailableWithoutAttemptingCatalogSynchronization() {
        var builder = RestClient.builder().baseUrl("http://worker.test");
        var server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://worker.test/api/health"))
                .andRespond(withSuccess("{\"scope\":\"container\"}", MediaType.APPLICATION_JSON));
        var catalog = mock(StixCatalogService.class);
        var audit = mock(AuditLogService.class);
        var bridge = new HostSensorBridge(new ForensicWorkerTransport(builder.build(), catalog), audit);
        var status = bridge.hostRealtimeStatus(principal);
        assertThat(status.scope()).isEqualTo("container");
        assertThat(status.active()).isFalse();
        assertThat(status.enabled()).isFalse();
        assertThat(status.hostname()).isNull();
        assertThat(status.notice()).contains("sensor nativo");
        verifyNoInteractions(catalog, audit);
        server.verify();
    }

    @Test
    void containerCannotActivateHostSurveillanceOrRunHostPersistenceAudit() {
        var builder = RestClient.builder().baseUrl("http://worker.test");
        var server = MockRestServiceServer.bindTo(builder).build();
        server.expect(org.springframework.test.web.client.ExpectedCount.twice(), requestTo("http://worker.test/api/health"))
                .andRespond(withSuccess("{\"scope\":\"container\"}", MediaType.APPLICATION_JSON));
        var audit = mock(AuditLogService.class);
        var catalog = mock(StixCatalogService.class);
        var bridge = new HostSensorBridge(new ForensicWorkerTransport(builder.build(), catalog), audit);
        assertThatThrownBy(() -> bridge.toggleHostRealtime(principal, true)).isInstanceOf(ForensicWorkerException.class);
        assertThatThrownBy(() -> bridge.auditHostPersistence(principal)).isInstanceOf(ForensicWorkerException.class);
        verifyNoInteractions(catalog, audit);
        server.verify();
    }
}
