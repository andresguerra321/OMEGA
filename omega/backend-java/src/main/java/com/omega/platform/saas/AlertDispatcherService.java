package com.omega.platform.saas;

import java.net.InetAddress;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Despachador de alertas críticas fuera de banda (Webhook HTTPS, Telegram Bot API y Email)
 * cuando el usuario no tiene la aplicación abierta.
 */
@Service
public class AlertDispatcherService {

    private static final Logger log = LoggerFactory.getLogger(AlertDispatcherService.class);

    public record DispatchResult(String channel, boolean delivered, String detail) {}

    private final AlertDispatchRepository alertDispatchRepository;
    private final RestClient restClient;
    private final String defaultWebhookUrl;
    private final String telegramBotToken;
    private final String telegramChatId;
    private final String alertEmailRecipient;

    @Autowired
    public AlertDispatcherService(
            AlertDispatchRepository alertDispatchRepository,
            RestClient.Builder restClientBuilder,
            @Value("${OMEGA_ALERT_WEBHOOK_URL:}") String defaultWebhookUrl,
            @Value("${OMEGA_ALERT_TELEGRAM_BOT_TOKEN:}") String telegramBotToken,
            @Value("${OMEGA_ALERT_TELEGRAM_CHAT_ID:}") String telegramChatId,
            @Value("${OMEGA_ALERT_EMAIL_TO:}") String alertEmailRecipient) {
        this.alertDispatchRepository = alertDispatchRepository;
        this.restClient = restClientBuilder.build();
        this.defaultWebhookUrl = defaultWebhookUrl == null ? "" : defaultWebhookUrl.trim();
        this.telegramBotToken = telegramBotToken == null ? "" : telegramBotToken.trim();
        this.telegramChatId = telegramChatId == null ? "" : telegramChatId.trim();
        this.alertEmailRecipient = alertEmailRecipient == null ? "" : alertEmailRecipient.trim();
    }

    public List<DispatchResult> dispatchCriticalAlert(
            UUID tenantId,
            UUID userId,
            String severity,
            String title,
            String message,
            String overrideWebhookUrl) {
        String sev = (severity == null || severity.isBlank()) ? "CRITICAL" : severity.trim().toUpperCase(Locale.ROOT);
        String cleanTitle = (title == null || title.isBlank()) ? "Alerta de seguridad OMEGA" : title.trim();
        String cleanMsg = message == null ? "" : message.trim();

        List<DispatchResult> results = new ArrayList<>();

        String webhookTarget = (overrideWebhookUrl != null && !overrideWebhookUrl.isBlank())
                ? overrideWebhookUrl.trim()
                : defaultWebhookUrl;
        if (!webhookTarget.isBlank()) {
            DispatchResult r = sendWebhook(webhookTarget, sev, cleanTitle, cleanMsg);
            recordDispatch(tenantId, userId, "WEBHOOK", sev, cleanTitle, r);
            results.add(r);
        }

        if (!telegramBotToken.isBlank() && !telegramChatId.isBlank()) {
            DispatchResult r = sendTelegram(sev, cleanTitle, cleanMsg);
            recordDispatch(tenantId, userId, "TELEGRAM", sev, cleanTitle, r);
            results.add(r);
        }

        if (!alertEmailRecipient.isBlank()) {
            DispatchResult r = new DispatchResult(
                    "EMAIL",
                    false,
                    "Canal SMTP pendiente de configurar; alerta registrada para " + alertEmailRecipient);
            recordDispatch(tenantId, userId, "EMAIL", sev, cleanTitle, r);
            results.add(r);
        }

        if (results.isEmpty()) {
            DispatchResult r = new DispatchResult(
                    "WEBHOOK",
                    false,
                    "Sin canales externos configurados (define OMEGA_ALERT_WEBHOOK_URL o OMEGA_ALERT_TELEGRAM_BOT_TOKEN/CHAT_ID).");
            recordDispatch(tenantId, userId, "WEBHOOK", sev, cleanTitle, r);
            results.add(r);
        }

        return results;
    }

    public static boolean isSafeExternalHttpsWebhook(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return false;
        }
        try {
            URI uri = URI.create(rawUrl.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                return false;
            }
            String host = uri.getHost();
            if (host == null || host.isBlank()) {
                return false;
            }
            String low = host.toLowerCase(Locale.ROOT);
            if ("localhost".equals(low) || low.endsWith(".local") || low.endsWith(".internal")) {
                return false;
            }
            for (InetAddress addr : InetAddress.getAllByName(host)) {
                if (addr.isAnyLocalAddress()
                        || addr.isLoopbackAddress()
                        || addr.isLinkLocalAddress()
                        || addr.isSiteLocalAddress()
                        || addr.isMulticastAddress()) {
                    return false;
                }
            }
            return true;
        } catch (Exception ex) {
            return false;
        }
    }

    private DispatchResult sendWebhook(String webhookUrl, String severity, String title, String message) {
        if (!isSafeExternalHttpsWebhook(webhookUrl)) {
            return new DispatchResult("WEBHOOK", false, "Webhook rechazado: requiere HTTPS hacia un host público válido.");
        }
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("source", "OMEGA-Security");
            payload.put("severity", severity);
            payload.put("title", title);
            payload.put("message", message);
            payload.put("timestamp", OffsetDateTime.now(ZoneOffset.UTC).toString());

            restClient.post()
                    .uri(webhookUrl)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .toBodilessEntity();
            return new DispatchResult("WEBHOOK", true, "Entregado vía Webhook HTTPS.");
        } catch (Exception ex) {
            log.warn("Fallo despachando alerta Webhook: {}", ex.getMessage());
            return new DispatchResult("WEBHOOK", false, "Error entregando Webhook: " + ex.getClass().getSimpleName());
        }
    }

    private DispatchResult sendTelegram(String severity, String title, String message) {
        try {
            String url = "https://api.telegram.org/bot" + telegramBotToken + "/sendMessage";
            String text = "[OMEGA " + severity + "] " + title + "\n" + message;
            restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("chat_id", telegramChatId, "text", text))
                    .retrieve()
                    .toBodilessEntity();
            return new DispatchResult("TELEGRAM", true, "Entregado vía Telegram Bot API.");
        } catch (Exception ex) {
            log.warn("Fallo despachando alerta Telegram: {}", ex.getMessage());
            return new DispatchResult("TELEGRAM", false, "Error entregando Telegram: " + ex.getClass().getSimpleName());
        }
    }

    private void recordDispatch(
            UUID tenantId,
            UUID userId,
            String channel,
            String severity,
            String title,
            DispatchResult result) {
        AlertDispatchEntity entity = new AlertDispatchEntity();
        entity.setId(UUID.randomUUID());
        entity.setTenantId(tenantId);
        entity.setUserId(userId);
        entity.setChannel(channel);
        entity.setSeverity(severity);
        entity.setTitle(title.length() > 255 ? title.substring(0, 255) : title);
        entity.setDelivered(result.delivered());
        String detail = result.detail();
        entity.setStatusDetail(detail != null && detail.length() > 300 ? detail.substring(0, 300) : detail);
        entity.setCreatedAt(OffsetDateTime.now(ZoneOffset.UTC));
        alertDispatchRepository.save(entity);
    }
}
