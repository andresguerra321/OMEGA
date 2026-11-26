package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.service.GoogleOidcClient;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(properties = {"OMEGA_ALLOW_TENANT_SELF_REGISTRATION=true",
        "omega.security.cors-allowed-origins=https://omega.example.org,https://other.example.org,http://tauri.localhost"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GoogleAuthIntegrationTest {
    private static final String ENDPOINT = "/api/v1/auth/google";
    private static final String ORIGIN = "https://omega.example.org";
    private static final String DESKTOP_ORIGIN = "http://tauri.localhost";
    private static final String PASSWORD = "LocalPassword2026!";
    private static PostgreSQLContainer<?> postgres;

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @MockBean private GoogleOidcClient google;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        if (postgres == null) {
            postgres = new PostgreSQLContainer<>(DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres"));
            postgres.start();
        }
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl() + "?currentSchema=omega_rag,public");
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @BeforeEach
    void providerSettings() {
        when(google.configured()).thenReturn(true);
        when(google.origin()).thenReturn(ORIGIN);
        when(google.authorize(anyString(), anyString(), anyString())).thenAnswer(call ->
                URI.create("https://accounts.google.com/o/oauth2/v2/auth?state=" + call.getArgument(0)));
    }

    @Test
    void staleSessionDoesNotHideGoogleOrBlockPublicLoginButStillPreventsLinking() throws Exception {
        var staleSession = new Cookie("omega_session", "obsolete-session-cookie");
        mvc.perform(get(ENDPOINT + "/config").cookie(staleSession))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true));

        var response = mvc.perform(startRequest(Map.of("action", "LOGIN"), null).cookie(staleSession))
                .andExpect(status().isOk()).andReturn().getResponse();
        var attempt = attemptFrom(response);
        when(google.exchange(anyString(), anyString(), anyString()))
                .thenReturn(new GoogleOidcClient.Identity("unlinked-synthetic-user", "demo@gmail.com", true));
        mvc.perform(finishRequest(attempt, null).cookie(staleSession, attempt.cookie()))
                .andExpect(status().isUnauthorized());
        verify(google).exchange(anyString(), anyString(), anyString());

        mvc.perform(startRequest(Map.of("action", "LINK", "password", PASSWORD), null).cookie(staleSession))
                .andExpect(status().isForbidden());
        mvc.perform(get(ENDPOINT + "/connection").cookie(staleSession))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void registrationBindsBrowserAndConsumesAttemptBeforeUsingGoogle() throws Exception {
        String email = email("demo");
        when(google.exchange(anyString(), anyString(), anyString()))
                .thenReturn(new GoogleOidcClient.Identity("registration-google-sub", email, true));

        mvc.perform(post(ENDPOINT + "/start").header(HttpHeaders.ORIGIN, ORIGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"LOGIN\"}").header("X-Omega-Auth-Mode", "bearer"))
                .andExpect(status().isForbidden());
        mvc.perform(post(ENDPOINT + "/start").with(csrf()).header(HttpHeaders.ORIGIN, "https://other.example.org")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"action\":\"LOGIN\"}"))
                .andExpect(status().isForbidden());

        var attempt = open(Map.of("action", "REGISTER", "registration", Map.of("fullName", "Ana Prueba", "profile", "DEVELOPER")), null);
        mvc.perform(finishRequest(attempt, null).cookie(new Cookie("omega_google_flow", "x".repeat(43))))
                .andExpect(status().isUnauthorized());
        mvc.perform(finishRequest(attempt, null).cookie(attempt.cookie()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.session.email").value(email))
                .andExpect(jsonPath("$.session.profile").value("DEVELOPER"))
                .andExpect(jsonPath("$.session.role").value("ANALYST"))
                .andExpect(jsonPath("$.session.recoveryKey").isString());
        mvc.perform(finishRequest(attempt, null).cookie(attempt.cookie())).andExpect(status().isUnauthorized());
        verify(google, times(1)).exchange(anyString(), anyString(), anyString());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.google_auth_attempts WHERE state=?", Integer.class, attempt.state())).isZero();
        assertThat(jdbc.queryForObject("""
                SELECT length(g.subject_hash) FROM omega_rag.google_identities g JOIN omega_rag.users u ON u.id=g.user_id WHERE u.email=?
                """, Integer.class, email)).isEqualTo(43);
    }

    @Test
    void existingAccountRequiresExplicitLinkAndKeepsMfaAndWorkspaceRole() throws Exception {
        String email = email("link");
        JsonNode account = registerLocal(email);
        String token = account.path("accessToken").asText();
        String otherToken = registerLocal(email("other")).path("accessToken").asText();
        var identity = new GoogleOidcClient.Identity("linked-google-sub", email, true);
        when(google.exchange(anyString(), anyString(), anyString())).thenReturn(identity);

        var notLinked = open(Map.of("action", "LOGIN"), null);
        mvc.perform(finishRequest(notLinked, null).cookie(notLinked.cookie())).andExpect(status().isUnauthorized());
        var noPassword = startRequest(Map.of("action", "LINK", "password", "incorrect"), token);
        mvc.perform(noPassword).andExpect(status().isUnauthorized());

        var link = open(Map.of("action", "LINK", "password", PASSWORD), token);
        mvc.perform(finishRequest(link, otherToken).cookie(link.cookie())).andExpect(status().isUnauthorized());
        mvc.perform(finishRequest(link, token).cookie(link.cookie()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.action").value("LINK"))
                .andExpect(jsonPath("$.session").doesNotExist());

        UUID userId = UUID.fromString(account.path("userId").asText());
        jdbc.update("UPDATE omega_rag.users SET mfa_enabled=true, mfa_method='TOTP' WHERE id=?", userId);
        var signIn = open(Map.of("action", "LOGIN"), null);
        mvc.perform(finishRequest(signIn, null).cookie(signIn.cookie()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.session.mfaRequired").value(true))
                .andExpect(jsonPath("$.session.userId").value(userId.toString()))
                .andExpect(jsonPath("$.session.tenantId").value(account.path("tenantId").asText()))
                .andExpect(jsonPath("$.session.role").value("ANALYST"))
                .andExpect(jsonPath("$.session.accessToken").doesNotExist());
    }

    @Test
    void desktopNeedsItsOwnProofAndWorkspaceToRedeemTheBrowserReturn() throws Exception {
        String email = email("desktop");
        String actor = registerLocal(email).path("accessToken").asText();
        String other = registerLocal(email("other-desktop")).path("accessToken").asText();
        mvc.perform(desktop("/start", Map.of("action", "LINK", "password", PASSWORD), actor)
                        .header(HttpHeaders.ORIGIN, "https://other.example.org"))
                .andExpect(status().isForbidden());
        var opened = mvc.perform(desktop("/start", Map.of("action", "LINK", "password", PASSWORD), actor)
                        .header(HttpHeaders.ORIGIN, DESKTOP_ORIGIN)).andExpect(status().isOk()).andReturn().getResponse();
        assertThat(opened.getHeader(HttpHeaders.SET_COOKIE)).isNull();
        var reply = json.readTree(opened.getContentAsString());
        String state = URI.create(reply.path("url").asText()).getQuery().substring("state=".length());
        String proof = reply.path("proof").asText();
        var redeem = Map.of("state", state, "proof", proof);
        assertThat(state).startsWith("D_");
        mvc.perform(desktop("/finish", redeem, actor).header(HttpHeaders.ORIGIN, DESKTOP_ORIGIN))
                .andExpect(status().isNoContent());
        var callback = Map.of("state", state, "code", "test-only-provider-code");
        mvc.perform(post(ENDPOINT + "/desktop/relay").header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(callback)))
                .andExpect(status().isForbidden());
        mvc.perform(request("/desktop/relay", callback, null).cookie(new Cookie("omega_session", "obsolete")))
                .andExpect(status().isNoContent());
        mvc.perform(desktop("/finish", Map.of("state", state, "proof", "z".repeat(43)), actor)
                        .header(HttpHeaders.ORIGIN, DESKTOP_ORIGIN)).andExpect(status().isUnauthorized());
        mvc.perform(desktop("/finish", redeem, other).header(HttpHeaders.ORIGIN, DESKTOP_ORIGIN))
                .andExpect(status().isUnauthorized());

        when(google.exchange(anyString(), anyString(), anyString()))
                .thenReturn(new GoogleOidcClient.Identity("synthetic-desktop-sub", email, true));
        mvc.perform(desktop("/finish", redeem, actor).header(HttpHeaders.ORIGIN, DESKTOP_ORIGIN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.action").value("LINK"));
        mvc.perform(desktop("/finish", redeem, actor).header(HttpHeaders.ORIGIN, DESKTOP_ORIGIN))
                .andExpect(status().isUnauthorized());
        verify(google, times(1)).exchange(anyString(), anyString(), anyString());
    }

    private MockHttpServletRequestBuilder desktop(String path, Map<String, ?> body, String token) throws Exception {
        var request = post(ENDPOINT + "/desktop" + path).header("X-Omega-Auth-Mode", "bearer")
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return token == null ? request : request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
    }

    private JsonNode registerLocal(String email) throws Exception {
        var response = mvc.perform(post("/api/v1/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("fullName", "Persona Prueba", "email", email, "password", PASSWORD))))
                .andExpect(status().isCreated()).andReturn().getResponse();
        return json.readTree(response.getContentAsString());
    }

    private static String email(String prefix) {
        return prefix + "." + Math.floorMod(UUID.randomUUID().getLeastSignificantBits(), 100_000_000) + "@gmail.com";
    }

    private MockHttpServletRequestBuilder startRequest(Map<String, ?> body, String token) throws Exception {
        return request("/start", body, token);
    }

    private MockHttpServletRequestBuilder finishRequest(Attempt attempt, String token) throws Exception {
        return request("/finish", Map.of("state", attempt.state(), "code", "test-code"), token);
    }

    private MockHttpServletRequestBuilder request(String path, Map<String, ?> body, String token) throws Exception {
        var request = post(ENDPOINT + path).with(csrf()).header(HttpHeaders.ORIGIN, ORIGIN)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return token == null ? request : request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
    }

    private Attempt open(Map<String, ?> body, String token) throws Exception {
        var response = mvc.perform(startRequest(body, token)).andExpect(status().isOk()).andReturn().getResponse();
        return attemptFrom(response);
    }

    private Attempt attemptFrom(org.springframework.mock.web.MockHttpServletResponse response) throws Exception {
        String url = json.readTree(response.getContentAsString()).path("url").asText();
        String cookie = response.getHeader(HttpHeaders.SET_COOKIE);
        assertThat(cookie).contains("HttpOnly", "Secure", "SameSite=Strict");
        return new Attempt(URI.create(url).getQuery().substring("state=".length()),
                new Cookie("omega_google_flow", cookie.split(";", 2)[0].split("=", 2)[1]));
    }

    private record Attempt(String state, Cookie cookie) {}
}
