package com.omega.platform.config;

import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Clientes HTTP tipados para comunicarse con el worker forense interno en Docker
 * (`X-Internal-Service-Token`) y con el proveedor de embeddings/LLM configurado.
 */
@Configuration
public class RestClientConfig {

    public static final String INTERNAL_TOKEN_HEADER = "X-Internal-Service-Token";

    @Bean
    public RestClient forensicWorkerRestClient(OmegaProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(properties.forensicWorker().connectTimeoutMs()));
        factory.setReadTimeout(Duration.ofMillis(properties.forensicWorker().readTimeoutMs()));

        return RestClient.builder()
                .baseUrl(properties.forensicWorker().baseUrl())
                .defaultHeader(INTERNAL_TOKEN_HEADER, properties.security().internalServiceToken())
                .requestFactory(factory)
                .build();
    }

    @Bean
    public RestClient openAiRestClient(OmegaProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(10));
        factory.setReadTimeout(Duration.ofSeconds(60));

        return RestClient.builder()
                .baseUrl(properties.rag().openAiBaseUrl())
                .requestFactory(factory)
                .build();
    }
}
