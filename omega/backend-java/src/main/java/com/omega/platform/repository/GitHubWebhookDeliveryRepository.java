package com.omega.platform.repository;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
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

    /**
     * Registra delivery_id como RECEIVED de forma atómica.
     * Permite reintento solo si el intento previo quedó en FAILED; devuelve false si ya fue RECEIVED o PROCESSED.
     */
    public boolean tryRecordDelivery(String deliveryId, int ttlHours) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(Math.max(1, ttlHours), ChronoUnit.HOURS);

        jdbc.update(
                "DELETE FROM omega_rag.github_webhook_deliveries WHERE expires_at < :now",
                Map.of("now", java.sql.Timestamp.from(now))
        );

        int inserted = jdbc.update(
                """
                INSERT INTO omega_rag.github_webhook_deliveries (delivery_id, received_at, expires_at, status)
                VALUES (:deliveryId, :now, :expiresAt, 'RECEIVED')
                ON CONFLICT (delivery_id) DO UPDATE
                    SET status = 'RECEIVED',
                        received_at = EXCLUDED.received_at,
                        expires_at = EXCLUDED.expires_at
                    WHERE omega_rag.github_webhook_deliveries.status = 'FAILED'
                """,
                Map.of(
                        "deliveryId", deliveryId,
                        "now", java.sql.Timestamp.from(now),
                        "expiresAt", java.sql.Timestamp.from(expiresAt)
                )
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
                "UPDATE omega_rag.github_webhook_deliveries SET status = 'FAILED' WHERE delivery_id = :deliveryId",
                Map.of("deliveryId", deliveryId)
        );
    }
}
