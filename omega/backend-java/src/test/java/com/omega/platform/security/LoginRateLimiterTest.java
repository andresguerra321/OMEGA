package com.omega.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class LoginRateLimiterTest {

    @Test
    void blocksOnSixthAttemptWithinFifteenMinutesAndUnlocksAfterWindowOrSuccessReset() {
        MutableClock clock = new MutableClock(Instant.parse("2026-11-15T00:00:00Z"));
        LoginRateLimiter limiter = new LoginRateLimiter(clock, 5, 25, Duration.ofMinutes(15));

        for (int i = 0; i < 5; i++) {
            limiter.assertAllowed("198.51.100.10", "analista@omega.org");
            LoginRateLimiter.FailureStatus status = limiter.recordFailure("198.51.100.10", "analista@omega.org");
            assertThat(status.accountFailures()).isEqualTo(i + 1);
            assertThat(status.locked()).isEqualTo(i == 4);
            clock.advance(Duration.ofSeconds(1));
        }

        assertThatThrownBy(() -> limiter.assertAllowed("198.51.100.10", "Analista@Omega.ORG "))
                .isInstanceOf(TooManyLoginAttemptsException.class)
                .satisfies(ex -> {
                    TooManyLoginAttemptsException rateEx = (TooManyLoginAttemptsException) ex;
                    assertThat(rateEx.getRetryAfterSeconds()).isBetween(890L, 900L);
                });

        // Otra cuenta desde la misma IP aún puede intentar (no bloqueada hasta umbral IP spray)
        assertThatCode(() -> limiter.assertAllowed("198.51.100.10", "otra@omega.org"))
                .doesNotThrowAnyException();

        // Al avanzar más allá de 15 minutos desde el primer fallo, el bloqueo se levanta
        clock.advance(Duration.ofMinutes(15));
        assertThatCode(() -> limiter.assertAllowed("198.51.100.10", "analista@omega.org"))
                .doesNotThrowAnyException();

        // El éxito limpia la ventana de fallos por cuenta
        limiter.recordFailure("198.51.100.10", "analista@omega.org");
        limiter.reset("198.51.100.10", "analista@omega.org");
        for (int i = 0; i < 5; i++) {
            limiter.assertAllowed("198.51.100.10", "analista@omega.org");
            limiter.recordFailure("198.51.100.10", "analista@omega.org");
        }
        assertThatThrownBy(() -> limiter.assertAllowed("198.51.100.10", "analista@omega.org"))
                .isInstanceOf(TooManyLoginAttemptsException.class);
    }

    @Test
    void blocksPasswordSprayingAcrossDistinctEmailsFromSameIp() {
        MutableClock clock = new MutableClock(Instant.parse("2026-11-15T00:00:00Z"));
        LoginRateLimiter limiter = new LoginRateLimiter(clock, 5, 8, Duration.ofMinutes(15));

        for (int i = 0; i < 8; i++) {
            String email = "victim" + i + "@omega.org";
            limiter.assertAllowed("198.51.100.99", email);
            limiter.recordFailure("198.51.100.99", email);
        }

        assertThatThrownBy(() -> limiter.assertAllowed("198.51.100.99", "fresh@omega.org"))
                .isInstanceOf(TooManyLoginAttemptsException.class);

        // Un login exitoso en cuenta propia no resetea el límite global de password spraying de la IP
        limiter.reset("198.51.100.99", "victim0@omega.org");
        assertThatThrownBy(() -> limiter.assertAllowed("198.51.100.99", "fresh2@omega.org"))
                .isInstanceOf(TooManyLoginAttemptsException.class);
    }

    private static final class MutableClock extends Clock {

        private Instant current;

        MutableClock(Instant initial) {
            this.current = initial;
        }

        void advance(Duration delta) {
            current = current.plus(delta);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return current;
        }
    }
}
