package com.omega.platform.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.URI;
import java.net.UnixDomainSocketAddress;
import java.nio.channels.Channels;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequest;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpResponse;

/** Native gateway transport; existing tenant/RBAC/challenge checks remain in ForensicBridgeService. */
public final class LocalSensorRequestFactory implements ClientHttpRequestFactory {
    private final String endpoint;
    private final ObjectMapper json = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_FRAME = 2 * 1024 * 1024;

    public LocalSensorRequestFactory(String endpoint) {
        if (!(endpoint.startsWith("/") || endpoint.matches("\\\\\\\\\\.\\\\pipe\\\\omega-agent-[a-zA-Z0-9-]{1,80}"))) {
            throw new IllegalArgumentException("Endpoint nativo inválido");
        }
        this.endpoint = endpoint;
    }

    private JsonNode exchange(Map<String, ?> message) throws IOException {
        AtomicReference<AutoCloseable> active = new AtomicReference<>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var task = executor.submit(() -> {
                InputStream input;
                OutputStream output;
                if (endpoint.startsWith("/")) {
                    var channel = SocketChannel.open(UnixDomainSocketAddress.of(endpoint));
                    active.set(channel);
                    input = Channels.newInputStream(channel);
                    output = Channels.newOutputStream(channel);
                } else {
                    var pipe = new RandomAccessFile(endpoint, "rw");
                    active.set(pipe);
                    input = Channels.newInputStream(pipe.getChannel());
                    output = Channels.newOutputStream(pipe.getChannel());
                }
                try (var transport = active.get()) {
                    byte[] payload = json.writeValueAsBytes(message);
                    if (payload.length > MAX_FRAME - 1) throw new IOException("Solicitud nativa demasiado grande");
                    output.write(payload);
                    output.write('\n');
                    output.flush();
                    var buffer = new ByteArrayOutputStream();
                    int next;
                    while ((next = input.read()) != -1 && next != '\n') {
                        if (buffer.size() >= MAX_FRAME) throw new IOException("Respuesta nativa demasiado grande");
                        buffer.write(next);
                    }
                    if (next != '\n') throw new IOException("Respuesta nativa incompleta");
                    return json.readTree(buffer.toByteArray());
                }
            });
            try { return task.get(120, TimeUnit.SECONDS); }
            catch (Exception ex) {
                var transport = active.get();
                if (transport != null) try { transport.close(); } catch (Exception ignored) { }
                task.cancel(true);
                throw new IOException("Sensor nativo no disponible", ex);
            }
        }
    }

    @Override public ClientHttpRequest createRequest(URI uri, HttpMethod method) {
        return new ClientHttpRequest() {
            private final HttpHeaders requestHeaders = new HttpHeaders();
            private final ByteArrayOutputStream requestBody = new ByteArrayOutputStream();
            private boolean executed;
            public HttpMethod getMethod() { return method; }
            public URI getURI() { return uri; }
            public HttpHeaders getHeaders() { return requestHeaders; }
            public OutputStream getBody() { return requestBody; }
            public ClientHttpResponse execute() throws IOException {
                if (executed) throw new IOException("La solicitud nativa ya fue ejecutada");
                executed = true;
                return executeInternal(requestHeaders, requestBody.toByteArray());
            }
            protected ClientHttpResponse executeInternal(HttpHeaders headers, byte[] body) throws IOException {
                // ACL/0600 protects bootstrap. A fresh key is obtained after each service restart.
                String secret = exchange(Map.of("bootstrap", true)).path("secret").asText();
                if (!secret.matches("[0-9a-f]{64}")) throw new IOException("Bootstrap nativo inválido");
                byte[] key = HexFormat.of().parseHex(secret), random = new byte[16];
                RANDOM.nextBytes(random);
                String stamp = Long.toString(Instant.now().getEpochSecond()), nonce = HexFormat.of().formatHex(random);
                String target = uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
                var values = new java.util.HashMap<String, String>();
                headers.forEach((name, entries) -> values.put(name.toLowerCase(java.util.Locale.ROOT), String.join(",", entries)));
                values.put("x-omega-time", stamp);
                values.put("x-omega-nonce", nonce);
                values.put("x-omega-signature", SensorHmac.sign(key, "request", method.name(), target, stamp, nonce, body));
                JsonNode response = exchange(Map.of("method", method.name(), "target", target, "headers", values,
                        "body", Base64.getEncoder().encodeToString(body)));
                byte[] content = Base64.getDecoder().decode(response.path("body").asText());
                int status = response.path("status").asInt();
                String expected = SensorHmac.sign(key, "response", Integer.toString(status), target, stamp, nonce, content);
                String supplied = response.path("headers").path("x-omega-signature").asText();
                if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII), supplied.getBytes(StandardCharsets.US_ASCII))) {
                    throw new IOException("Firma nativa inválida");
                }
                HttpHeaders responseHeaders = new HttpHeaders();
                response.path("headers").fields().forEachRemaining(entry -> responseHeaders.set(entry.getKey(), entry.getValue().asText()));
                return SensorHmac.buffered(HttpStatusCode.valueOf(status), responseHeaders, content);
            }
        };
    }
}
