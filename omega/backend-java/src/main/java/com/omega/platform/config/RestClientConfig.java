package com.omega.platform.config;

import java.time.Duration;
import java.util.Arrays;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Clientes HTTP tipados para comunicarse con el worker forense interno en Docker
 * (`X-Internal-Service-Token`) y con el proveedor de embeddings/LLM configurado.
 */
@Configuration
public class RestClientConfig {

    public static final String INTERNAL_TOKEN_HEADER = "X-Internal-Service-Token";
    private static final String DEV_INTERNAL_TOKEN_MARKER = "omega-dev-internal-service-token";

    @Bean
    public RestClient forensicWorkerRestClient(OmegaProperties properties, Environment environment) {
        String internalToken = properties.security().internalServiceToken();
        boolean isProd = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(profile -> profile.equalsIgnoreCase("prod") || profile.equalsIgnoreCase("production"));
        if (isProd && (internalToken == null || internalToken.isBlank()
                || internalToken.contains(DEV_INTERNAL_TOKEN_MARKER)
                || internalToken.length() < 32)) {
            throw new IllegalStateException(
                    "INTERNAL_SERVICE_TOKEN de desarrollo o menor a 32 caracteres prohibido en perfil prod/production");
        }

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(properties.forensicWorker().connectTimeoutMs()));
        factory.setReadTimeout(Duration.ofMillis(properties.forensicWorker().readTimeoutMs()));

        return RestClient.builder()
                .baseUrl(properties.forensicWorker().baseUrl())
                .defaultHeader(INTERNAL_TOKEN_HEADER, internalToken)
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
