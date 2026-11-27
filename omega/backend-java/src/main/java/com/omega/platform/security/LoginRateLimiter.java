package com.omega.platform.security;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Limitador de tasa para autenticación y flujos sensibles (/login, /password-reset/*, /mfa/*).
 * Cuando existe JdbcTemplate (despliegue real y pruebas de integración), persiste ventanas de forma atómica
 * en PostgreSQL (`omega_rag.auth_rate_limits`) con `pg_advisory_xact_lock`, seguro en multi-instancia (A-02).
 * Mantiene respaldo en memoria únicamente para pruebas unitarias sin base de datos.
 */
@Component
public class LoginRateLimiter {

    public static final int DEFAULT_MAX_ATTEMPTS_PER_ACCOUNT = 5;
    public static final int DEFAULT_MAX_ATTEMPTS_PER_IP = 25;
    public static final Duration DEFAULT_WINDOW = Duration.ofMinutes(15);
    private static final int MAX_TRACKED_KEYS = 10_000;

    private final Clock clock;
    private final int maxAttemptsPerAccount;
    private final int maxAttemptsPerIp;
    private final Duration window;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate requiresNewTx;

    private final ConcurrentHashMap<String, AttemptWindow> accountWindows = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AttemptWindow> ipWindows = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AttemptWindow> scopedWindows = new ConcurrentHashMap<>();

    public LoginRateLimiter() {
        this(Clock.systemUTC(), DEFAULT_MAX_ATTEMPTS_PER_ACCOUNT, DEFAULT_MAX_ATTEMPTS_PER_IP, DEFAULT_WINDOW, null, null);
    }

    @Autowired
    public LoginRateLimiter(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager
    ) {
        this(Clock.systemUTC(), DEFAULT_MAX_ATTEMPTS_PER_ACCOUNT, DEFAULT_MAX_ATTEMPTS_PER_IP, DEFAULT_WINDOW,
                java.util.Objects.requireNonNull(jdbc, "JdbcTemplate requerido en LoginRateLimiter"),
                java.util.Objects.requireNonNull(transactionManager, "PlatformTransactionManager requerido en LoginRateLimiter"));
    }

    public boolean isPersistentBacked() {
        return jdbc != null && requiresNewTx != null;
    }

    public LoginRateLimiter(Clock clock, int maxAttemptsPerAccount, int maxAttemptsPerIp, Duration window) {
        this(clock, maxAttemptsPerAccount, maxAttemptsPerIp, window, null, null);
    }

    public LoginRateLimiter(
            Clock clock,
            int maxAttemptsPerAccount,
            int maxAttemptsPerIp,
            Duration window,
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager
    ) {
        this.clock = clock;
        this.maxAttemptsPerAccount = Math.max(1, maxAttemptsPerAccount);
        this.maxAttemptsPerIp = Math.max(this.maxAttemptsPerAccount, maxAttemptsPerIp);
        this.window = window != null && !window.isNegative() && !window.isZero() ? window : DEFAULT_WINDOW;
        this.jdbc = jdbc;
        if (transactionManager != null) {
            TransactionTemplate tt = new TransactionTemplate(transactionManager);
            tt.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            this.requiresNewTx = tt;
        } else {
            this.requiresNewTx = null;
        }
    }

    public void assertAllowed(String clientIp, String email) {
        Instant now = clock.instant();
        String normIp = normalizeIp(clientIp);
        String accountKey = buildAccountKey(normIp, email);

        long accountRetry = checkBucketRetryAfter("acct:" + accountKey, accountWindows, accountKey, now, maxAttemptsPerAccount);
        long ipRetry = checkBucketRetryAfter("ip:" + normIp, ipWindows, normIp, now, maxAttemptsPerIp);
        long retryAfter = Math.max(accountRetry, ipRetry);

        if (retryAfter > 0L) {
            throw new TooManyLoginAttemptsException(
                    "Demasiados intentos de inicio de sesión fallidos. Espera "
                            + formatWaitTime(retryAfter)
                            + " antes de volver a intentarlo.",
                    retryAfter
            );
        }
    }

    public FailureStatus recordFailure(String clientIp, String email) {
        Instant now = clock.instant();
        String normIp = normalizeIp(clientIp);
        String accountKey = buildAccountKey(normIp, email);

        int accountFailures = incrementBucket("acct:" + accountKey, accountWindows, accountKey, now, maxAttemptsPerAccount);
        int ipFailures = incrementBucket("ip:" + normIp, ipWindows, normIp, now, maxAttemptsPerIp);
        boolean locked = accountFailures >= maxAttemptsPerAccount || ipFailures >= maxAttemptsPerIp;
        return new FailureStatus(accountFailures, ipFailures, locked);
    }

    public void reset(String clientIp, String email) {
        String normIp = normalizeIp(clientIp);
        String accountKey = buildAccountKey(normIp, email);
        resetBucket("acct:" + accountKey, accountWindows, accountKey);
    }

    /**
     * Límite independiente de IP (por correo/cuenta o por challengeToken) para B-01 y B-02.
     */
    public void assertScopedAllowed(String scope, String subjectKey, int limit) {
        Instant now = clock.instant();
        String normalized = normalizeScopedKey(scope, subjectKey);
        long retryAfter = checkBucketRetryAfter("scope:" + normalized, scopedWindows, normalized, now, Math.max(1, limit));
        if (retryAfter > 0L) {
            throw new TooManyLoginAttemptsException(
                    "Demasiados intentos para esta operación. Espera "
                            + formatWaitTime(retryAfter)
                            + " antes de volver a intentarlo.",
                    retryAfter
            );
        }
    }

    public int recordScopedFailure(String scope, String subjectKey, int limit) {
        Instant now = clock.instant();
        String normalized = normalizeScopedKey(scope, subjectKey);
        return incrementBucket("scope:" + normalized, scopedWindows, normalized, now, Math.max(1, limit));
    }

    public void resetScoped(String scope, String subjectKey) {
        String normalized = normalizeScopedKey(scope, subjectKey);
        resetBucket("scope:" + normalized, scopedWindows, normalized);
    }

    private long checkBucketRetryAfter(
            String dbKey,
            ConcurrentHashMap<String, AttemptWindow> fallbackMap,
            String memKey,
            Instant now,
            int limit
    ) {
        if (jdbc != null && requiresNewTx != null) {
            Long retry = requiresNewTx.execute(status -> {
                List<Map<String, Object>> rows = jdbc.queryForList(
                        "SELECT attempt_count, window_expires_at FROM omega_rag.auth_rate_limits WHERE bucket_key = ?",
                        truncateKey(dbKey)
                );
                if (rows.isEmpty()) {
                    return 0L;
                }
                Map<String, Object> row = rows.get(0);
                int count = ((Number) row.get("attempt_count")).intValue();
                Instant expiresAt = ((Timestamp) row.get("window_expires_at")).toInstant();
                if (!expiresAt.isAfter(now)) {
                    jdbc.update("DELETE FROM omega_rag.auth_rate_limits WHERE bucket_key = ? AND window_expires_at <= ?",
                            truncateKey(dbKey), Timestamp.from(now));
                    return 0L;
                }
                if (count < limit) {
                    return 0L;
                }
                long remainingMillis = Duration.between(now, expiresAt).toMillis();
                long seconds = (remainingMillis + 999L) / 1000L;
                return Math.min(window.toSeconds(), Math.max(1L, seconds));
            });
            return retry != null ? retry : 0L;
        }
        return checkRetryAfter(fallbackMap, memKey, now, limit);
    }

    private int incrementBucket(
            String dbKey,
            ConcurrentHashMap<String, AttemptWindow> fallbackMap,
            String memKey,
            Instant now,
            int limit
    ) {
        if (jdbc != null && requiresNewTx != null) {
            String key = truncateKey(dbKey);
            Timestamp nowTs = Timestamp.from(now);
            Timestamp expTs = Timestamp.from(now.plus(window));
            Integer count = requiresNewTx.execute(status -> {
                jdbc.execute("SELECT pg_advisory_xact_lock(hashtextextended('" + key.replace("'", "''") + "', 0))");
                return jdbc.queryForObject(
                        """
                        INSERT INTO omega_rag.auth_rate_limits (bucket_key, attempt_count, window_expires_at, updated_at)
                        VALUES (?, 1, ?, ?)
                        ON CONFLICT (bucket_key) DO UPDATE
                        SET attempt_count = CASE
                                WHEN omega_rag.auth_rate_limits.window_expires_at <= EXCLUDED.updated_at THEN 1
                                ELSE omega_rag.auth_rate_limits.attempt_count + 1
                            END,
                            window_expires_at = CASE
                                WHEN omega_rag.auth_rate_limits.window_expires_at <= EXCLUDED.updated_at THEN EXCLUDED.window_expires_at
                                ELSE omega_rag.auth_rate_limits.window_expires_at
                            END,
                            updated_at = EXCLUDED.updated_at
                        RETURNING attempt_count
                        """,
                        Integer.class,
                        key,
                        expTs,
                        nowTs
                );
            });
            return count != null ? count : 1;
        }
        return increment(fallbackMap, memKey, now, limit);
    }

    private void resetBucket(String dbKey, ConcurrentHashMap<String, AttemptWindow> fallbackMap, String memKey) {
        if (jdbc != null && requiresNewTx != null) {
            requiresNewTx.executeWithoutResult(status ->
                    jdbc.update("DELETE FROM omega_rag.auth_rate_limits WHERE bucket_key = ?", truncateKey(dbKey)));
            return;
        }
        fallbackMap.remove(memKey);
    }

    private long checkRetryAfter(
            ConcurrentHashMap<String, AttemptWindow> map,
            String key,
            Instant now,
            int limit
    ) {
        AttemptWindow attemptWindow = map.get(key);
        if (attemptWindow == null) {
            return 0L;
        }
        long retryAfter = attemptWindow.retryAfterIfBlocked(now, window, limit);
        if (attemptWindow.isEmpty()) {
            map.remove(key, attemptWindow);
        }
        return retryAfter;
    }

    private int increment(
            ConcurrentHashMap<String, AttemptWindow> map,
            String key,
            Instant now,
            int limit
    ) {
        if (!map.containsKey(key) && map.size() >= MAX_TRACKED_KEYS) {
            evictExpiredOnlyThenUnlocked(map, now, limit);
        }
        AttemptWindow attemptWindow = map.computeIfAbsent(key, ignored -> new AttemptWindow());
        return attemptWindow.recordFailure(now, window, limit);
    }

    private void evictExpiredOnlyThenUnlocked(ConcurrentHashMap<String, AttemptWindow> map, Instant now, int limit) {
        map.entrySet().removeIf(entry -> entry.getValue().isExpired(now, window));
        if (map.size() < MAX_TRACKED_KEYS) {
            return;
        }
        // Priorizar conservación de cuentas activamente bloqueadas (A-02)
        Iterator<Map.Entry<String, AttemptWindow>> it = map.entrySet().iterator();
        int toRemove = (map.size() - MAX_TRACKED_KEYS) + 1;
        while (it.hasNext() && toRemove > 0) {
            Map.Entry<String, AttemptWindow> entry = it.next();
            if (entry.getValue().retryAfterIfBlocked(now, window, limit) == 0L) {
                it.remove();
                toRemove--;
            }
        }
    }

    private static String normalizeIp(String clientIp) {
        if (clientIp == null || clientIp.isBlank()) {
            return "unknown";
        }
        return clientIp.trim();
    }

    private static String buildAccountKey(String normIp, String email) {
        String normEmail = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        return normIp + "|" + normEmail;
    }

    private static String normalizeScopedKey(String scope, String subject) {
        String s = scope == null ? "default" : scope.trim().toLowerCase(Locale.ROOT);
        String k = subject == null ? "" : subject.trim().toLowerCase(Locale.ROOT);
        return s + "|" + k;
    }

    private static String truncateKey(String raw) {
        return raw.length() <= 255 ? raw : raw.substring(0, 255);
    }

    private static String formatWaitTime(long retryAfterSeconds) {
        if (retryAfterSeconds < 60L) {
            return retryAfterSeconds + (retryAfterSeconds == 1L ? " segundo" : " segundos");
        }
        long minutes = (retryAfterSeconds + 59L) / 60L;
        return minutes + (minutes == 1L ? " minuto" : " minutos");
    }

    public record FailureStatus(int accountFailures, int ipFailures, boolean locked) {
    }

    private static final class AttemptWindow {

        private final Deque<Instant> timestamps = new ArrayDeque<>();

        synchronized long retryAfterIfBlocked(Instant now, Duration window, int limit) {
            prune(now, window);
            if (timestamps.size() < limit) {
                return 0L;
            }
            Instant oldest = timestamps.peekFirst();
            if (oldest == null) {
                return 0L;
            }
            long remainingMillis = Duration.between(now, oldest.plus(window)).toMillis();
            if (remainingMillis <= 0L) {
                return 0L;
            }
            long seconds = (remainingMillis + 999L) / 1000L;
            return Math.min(window.toSeconds(), Math.max(1L, seconds));
        }

        synchronized int recordFailure(Instant now, Duration window, int limit) {
            prune(now, window);
            timestamps.addLast(now);
            int maxStored = Math.max(limit * 2, limit);
            while (timestamps.size() > maxStored) {
                timestamps.pollFirst();
            }
            return timestamps.size();
        }

        synchronized boolean isEmpty() {
            return timestamps.isEmpty();
        }

        synchronized boolean isExpired(Instant now, Duration window) {
            prune(now, window);
            return timestamps.isEmpty();
        }

        private void prune(Instant now, Duration window) {
            Instant cutoff = now.minus(window);
            while (!timestamps.isEmpty() && !timestamps.peekFirst().isAfter(cutoff)) {
                timestamps.pollFirst();
            }
        }
    }
}
