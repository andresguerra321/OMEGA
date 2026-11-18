package com.omega.platform.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class SensorHmacTest {
    @Test void bindsDirectionBodyAndNonce() {
        byte[] key = new byte[32];
        String first = SensorHmac.sign(key, "request", "POST", "/api/host/test", "1", "nonce", new byte[0]);
        assertThat(first).hasSize(64);
        assertThat(SensorHmac.sign(key, "response", "POST", "/api/host/test", "1", "nonce", new byte[0])).isNotEqualTo(first);
        assertThat(SensorHmac.sign(key, "request", "POST", "/api/host/test", "1", "other", new byte[0])).isNotEqualTo(first);
        assertThat(SensorHmac.sign(key, "request", "POST", "/api/host/test", "1", "nonce", "{}".getBytes(StandardCharsets.UTF_8))).isNotEqualTo(first);
    }

    @Test void nativeEndpointAcceptsOnlyLocalPipeOrUnixPath() {
        assertThatCode(() -> new LocalSensorRequestFactory("\\\\.\\pipe\\omega-agent-test")).doesNotThrowAnyException();
        assertThatCode(() -> new LocalSensorRequestFactory("/run/omega-agent/sensor.sock")).doesNotThrowAnyException();
        assertThatThrownBy(() -> new LocalSensorRequestFactory("\\\\remote\\pipe\\omega-agent-test")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new LocalSensorRequestFactory("http://localhost:8765")).isInstanceOf(IllegalArgumentException.class);
    }
}
