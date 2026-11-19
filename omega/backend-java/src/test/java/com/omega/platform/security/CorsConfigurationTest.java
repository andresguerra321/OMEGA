package com.omega.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.util.PropertyPlaceholderHelper;
import org.springframework.web.cors.DefaultCorsProcessor;

class CorsConfigurationTest {

    @Test
    void defaultsAllowTauriPreflightAndRejectOpaqueOrigins() throws Exception {
        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application.yml"));
        String configured = yaml.getObject().getProperty("omega.security.cors-allowed-origins");
        assertCorsDefaults(configured);
    }

    @Test
    void javaFallbackAlsoRejectsOpaqueOrigins() throws Exception {
        Value annotation = SecurityConfig.class.getConstructors()[0]
                .getParameters()[2].getAnnotation(Value.class);
        assertCorsDefaults(annotation.value());
    }

    private void assertCorsDefaults(String placeholder) throws Exception {
        String origins = new PropertyPlaceholderHelper("${", "}", ":", false)
                .replacePlaceholders(placeholder, key -> null);
        SecurityConfig security = new SecurityConfig(mock(JwtAuthenticationFilter.class),
                mock(JsonSecurityHandlers.class), origins);
        for (String origin : new String[] { "http://tauri.localhost", "https://tauri.localhost",
                "tauri://localhost", "null", "https://untrusted.example" }) {
            MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS", "/api/v1/forensics/triage/device-live");
            request.addHeader("Origin", origin);
            request.addHeader("Access-Control-Request-Method", "POST");
            request.addHeader("Access-Control-Request-Headers", "Authorization, Content-Type");
            MockHttpServletResponse response = new MockHttpServletResponse();
            var cors = security.corsConfigurationSource().getCorsConfiguration(request);
            boolean trusted = origin.contains("tauri");
            assertThat(new DefaultCorsProcessor().processRequest(cors, request, response)).isEqualTo(trusted);
            assertThat(response.getStatus()).isEqualTo(trusted ? 200 : 403);
            assertThat(response.getHeader("Access-Control-Allow-Origin")).isEqualTo(trusted ? origin : null);
            assertThat(response.getHeader("Access-Control-Allow-Credentials")).isEqualTo(trusted ? "true" : null);
        }
    }
}
