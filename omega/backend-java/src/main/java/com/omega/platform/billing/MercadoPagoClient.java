package com.omega.platform.billing;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

@Component
public class MercadoPagoClient {
    private final RestClient http;
    public final String mode;
    public final String sellerId;
    public final String webhookSecret;
    public final String publicBaseUrl;
    public final String returnUrl;

    public MercadoPagoClient(@Value("${OMEGA_MP_MODE:disabled}") String mode,
            @Value("${OMEGA_MP_ACCESS_TOKEN:}") String token,
            @Value("${OMEGA_MP_SELLER_ID:}") String sellerId,
            @Value("${OMEGA_MP_WEBHOOK_SECRET:}") String secret,
            @Value("${OMEGA_PUBLIC_BASE_URL:}") String publicBaseUrl,
            @Value("${OMEGA_BILLING_RETURN_URL:}") String returnUrl) {
        if (!java.util.Set.of("disabled", "test", "live").contains(mode)) throw new IllegalStateException("OMEGA_MP_MODE debe ser disabled, test o live");
        this.mode = mode; this.sellerId = sellerId; this.webhookSecret = secret;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", ""); this.returnUrl = returnUrl;
        if (enabled()) {
            if (token.isBlank() || !sellerId.matches("[0-9]+") || secret.isBlank())
                throw new IllegalStateException("Configura token, vendedor y secreto de webhook de Mercado Pago");
            requireHttps(publicBaseUrl); requireHttps(returnUrl);
        }
        var factory = new JdkClientHttpRequestFactory(java.net.http.HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
        factory.setReadTimeout(Duration.ofSeconds(15));
        http = RestClient.builder().baseUrl("https://api.mercadopago.com")
                .requestFactory(factory).defaultHeader("Authorization", "Bearer " + token).build();
    }
    private static void requireHttps(String value) {
        URI uri = URI.create(value);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null)
            throw new IllegalStateException("Las URLs públicas de facturación deben usar HTTPS");
    }
    public boolean enabled() { return !"disabled".equals(mode); }
    public void validateSeller() {
        JsonNode user = get("/users/me");
        boolean testUser = false;
        for (JsonNode tag : user.path("tags")) if ("test_user".equals(tag.asText())) testUser = true;
        if (!sellerId.equals(user.path("id").asText()) || testUser != "test".equals(mode))
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "El vendedor no corresponde al entorno de pagos configurado.");
    }
    public void requireEnabled() {
        if (!enabled()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Los pagos todavía no están configurados. No se realizó ningún cobro.");
    }
    public JsonNode get(String path) { requireEnabled(); return http.get().uri(path).retrieve().body(JsonNode.class); }
    public JsonNode post(String path, Map<String,Object> body, UUID key) {
        requireEnabled(); return http.post().uri(path).header("X-Idempotency-Key", key.toString()).body(body).retrieve().body(JsonNode.class);
    }
    public void cancel(String id) {
        requireEnabled(); http.put().uri("/preapproval/{id}", id).body(Map.of("status", "cancelled")).retrieve().toBodilessEntity();
    }
    public void validatePayment(JsonNode payment) {
        if (!sellerId.equals(payment.path("collector_id").asText()) || !payment.has("live_mode")
                || ("live".equals(mode) && !payment.path("live_mode").asBoolean()))
            throw new IllegalStateException("El pago pertenece a otro vendedor o entorno");
        // Subscriptions between test accounts can report live_mode=true. Verify the seller's
        // test_user tag through Mercado Pago, rather than treating that flag as proof of real funds.
        validateSeller();
    }
}
