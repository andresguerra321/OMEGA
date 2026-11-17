package com.omega.platform.integration;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.omega.platform.integration.forensic.ForensicBridgeService;
import com.omega.platform.integration.forensic.ForensicWorkerContracts;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.web.ForensicController;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest
@ContextConfiguration(classes = ContainmentControllerTest.Config.class)
class ContainmentControllerTest {
    @Configuration
    @EnableMethodSecurity
    static class Config {
        @Bean ForensicController controller(ForensicBridgeService bridge) { return new ForensicController(bridge); }
        @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
            return http.csrf(csrf -> csrf.disable()).authorizeHttpRequests(auth -> auth.anyRequest().authenticated()).build();
        }
    }
    @Autowired MockMvc mvc;
    @org.springframework.boot.test.mock.mockito.MockBean ForensicBridgeService bridge;
    private final OmegaPrincipal owner = new OmegaPrincipal(UUID.randomUUID(), UUID.randomUUID(), "owner@example.org", Role.ADMIN, true);

    @BeforeEach void resetMock() { reset(bridge); }

    @Test void executeAndRollbackRequireAdministratorAndForwardAuthenticatedOwner() throws Exception {
        var authentication = new UsernamePasswordAuthenticationToken(owner, null, owner.getAuthorities());
        when(bridge.executeContainment(eq(owner), any())).thenReturn(Map.of("actionId", "fixture", "status", "PREVIEW"));
        mvc.perform(post("/api/v1/forensic/containment/execute").with(authentication(authentication))
                .contentType("application/json").content("{\"actionType\":\"BLOCK_NETWORK_INDICATOR\",\"target\":{\"indicator\":\"93.184.216.34\"},\"dryRun\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PREVIEW"));
        String actionId = UUID.randomUUID().toString();
        when(bridge.rollbackContainment(eq(owner), eq(actionId), any())).thenReturn(Map.of("status", "ROLLED_BACK"));
        mvc.perform(post("/api/v1/forensic/containment/rollback/" + actionId).with(authentication(authentication))
                .contentType("application/json").content("{\"currentPassword\":\"fixture-password\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ROLLED_BACK"));
        OmegaPrincipal analyst = new OmegaPrincipal(UUID.randomUUID(), owner.tenantId(), "analyst@example.org", Role.ANALYST, true);
        mvc.perform(get("/api/v1/forensic/containment/history").with(authentication(new UsernamePasswordAuthenticationToken(analyst, null, analyst.getAuthorities()))))
                .andExpect(status().isForbidden());
        verify(bridge).executeContainment(eq(owner), any(ForensicWorkerContracts.ContainmentRequest.class));
    }

    @Test void malformedRequestsCannotImplicitlyExecute() throws Exception {
        mvc.perform(post("/api/v1/forensic/containment/execute")
                .with(authentication(new UsernamePasswordAuthenticationToken(owner, null, owner.getAuthorities())))
                .contentType("application/json").content("{\"actionType\":\"BLOCK_NETWORK_INDICATOR\",\"target\":{}}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(bridge);
    }
}
