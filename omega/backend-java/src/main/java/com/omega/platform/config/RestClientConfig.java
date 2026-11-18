package com.omega.platform.config;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Arrays;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Clientes HTTP tipados para comunicarse con el worker forense interno en Docker
 * (`X-Internal-Service-Token`) y con el proveedor de embeddings/LLM configurado.
 */
@Configuration
public class RestClientConfig {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private SovereignModePolicy sovereignPolicy;

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

        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(properties.forensicWorker().connectTimeoutMs()))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(properties.forensicWorker().readTimeoutMs()));

        return RestClient.builder()
                .baseUrl(properties.forensicWorker().baseUrl())
                .defaultHeader(INTERNAL_TOKEN_HEADER, internalToken)
                .requestFactory(factory)
                .requestInterceptor((request, body, execution) -> {
                    if (sovereignPolicy != null) sovereignPolicy.checkWorkerRequest(request.getURI());
                    if (environment.getProperty("OMEGA_REQUIRE_HMAC", Boolean.class, false)) {
                        return SensorHmac.interceptor(internalToken).intercept(request, body, execution);
                    }
                    return execution.execute(request, body);
                })
                .build();
    }

    @Bean
    public RestClient hostWorkerRestClient(OmegaProperties properties, Environment environment) {
        String nativeEndpoint = environment.getProperty("OMEGA_HOST_SOCKET", "");
        if (!nativeEndpoint.isBlank()) {
            return RestClient.builder().baseUrl("http://sensor")
                    .requestFactory(new LocalSensorRequestFactory(nativeEndpoint)).build();
        }
        String baseUrl = environment.getProperty("OMEGA_HOST_WORKER_URL", properties.forensicWorker().baseUrl());
        String token = environment.getProperty("OMEGA_HOST_INTERNAL_SERVICE_TOKEN", properties.security().internalServiceToken());
        if (token == null || token.length() < 32) {
            throw new IllegalStateException("El token del sensor de equipo debe tener al menos 32 caracteres");
        }
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(180));
        return RestClient.builder().baseUrl(baseUrl).defaultHeader(INTERNAL_TOKEN_HEADER, token)
                .requestFactory(factory).requestInterceptor((request, body, execution) -> {
                    if (sovereignPolicy != null) sovereignPolicy.checkWorkerRequest(request.getURI());
                    if (environment.getProperty("OMEGA_REQUIRE_HMAC", Boolean.class, false)) {
                        return SensorHmac.interceptor(token).intercept(request, body, execution);
                    }
                    return execution.execute(request, body);
                }).build();
    }

    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "omega.ai.provider", havingValue = "openai", matchIfMissing = true)
    public RestClient openAiRestClient(OmegaProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofSeconds(60));

        return RestClient.builder()
                .baseUrl(properties.rag().openAiBaseUrl())
                .defaultHeader("User-Agent", "OMEGA-CTI-Core/1.0")
                .requestFactory(factory)
                .build();
    }
}
