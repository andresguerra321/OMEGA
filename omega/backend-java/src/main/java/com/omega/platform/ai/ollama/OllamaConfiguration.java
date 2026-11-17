package com.omega.platform.ai.ollama;

import com.omega.platform.config.OmegaProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
@ConditionalOnProperty(name = "omega.ai.provider", havingValue = "ollama")
public class OllamaConfiguration {
    public static void requireLocalEndpoint(String baseUrl, String... serviceNames) {
        URI uri = URI.create(baseUrl);
        String host = uri.getHost();
        boolean local = host != null && (List.of("localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal").contains(host)
                || List.of(serviceNames).contains(host));
        if (!local || !List.of("http", "https").contains(uri.getScheme()) || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalStateException("El modo soberano requiere un servicio del equipo local sin credenciales en la URL.");
        }
    }

    @Bean
    public RestClient ollamaRestClient(OmegaProperties properties) {
        var settings = properties.ai().ollama();
        requireLocalEndpoint(settings.baseUrl(), "ollama");
        for (String model : List.of(settings.embedModel(), settings.chatModel(), settings.visionModel())) {
            if (model.toLowerCase(java.util.Locale.ROOT).contains("cloud")) {
                throw new IllegalStateException("Los modelos cloud no están permitidos en modo soberano.");
            }
        }
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER).build();
        var factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofSeconds(120));
        return RestClient.builder().baseUrl(settings.baseUrl().replaceAll("/+$", ""))
                .requestFactory(factory).build();
    }
}
