package com.omega.platform.security;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.service.AuthService;
import com.omega.platform.web.AuthController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = AuthController.class, properties = {
        "omega.security.local-instant-access=true",
        "omega.security.local-operator-email=obsolete@example.test"})
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, SessionCookieHelper.class, JsonSecurityHandlers.class})
class LocalWorkspaceAccessTest {
    @Autowired private MockMvc mvc;
    @MockBean private JwtService jwtService;
    @MockBean private UserRepository userRepository;
    @MockBean private AuthService authService;
    @MockBean private OmegaProperties properties;

    @Test
    void legacyConfigurationCannotEnableAccountlessAccess() throws Exception {
        when(properties.security()).thenReturn(new OmegaProperties.Security(
                "0123456789abcdef0123456789abcdef", 3600, "omega", true, "", "internal-token"));
        mvc.perform(get("/api/v1/auth/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localAccessEnabled").value(false));
        mvc.perform(post("/api/v1/auth/local-session").with(csrf()))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(authService);
    }

    @Test
    void protectedApplicationEndpointsRequireLogin() throws Exception {
        for (String path : new String[] {"/api/v1/auth/me", "/api/v1/expedientes", "/api/v1/forensics/host/realtime/status"}) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
        verifyNoInteractions(authService);
    }
}
