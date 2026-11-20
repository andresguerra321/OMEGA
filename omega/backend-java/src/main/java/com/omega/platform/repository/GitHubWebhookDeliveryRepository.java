package com.omega.platform.repository;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Registro atómico anti-replay para X-GitHub-Delivery mediante clave única y TTL.
 */
@Repository
public class GitHubWebhookDeliveryRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public GitHubWebhookDeliveryRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Inserta el delivery_id de forma atómica; devuelve false si ya existía (replay).
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
                INSERT INTO omega_rag.github_webhook_deliveries (delivery_id, received_at, expires_at)
                VALUES (:deliveryId, :now, :expiresAt)
                ON CONFLICT (delivery_id) DO NOTHING
                """,
                Map.of(
                        "deliveryId", deliveryId,
                        "now", java.sql.Timestamp.from(now),
                        "expiresAt", java.sql.Timestamp.from(expiresAt)
                )
        );
        return inserted == 1;
    }
}
