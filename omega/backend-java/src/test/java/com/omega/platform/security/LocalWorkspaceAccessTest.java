package com.omega.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.ExpedienteEntity;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.ExpedienteRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.service.AuthService;
import com.omega.platform.web.AuthController;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = AuthController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, SessionCookieHelper.class, JsonSecurityHandlers.class})
class LocalWorkspaceAccessTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserRepository userRepository;

    @MockBean
    private AuthService authService;

    @MockBean
    private OmegaProperties properties;

    @Test
    void localSessionIssuesCookieWhenEnabledAndBlocksForwardedProxyRequests() throws Exception {
        var enabledSecurity = new OmegaProperties.Security(
                "0123456789abcdef0123456789abcdef", 3600, "omega", true, "", "internal-tok", true);
        when(properties.security()).thenReturn(enabledSecurity);
        UUID userId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        when(authService.enterLocalWorkspace()).thenReturn(new AuthTokenResponse(
                "local-jwt-token", "Bearer", 3600, userId, tenantId, "espacio-local",
                "operador@omega.local", Role.ADMIN));

        mvc.perform(get("/api/v1/auth/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localAccessEnabled").value(true));

        mvc.perform(post("/api/v1/auth/local-session").with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantSlug").value("espacio-local"))
                .andExpect(jsonPath("$.email").value("operador@omega.local"))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("omega_session=local-jwt-token")));

        mvc.perform(post("/api/v1/auth/local-session").with(csrf())
                        .header("X-Forwarded-For", "203.0.113.9"))
                .andExpect(status().isForbidden());
    }

    @Test
    void authServiceCreatesIsolatedLocalTenantWithRandomSecretAndRespectsDisabledFlag() {
        TenantRepository tenantRepo = mock(TenantRepository.class);
        UserRepository userRepo = mock(UserRepository.class);
        ExpedienteRepository expRepo = mock(ExpedienteRepository.class);
        JwtService realJwt = mock(JwtService.class);
        LoginRateLimiter limiter = new LoginRateLimiter();

        var disabledProps = new OmegaProperties(
                new OmegaProperties.Security("0123456789abcdef0123456789abcdef", 3600, "omega", true, "", "tok", false),
                new OmegaProperties.Ingest("/tmp/omega", 1024, "/tmp/tess"),
                null,
                new OmegaProperties.ForensicWorker("http://localhost:8000", 1000, 1000),
                new OmegaProperties.Cti("/tmp/cti"));
        AuthService disabledSvc = new AuthService(tenantRepo, userRepo, expRepo, new BCryptPasswordEncoder(),
                realJwt, disabledProps, limiter);
        assertThatThrownBy(disabledSvc::enterLocalWorkspace).isInstanceOf(AccessDeniedException.class);

        var enabledProps = new OmegaProperties(
                new OmegaProperties.Security("0123456789abcdef0123456789abcdef", 3600, "omega", true, "", "tok", true),
                new OmegaProperties.Ingest("/tmp/omega", 1024, "/tmp/tess"),
                null,
                new OmegaProperties.ForensicWorker("http://localhost:8000", 1000, 1000),
                new OmegaProperties.Cti("/tmp/cti"));
        when(tenantRepo.findBySlugAndActiveTrue("espacio-local")).thenReturn(Optional.empty());
        when(tenantRepo.existsBySlug("espacio-local")).thenReturn(false);
        TenantEntity savedTenant = new TenantEntity("espacio-local", "OMEGA Local");
        when(tenantRepo.save(any())).thenReturn(savedTenant);
        when(userRepo.findByTenantIdAndEmailIgnoreCase(any(), any())).thenReturn(Optional.empty());
        when(userRepo.save(any())).thenAnswer(inv -> inv.getArgument(0, UserEntity.class));
        when(expRepo.findAllByTenantIdOrderByCreatedAtDesc(any())).thenReturn(List.of());
        when(expRepo.save(any())).thenAnswer(inv -> inv.getArgument(0, ExpedienteEntity.class));
        when(realJwt.issueToken(any(), any(), any(), any())).thenReturn("jwt-issued");
        when(realJwt.getExpirationSeconds()).thenReturn(3600L);

        AuthService enabledSvc = new AuthService(tenantRepo, userRepo, expRepo, new BCryptPasswordEncoder(),
                realJwt, enabledProps, limiter);
        AuthTokenResponse token = enabledSvc.enterLocalWorkspace();
        assertThat(token.tenantSlug()).isEqualTo("espacio-local");
        assertThat(token.email()).isEqualTo("operador@omega.local");
        assertThat(token.role()).isEqualTo(Role.ADMIN);
        assertThat(token.accessToken()).isEqualTo("jwt-issued");
    }
}
