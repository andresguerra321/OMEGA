package com.omega.platform.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Limitador de tasa en memoria para /api/v1/auth/login que protege contra fuerza bruta
 * por cuenta (IP + correo, máximo 5 fallos en 15 min) y password spraying por IP (25 fallos en 15 min).
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
    private final ConcurrentHashMap<String, AttemptWindow> accountWindows = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AttemptWindow> ipWindows = new ConcurrentHashMap<>();

    @Autowired
    public LoginRateLimiter() {
        this(Clock.systemUTC(), DEFAULT_MAX_ATTEMPTS_PER_ACCOUNT, DEFAULT_MAX_ATTEMPTS_PER_IP, DEFAULT_WINDOW);
    }

    public LoginRateLimiter(Clock clock, int maxAttemptsPerAccount, int maxAttemptsPerIp, Duration window) {
        this.clock = clock;
        this.maxAttemptsPerAccount = Math.max(1, maxAttemptsPerAccount);
        this.maxAttemptsPerIp = Math.max(this.maxAttemptsPerAccount, maxAttemptsPerIp);
        this.window = window != null && !window.isNegative() && !window.isZero() ? window : DEFAULT_WINDOW;
    }

    public void assertAllowed(String clientIp, String email) {
        Instant now = clock.instant();
        String normIp = normalizeIp(clientIp);
        String accountKey = buildAccountKey(normIp, email);

        long accountRetry = checkRetryAfter(accountWindows, accountKey, now, maxAttemptsPerAccount);
        long ipRetry = checkRetryAfter(ipWindows, normIp, now, maxAttemptsPerIp);
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

        int accountFailures = increment(accountWindows, accountKey, now, maxAttemptsPerAccount);
        int ipFailures = increment(ipWindows, normIp, now, maxAttemptsPerIp);
        boolean locked = accountFailures >= maxAttemptsPerAccount || ipFailures >= maxAttemptsPerIp;
        return new FailureStatus(accountFailures, ipFailures, locked);
    }

    public void reset(String clientIp, String email) {
        String normIp = normalizeIp(clientIp);
        accountWindows.remove(buildAccountKey(normIp, email));
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
            evictExpiredOrOldest(map, now);
        }
        AttemptWindow attemptWindow = map.computeIfAbsent(key, ignored -> new AttemptWindow());
        return attemptWindow.recordFailure(now, window, limit);
    }

    private void evictExpiredOrOldest(ConcurrentHashMap<String, AttemptWindow> map, Instant now) {
        map.entrySet().removeIf(entry -> entry.getValue().isExpired(now, window));
        if (map.size() < MAX_TRACKED_KEYS) {
            return;
        }
        Iterator<String> keys = map.keySet().iterator();
        int toRemove = (map.size() - MAX_TRACKED_KEYS) + 1;
        while (keys.hasNext() && toRemove > 0) {
            keys.next();
            keys.remove();
            toRemove--;
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

