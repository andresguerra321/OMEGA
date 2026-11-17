package com.omega.platform.cti;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ExternalReputationInfrastructureTest {
    @Test
    void localModeNeverContactsConfiguredRemoteProvidersOrInfrastructureWorker() {
        PublicSchemaSupport schema = mock(PublicSchemaSupport.class);
        when(schema.matchKnownIocs(anyList(), anyInt())).thenReturn(List.of());
        var service = new ExternalReputationService(schema, new ObjectMapper(), "fake-key", "fake-key");
        var http = mock(java.net.http.HttpClient.class);
        var worker = mock(RestClient.class);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "httpClient", http);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "aiProvider", "ollama");
        service.setInfrastructureClient(worker);
        var response = service.lookupIndicator("https://example.com/private-evidence");
        assertThat(response.get("riskLevel")).isEqualTo("UNKNOWN");
        assertThat(((Map<?, ?>) response.get("infrastructure_intelligence")).get("status")).isEqualTo("disabled_local_mode");
        verifyNoInteractions(http, worker);
    }
    @Test
    void freshInfrastructureRaisesRiskWithoutHistoricalIocAndDoesNotInventHarmlessVerdict() {
        PublicSchemaSupport schema = mock(PublicSchemaSupport.class);
        when(schema.matchKnownIocs(anyList(), anyInt())).thenReturn(List.of());
        ExternalReputationService service = new ExternalReputationService(schema, new ObjectMapper(), "", "");
        RestClient.Builder client = RestClient.builder().baseUrl("http://worker.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(client).build();
        service.setInfrastructureClient(client.build());
        server.expect(requestTo("http://worker.test/api/link/infrastructure"))
                .andExpect(content().json("{\"url\":\"https://example.com\",\"activeProbe\":false}"))
                .andRespond(withSuccess("{\"domainAgeDays\":4,\"freshTlsCertificate\":true,\"cloakingDetected\":true,\"evasionRiskScore\":85,\"riskLevel\":\"HIGH\"}", MediaType.APPLICATION_JSON));
        var result = service.lookupIndicator("https://example.com");
        assertThat(result.get("riskLevel")).isEqualTo("HIGH");
        assertThat(((Map<?, ?>) result.get("infrastructure_intelligence")).get("domainAgeDays")).isEqualTo(4);
        assertThat(((Map<?, ?>) result.get("virustotal")).get("harmless")).isEqualTo(0);
        server.verify();
    }

    @Test
    void unavailableInfrastructureIsUnknownInsteadOfSafe() {
        PublicSchemaSupport schema = mock(PublicSchemaSupport.class);
        when(schema.matchKnownIocs(anyList(), anyInt())).thenReturn(List.of());
        var service = new ExternalReputationService(schema, new ObjectMapper(), "", "");
        assertThat(service.lookupIndicator("example.com").get("riskLevel")).isEqualTo("UNKNOWN");
    }
}
