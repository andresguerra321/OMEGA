package com.omega.platform.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class SystemAiConnectionTest {
    @Test void configuredModelMustGenerateTextInsteadOfOnlyListingModels() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var emptyResponse = new AtomicBoolean(false);
        var completions = new AtomicInteger();
        var modelLists = new AtomicInteger();
        server.createContext("/v1/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            if (exchange.getRequestURI().getPath().endsWith("/models")) modelLists.incrementAndGet();
            else completions.incrementAndGet();
            byte[] body = (emptyResponse.get() ? "{\"choices\":[]}" : "{\"choices\":[{\"message\":{\"content\":\"OK\"}}]}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        try {
            var props = mock(OmegaProperties.class, RETURNS_DEEP_STUBS);
            var controller = new SystemController(null, null, null, props);
            var principal = new OmegaPrincipal(UUID.randomUUID(), UUID.randomUUID(), "fixture@example.org", Role.ADMIN, true);
            var request = new SystemController.AiConnectionTestRequest("groq", "http://127.0.0.1:" + server.getAddress().getPort() + "/v1", "fixture-key", "fixture-model");
            assertThat(controller.testAiConnection(principal, request).ok()).isTrue();
            emptyResponse.set(true);
            assertThat(controller.testAiConnection(principal, request).ok()).isFalse();
            assertThat(completions).hasValue(2);
            assertThat(modelLists).hasValue(0);
        } finally { server.stop(0); }
    }
}
