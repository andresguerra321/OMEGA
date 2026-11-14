package com.omega.platform.config;

import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Cliente HTTP tipado para comunicarse únicamente con el worker forense interno en Docker (`omega/api`).
 */
@Configuration
public class RestClientConfig {

    @Bean
    public RestClient forensicWorkerRestClient(OmegaProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(properties.forensicWorker().connectTimeoutMs()));
        factory.setReadTimeout(Duration.ofMillis(properties.forensicWorker().readTimeoutMs()));

        return RestClient.builder()
                .baseUrl(properties.forensicWorker().baseUrl())
                .requestFactory(factory)
                .build();
    }
}
