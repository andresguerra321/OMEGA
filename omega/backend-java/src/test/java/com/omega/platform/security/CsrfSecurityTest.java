package com.omega.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.service.AuthService;
import com.omega.platform.web.AuthController;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@WebMvcTest(controllers = AuthController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, SessionCookieHelper.class,
        JsonSecurityHandlers.class, CsrfSecurityTest.ProbeController.class})
class CsrfSecurityTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockBean JwtService jwt;
    @MockBean UserRepository users;
    @MockBean AuthService auth;
    @MockBean OmegaProperties properties;

    @BeforeEach
    void activeUser() {
        UUID userId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        when(jwt.parseAndValidate("valid-jwt")).thenReturn(
                new JwtService.ParsedJwtClaims(userId, tenantId, "user@example.org", Role.ADMIN));
        when(jwt.parseAndValidate("invalid-jwt")).thenThrow(new JwtException("invalid"));
        UserEntity user = org.mockito.Mockito.mock(UserEntity.class);
        when(user.getId()).thenReturn(userId);
        when(user.getTenantId()).thenReturn(tenantId);
        when(user.getEmail()).thenReturn("user@example.org");
        when(user.getRole()).thenReturn(Role.ADMIN);
        when(user.isActive()).thenReturn(true);
        when(users.findActiveUserInActiveTenant(userId, tenantId)).thenReturn(Optional.of(user));
    }

    @RestController
    static class ProbeController {
        @RequestMapping("/api/v1/csrf-probe")
        Map<String, Boolean> probe() { return Map.of("ok", true); }
    }

    @ParameterizedTest
    @ValueSource(strings = {"POST", "PUT", "PATCH", "DELETE"})
    void cookieWritesNeedCsrfButBearerWritesDoNot(String method) throws Exception {
        mvc.perform(MockMvcRequestBuilders.request(HttpMethod.valueOf(method), "/api/v1/csrf-probe")
                .cookie(session())).andExpect(status().isForbidden());
        mvc.perform(MockMvcRequestBuilders.request(HttpMethod.valueOf(method), "/api/v1/csrf-probe")
                .header("Authorization", "Bearer valid-jwt").cookie(session()))
                .andExpect(status().isOk());
    }

    @Test
    void realCsrfEndpointEnablesCookieWriteAndRejectsWrongToken() throws Exception {
        var bootstrap = mvc.perform(get("/api/v1/auth/csrf").secure(true)).andExpect(status().isOk())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("HttpOnly"),
                        org.hamcrest.Matchers.containsString("Secure"),
                        org.hamcrest.Matchers.containsString("Path=/api"))))
                .andReturn().getResponse();
        var token = json.readTree(bootstrap.getContentAsString());
        Cookie csrfCookie = bootstrap.getCookie("XSRF-TOKEN");
        assertThat(csrfCookie).isNotNull();
        assertThat(csrfCookie.getAttribute("SameSite")).isEqualTo("Strict");
        assertThat(bootstrap.getHeader("Cache-Control")).contains("no-store");
        mvc.perform(post("/api/v1/csrf-probe").cookie(session(), csrfCookie)
                .header(token.get("headerName").asText(), token.get("token").asText()))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/csrf-probe").cookie(session(), csrfCookie)
                .header("X-XSRF-TOKEN", "wrong-token")).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/csrf-probe").cookie(session())
                .header("X-XSRF-TOKEN", token.get("token").asText())).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/csrf-probe").cookie(session())).andExpect(status().isOk());
    }

    @Test
    void invalidOrEmptyBearerNeverFallsBackToCookie() throws Exception {
        mvc.perform(post("/api/v1/csrf-probe").cookie(session())
                .header("Authorization", "Bearer invalid-jwt")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/csrf-probe").cookie(session())
                .header("Authorization", "Bearer ")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/csrf-probe").cookie(session())
                .header("Authorization", "Bearer ")).andExpect(status().isUnauthorized());
    }

    @Test
    void bearerOnlyModeCannotUseAmbientCookieAndDoesNotIssueSessionCookie() throws Exception {
        mvc.perform(post("/api/v1/csrf-probe").cookie(session()).header("X-Omega-Auth-Mode", "bearer"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/csrf-probe").cookie(session()).header("X-Omega-Auth-Mode", "bearer")
                .header("Authorization", "Bearer valid-jwt")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/auth/login").cookie(session()).header("X-Omega-Auth-Mode", "bearer")
                .contentType("application/json")
                .content("{\"tenantSlug\":\"test\",\"email\":\"user@example.org\",\"password\":\"secret\"}"))
                .andExpect(status().isOk()).andExpect(header().doesNotExist("Set-Cookie"));
        var response = new org.springframework.mock.web.MockHttpServletResponse();
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        request.addHeader("X-Omega-Auth-Mode", "bearer");
        new SessionCookieHelper("omega_session", false, 3600).attachSessionCookie(request, response, "valid-jwt");
        assertThat(response.getHeader("Set-Cookie")).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"login", "register", "tenants/register", "logout", "mfa/verify",
            "mfa/resend-email", "password-reset/request", "password-reset/confirm"})
    void publicAuthWritesAlsoRequireCsrf(String path) throws Exception {
        mvc.perform(post("/api/v1/auth/" + path)).andExpect(status().isForbidden());
    }

    @Test
    void corsRunsThroughActualSecurityChain() throws Exception {
        for (String origin : new String[] {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"}) {
            mvc.perform(options("/api/v1/csrf-probe").header("Origin", origin)
                    .header("Access-Control-Request-Method", "POST")
                    .header("Access-Control-Request-Headers", "Authorization,Content-Type,X-XSRF-TOKEN,X-Omega-Auth-Mode"))
                    .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", origin));
            mvc.perform(get("/api/v1/csrf-probe").header("Origin", origin)
                    .header("Authorization", "Bearer valid-jwt"))
                    .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", origin));
        }
        mvc.perform(options("/api/v1/csrf-probe").header("Origin", "null")
                .header("Access-Control-Request-Method", "POST")).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/csrf-probe").header("Origin", "null")
                .header("Authorization", "Bearer valid-jwt")).andExpect(status().isForbidden());
    }

    private Cookie session() { return new Cookie("omega_session", "valid-jwt"); }
}
