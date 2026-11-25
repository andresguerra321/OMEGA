package com.omega.platform.web;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class GlobalExceptionHandlerTest {
    @RestController
    static class ProviderController {
        RestClientException failure;
        @GetMapping("/provider-test") public void request() { throw failure; }
    }

    @Test void providerFailuresDoNotBecomeSessionExpiryOrExposeProviderResponse() throws Exception {
        var controller = new ProviderController();
        var mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        for (RestClientException failure : new RestClientException[]{
                new ResourceAccessException("private network details"),
                HttpClientErrorException.create(HttpStatus.BAD_REQUEST, "Bad Request", HttpHeaders.EMPTY,
                        "private provider data".getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8),
                HttpClientErrorException.create(HttpStatus.UNAUTHORIZED, "Unauthorized", HttpHeaders.EMPTY,
                        "private provider credentials".getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8)}) {
            controller.failure = failure;
            mvc.perform(get("/provider-test")).andExpect(status().isBadGateway())
                    .andExpect(jsonPath("$.title").value("Servicio externo no disponible"))
                    .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("private"))));
        }
    }
}
