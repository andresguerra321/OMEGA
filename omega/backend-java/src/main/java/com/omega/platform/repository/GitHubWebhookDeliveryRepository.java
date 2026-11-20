package com.omega.platform.repository;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Registro atómico anti-replay para X-GitHub-Delivery con estado RECEIVED/PROCESSED/FAILED.
 */
@Repository
public class GitHubWebhookDeliveryRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public GitHubWebhookDeliveryRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean tryRecordDelivery(String deliveryId, int ttlHours) {
        return tryRecordDelivery(deliveryId, ttlHours, "", null);
    }

    /**
     * Registra delivery_id como RECEIVED de forma atómica.
     * Permite reintento solo si el intento previo quedó en FAILED; devuelve false si ya fue RECEIVED o PROCESSED.
     */
    public boolean tryRecordDelivery(String deliveryId, int ttlHours, String eventType, byte[] rawPayload) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(Math.max(1, ttlHours), ChronoUnit.HOURS);
        String payloadJson = rawPayload != null ? new String(rawPayload, StandardCharsets.UTF_8) : null;

        jdbc.update(
                "DELETE FROM omega_rag.github_webhook_deliveries WHERE expires_at < :now",
                Map.of("now", java.sql.Timestamp.from(now))
        );

        int inserted = jdbc.update(
                """
                INSERT INTO omega_rag.github_webhook_deliveries
                    (delivery_id, received_at, expires_at, status, event_type, payload_json, retry_count)
                VALUES (:deliveryId, :now, :expiresAt, 'RECEIVED', :eventType, :payloadJson, 0)
                ON CONFLICT (delivery_id) DO UPDATE
                    SET status = 'RECEIVED',
                        received_at = EXCLUDED.received_at,
                        expires_at = EXCLUDED.expires_at,
                        event_type = COALESCE(EXCLUDED.event_type, omega_rag.github_webhook_deliveries.event_type),
                        payload_json = COALESCE(EXCLUDED.payload_json, omega_rag.github_webhook_deliveries.payload_json)
                    WHERE omega_rag.github_webhook_deliveries.status = 'FAILED'
                """,
                new java.util.HashMap<>() {{
                    put("deliveryId", deliveryId);
                    put("now", java.sql.Timestamp.from(now));
                    put("expiresAt", java.sql.Timestamp.from(expiresAt));
                    put("eventType", eventType);
                    put("payloadJson", payloadJson);
                }}
        );
        return inserted >= 1;
    }

    public void markProcessed(String deliveryId) {
        jdbc.update(
                "UPDATE omega_rag.github_webhook_deliveries SET status = 'PROCESSED' WHERE delivery_id = :deliveryId",
                Map.of("deliveryId", deliveryId)
        );
    }

    public void markFailed(String deliveryId) {
        jdbc.update(
                """
                UPDATE omega_rag.github_webhook_deliveries
                SET status = 'FAILED', retry_count = retry_count + 1
                WHERE delivery_id = :deliveryId
                """,
                Map.of("deliveryId", deliveryId)
        );
    }

    public List<FailedDeliveryRecord> findRetryableFailedDeliveries(int maxRetries, int limit) {
        return jdbc.query(
                """
                SELECT delivery_id, event_type, payload_json, retry_count
                FROM omega_rag.github_webhook_deliveries
                WHERE status = 'FAILED' AND retry_count < :maxRetries AND payload_json IS NOT NULL
                ORDER BY received_at ASC
                LIMIT :limit
                """,
                Map.of("maxRetries", maxRetries, "limit", limit),
                (rs, rowNum) -> new FailedDeliveryRecord(
                        rs.getString("delivery_id"),
                        rs.getString("event_type"),
                        rs.getString("payload_json"),
                        rs.getInt("retry_count")
                )
        );
    }

    public record FailedDeliveryRecord(String deliveryId, String eventType, String payloadJson, int retryCount) {
    }
}
