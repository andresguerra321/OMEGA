package com.omega.platform.config;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;

public final class SensorHmac {
    private static final SecureRandom RANDOM = new SecureRandom();
    private SensorHmac() { }

    public static String sign(byte[] key, String direction, String method, String target,
            String stamp, String nonce, byte[] body) {
        try {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
            byte[] message = String.join("\n", direction, method.toUpperCase(java.util.Locale.ROOT), target, stamp, nonce, hash)
                    .getBytes(StandardCharsets.UTF_8);
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(message));
        } catch (java.security.GeneralSecurityException ex) {
            throw new IllegalStateException("HMAC no disponible", ex);
        }
    }

    public static ClientHttpRequestInterceptor interceptor(String token) {
        final byte[] key;
        try { key = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)); }
        catch (java.security.GeneralSecurityException ex) { throw new IllegalStateException(ex); }
        return (request, body, execution) -> {
            byte[] random = new byte[16];
            RANDOM.nextBytes(random);
            String nonce = HexFormat.of().formatHex(random), stamp = Long.toString(Instant.now().getEpochSecond());
            String target = request.getURI().getRawPath() + (request.getURI().getRawQuery() == null ? "" : "?" + request.getURI().getRawQuery());
            request.getHeaders().set("X-Omega-Time", stamp);
            request.getHeaders().set("X-Omega-Nonce", nonce);
            request.getHeaders().set("X-Omega-Signature", sign(key, "request", request.getMethod().name(), target, stamp, nonce, body));
            ClientHttpResponse response = execution.execute(request, body);
            try (response) {
                byte[] content = response.getBody().readNBytes(128 * 1024 * 1024 + 1);
                if (content.length > 128 * 1024 * 1024) throw new IOException("Respuesta del sensor demasiado grande");
                String expected = sign(key, "response", Integer.toString(response.getStatusCode().value()), target, stamp, nonce, content);
                String supplied = response.getHeaders().getFirst("X-Omega-Signature");
                if (supplied == null || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII), supplied.getBytes(StandardCharsets.US_ASCII))) {
                    throw new IOException("Respuesta del sensor sin firma válida");
                }
                return buffered(response.getStatusCode(), response.getHeaders(), content);
            }
        };
    }

    static ClientHttpResponse buffered(HttpStatusCode status, HttpHeaders headers, byte[] content) {
        return new ClientHttpResponse() {
            public HttpStatusCode getStatusCode() { return status; }
            public String getStatusText() { return status.toString(); }
            public HttpHeaders getHeaders() { return headers; }
            public InputStream getBody() { return new ByteArrayInputStream(content); }
            public void close() { }
        };
    }
}
