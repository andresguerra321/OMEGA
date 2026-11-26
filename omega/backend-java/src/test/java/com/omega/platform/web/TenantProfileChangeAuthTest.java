package com.omega.platform.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.JsonSecurityHandlers;
import com.omega.platform.security.JwtAuthenticationFilter;
import com.omega.platform.security.JwtService;
import com.omega.platform.security.Role;
import com.omega.platform.security.SecurityConfig;
import com.omega.platform.security.SessionCookieHelper;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.TenantProfileConfigService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = ProfileConfigController.class)
@Import({
        SecurityConfig.class,
        JwtAuthenticationFilter.class,
        SessionCookieHelper.class,
        JsonSecurityHandlers.class,
        TenantProfileConfigService.class
})
class TenantProfileChangeAuthTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TenantRepository tenantRepository;

    @MockBean
    private com.omega.platform.repository.DocumentRepository documentRepository;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserRepository userRepository;

    @MockBean
    private AuditLogService auditLogService;

    private TenantEntity mockAuth(String token, UUID tenantId, UUID userId, Role role, TenantProfile profile) {
        JwtService.ParsedJwtClaims claims = new JwtService.ParsedJwtClaims(
                userId, tenantId, role.name().toLowerCase() + "@omega.test", role);
        UserRepository.AuthenticatedWorkspaceMember member = mock(UserRepository.AuthenticatedWorkspaceMember.class);
        when(member.getUserId()).thenReturn(userId);
        when(member.getTenantId()).thenReturn(tenantId);
        when(member.isActive()).thenReturn(true);
        when(member.getRole()).thenReturn(role);
        when(member.getEmail()).thenReturn(claims.email());

        TenantEntity tenant = new TenantEntity("org-" + profile.name().toLowerCase(), "Org", profile);
        when(jwtService.parseAndValidate(token)).thenReturn(claims);
        when(userRepository.findActiveWorkspaceMember(userId, tenantId)).thenReturn(Optional.of(member));
        when(tenantRepository.findByIdAndActiveTrue(tenantId)).thenReturn(Optional.of(tenant));
        when(tenantRepository.findActiveForUpdate(tenantId)).thenReturn(Optional.of(tenant));
        when(tenantRepository.save(any(TenantEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        return tenant;
    }

    @Test
    void adminCanChangeProfileWithExplicitConfirmationAndAuditLog() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        TenantEntity tenant = mockAuth("tok-admin", tenantId, userId, Role.ADMIN, TenantProfile.GENERAL);

        mvc.perform(put("/api/v1/profile")
                        .header("Authorization", "Bearer tok-admin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"DEVELOPER\",\"confirmed\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile").value("DEVELOPER"))
                .andExpect(jsonPath("$.defaultView").value("repo_scanner"));

        assertEquals(TenantProfile.DEVELOPER, tenant.getProfile());
        verify(tenantRepository).save(tenant);
        verify(auditLogService).record(
                eq(tenantId),
                eq(userId),
                eq("TENANT_PROFILE_CHANGED"),
                eq("TENANT"),
                eq(tenantId.toString()),
                eq(Map.of(
                        "previousProfile", "GENERAL",
                        "newProfile", "DEVELOPER",
                        "confirmed", true
                ))
        );
    }

    @Test
    void adminChangeWithoutConfirmationIsRejected() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        mockAuth("tok-admin-noconfirm", tenantId, userId, Role.ADMIN, TenantProfile.GENERAL);

        mvc.perform(put("/api/v1/profile")
                        .header("Authorization", "Bearer tok-admin-noconfirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":false}"))
                .andExpect(status().isBadRequest());

        verify(tenantRepository, never()).save(any());
        verify(auditLogService, never()).record(any(), any(), any(), any(), any(), any());
    }

    @Test
    void analystAndClientReceiveForbiddenOnProfileChange() throws Exception {
        mockAuth("tok-analyst", UUID.randomUUID(), UUID.randomUUID(), Role.ANALYST, TenantProfile.GENERAL);
        mvc.perform(put("/api/v1/profile")
                        .header("Authorization", "Bearer tok-analyst")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"DEVELOPER\",\"confirmed\":true}"))
                .andExpect(status().isForbidden());

        mockAuth("tok-client", UUID.randomUUID(), UUID.randomUUID(), Role.CLIENT, TenantProfile.GENERAL);
        mvc.perform(put("/api/v1/profile")
                        .header("Authorization", "Bearer tok-client")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isForbidden());

        verify(tenantRepository, never()).save(any());
    }
}
