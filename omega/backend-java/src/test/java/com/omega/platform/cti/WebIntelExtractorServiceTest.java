package com.omega.platform.cti;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.AuditLogService;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class WebIntelExtractorServiceTest {

    @Test
    void rejectsPrivateLoopbackCgnatAndCloudMetadataAddresses() throws Exception {
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("127.0.0.1"))).isFalse();
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("10.0.0.5"))).isFalse();
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("100.64.1.9"))).isFalse();
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("169.254.169.254"))).isFalse();
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("172.16.4.1"))).isFalse();
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("192.168.1.1"))).isFalse();
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("fc00::1"))).isFalse();
        assertThat(WebIntelExtractorService.isPublicRoutableAddress(InetAddress.getByName("93.184.216.34"))).isTrue();

        assertThatThrownBy(() -> WebIntelExtractorService.parseAndValidatePublicUri("http://169.254.169.254/latest/meta-data"))
                .isInstanceOf(InvalidDocumentException.class)
                .hasMessageContaining("anti-SSRF");

        assertThatThrownBy(() -> WebIntelExtractorService.parseAndValidatePublicUri("http://localhost:8080/actuator/health"))
                .isInstanceOf(InvalidDocumentException.class)
                .hasMessageContaining("anti-SSRF");
    }

    @Test
    void pinsResolvedIpAndNeverPerformsSecondDnsLookupAgainstRebindingAttack() throws Exception {
        AtomicReference<String> observedHostHeader = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/intel-report", exchange -> {
            observedHostHeader.set(exchange.getRequestHeaders().getFirst("Host"));
            byte[] html = """
                    <html><head><title>Advisory CVE-2025-43300</title></head>
                    <body>C2 node 185.220.101.45 contacted evil-c2.example and referenced CVE-2025-43300.</body>
                    </html>
                    """.getBytes(StandardCharsets.UTF_8);
            // Content-Length = 0 forces Sun HttpServer to use Transfer-Encoding: chunked
            exchange.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
            exchange.sendResponseHeaders(200, 0);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(html);
            }
        });
        server.start();

        try {
            int port = server.getAddress().getPort();
            PublicSchemaSupport publicSchemaSupport = mock(PublicSchemaSupport.class);
            when(publicSchemaSupport.matchKnownIocs(anyList(), anyInt())).thenReturn(List.of());
            AuditLogService auditLogService = mock(AuditLogService.class);

            AtomicInteger dnsCalls = new AtomicInteger(0);
            InetAddress localPinnedIp = InetAddress.getLoopbackAddress();
            WebIntelExtractorService.DnsResolver adversarialResolver = host -> {
                int call = dnsCalls.incrementAndGet();
                if (call == 1) {
                    return new InetAddress[] { localPinnedIp };
                }
                // Si el cliente HTTP intentara resolver DNS una segunda vez, devolvería una IP externa/inválida o fallaría
                throw new AssertionError("Second DNS lookup attempted for host: " + host);
            };

            // Solo permitimos loopback en esta política de test inyectada para ejercer el transporte HTTP real en RAM
            WebIntelExtractorService service = new WebIntelExtractorService(
                    publicSchemaSupport,
                    auditLogService,
                    adversarialResolver,
                    addr -> addr.equals(localPinnedIp),
                    (SSLSocketFactory) SSLSocketFactory.getDefault()
            );

            OmegaPrincipal principal = new OmegaPrincipal(
                    UUID.randomUUID(),
                    UUID.randomUUID(),
                    "analyst@omega.org",
                    Role.ANALYST,
                    true
            );

            WebIntelExtractorService.WebIntelScanResponse response = service.scanUrlEphemerally(
                    principal,
                    "http://rebind-attacker.example:" + port + "/intel-report",
                    List.of("185.220.101.45")
            );

            assertThat(dnsCalls.get()).isEqualTo(1);
            assertThat(observedHostHeader.get()).isEqualTo("rebind-attacker.example:" + port);
            assertThat(response.title()).isEqualTo("Advisory CVE-2025-43300");
            assertThat(response.ipv4Iocs()).contains("185.220.101.45");
            assertThat(response.cves()).contains("CVE-2025-43300");
            assertThat(response.matchedLiveNet4()).containsExactly("185.220.101.45");
            assertThat(response.persistedToDb()).isFalse();
            verify(auditLogService).record(eq(principal.tenantId()), eq(principal.userId()), eq("CTI_WEBLOADER_SCANNED"), eq("PUBLIC_WEB_INTEL"), eq("rebind-attacker.example"), any());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void blocksRedirectToPrivateOrMetadataAddressAtHopValidation() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/start", exchange -> {
            exchange.getResponseHeaders().set("Location", "http://169.254.169.254/latest/meta-data");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.start();

        try {
            int port = server.getAddress().getPort();
            PublicSchemaSupport publicSchemaSupport = mock(PublicSchemaSupport.class);
            AuditLogService auditLogService = mock(AuditLogService.class);
            InetAddress localPinnedIp = InetAddress.getLoopbackAddress();

            WebIntelExtractorService service = new WebIntelExtractorService(
                    publicSchemaSupport,
                    auditLogService,
                    host -> host.equals("safe-hop.example")
                            ? new InetAddress[] { localPinnedIp }
                            : InetAddress.getAllByName(host),
                    addr -> addr.equals(localPinnedIp) || WebIntelExtractorService.isPublicRoutableAddress(addr),
                    (SSLSocketFactory) SSLSocketFactory.getDefault()
            );

            OmegaPrincipal principal = new OmegaPrincipal(
                    UUID.randomUUID(),
                    UUID.randomUUID(),
                    "analyst@omega.org",
                    Role.ANALYST,
                    true
            );

            assertThatThrownBy(() -> service.scanUrlEphemerally(
                    principal,
                    "http://safe-hop.example:" + port + "/start",
                    List.of()
            ))
                    .isInstanceOf(InvalidDocumentException.class)
                    .hasMessageContaining("anti-SSRF");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void configuresHttpsEndpointIdentificationAndSniHostNameForDomainTargets() {
        SSLSocket sslSocket = mock(SSLSocket.class);
        SSLParameters initialParams = new SSLParameters();
        when(sslSocket.getSSLParameters()).thenReturn(initialParams);

        WebIntelExtractorService.configureTlsParameters(sslSocket, "threat-intel.example");

        ArgumentCaptor<SSLParameters> captor = ArgumentCaptor.forClass(SSLParameters.class);
        verify(sslSocket).setSSLParameters(captor.capture());
        SSLParameters applied = captor.getValue();
        assertThat(applied.getEndpointIdentificationAlgorithm()).isEqualTo("HTTPS");
        assertThat(applied.getServerNames()).containsExactly(new SNIHostName("threat-intel.example"));
    }
}
