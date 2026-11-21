package com.omega.platform.web;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.DocumentRepository;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = ProfileConfigController.class)
@Import({
        SecurityConfig.class,
        JwtAuthenticationFilter.class,
        SessionCookieHelper.class,
        JsonSecurityHandlers.class,
        TenantProfileConfigService.class
})
class TenantProfileMigrationAndEndpointTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TenantRepository tenantRepository;

    @MockBean
    private DocumentRepository documentRepository;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserRepository userRepository;

    @MockBean
    private AuditLogService auditLogService;

    private void mockAuth(String token, UUID tenantId, Role role, TenantProfile profile) {
        UUID userId = UUID.randomUUID();
        JwtService.ParsedJwtClaims claims = new JwtService.ParsedJwtClaims(
                userId, tenantId, role.name().toLowerCase() + "@omega.test", role);
        UserEntity user = mock(UserEntity.class);
        when(user.getId()).thenReturn(userId);
        when(user.getTenantId()).thenReturn(tenantId);
        when(user.isActive()).thenReturn(true);
        when(user.getRole()).thenReturn(role);
        when(user.getEmail()).thenReturn(claims.email());

        when(jwtService.parseAndValidate(token)).thenReturn(claims);
        when(userRepository.findActiveUserInActiveTenant(userId, tenantId)).thenReturn(Optional.of(user));
        when(tenantRepository.findByIdAndActiveTrue(tenantId))
                .thenReturn(Optional.of(new TenantEntity("org-" + profile.name().toLowerCase(), "Org", profile)));
    }

    @Test
    void migrationV11IsSafeAndReversible() throws Exception {
        Path migration = Path.of("src/main/resources/db/migration/V11__tenant_profile.sql");
        assertTrue(Files.exists(migration), "Debe existir V11__tenant_profile.sql");
        String sql = Files.readString(migration);
        assertTrue(sql.contains("ADD COLUMN IF NOT EXISTS profile"), "Debe agregar columna de forma segura");
        assertTrue(sql.contains("DEFAULT 'GENERAL'"), "Debe asignar GENERAL a tenants existentes");
        assertTrue(sql.contains("'LEGAL', 'DEVELOPER', 'GENERAL'"), "Debe restringir valores válidos");
        assertTrue(sql.contains("DROP COLUMN IF EXISTS profile"), "Debe documentar reversibilidad");
    }

    @Test
    void tenantEntityDefaultsToGeneralAndAcceptsDeveloper() {
        TenantEntity defaultTenant = new TenantEntity("acme", "Acme Corp");
        assertEquals(TenantProfile.GENERAL, defaultTenant.getProfile());

        TenantEntity devTenant = new TenantEntity("devsec", "DevSec Lab", TenantProfile.DEVELOPER);
        assertEquals(TenantProfile.DEVELOPER, devTenant.getProfile());
    }

    @Test
    void profileConfigRequiresAuthentication() throws Exception {
        mvc.perform(get("/api/v1/profile/config"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void profileConfigReturnsVersionedConfigsAcrossProfilesAndRoles() throws Exception {
        mockAuth("tok-dev-admin", UUID.randomUUID(), Role.ADMIN, TenantProfile.DEVELOPER);
        mvc.perform(get("/api/v1/profile/config").header("Authorization", "Bearer tok-dev-admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile").value("DEVELOPER"))
                .andExpect(jsonPath("$.configVersion").value("1.1.0"))
                .andExpect(jsonPath("$.defaultView").value("repo_scanner"))
                .andExpect(jsonPath("$.ragCorpusScope").value("dev_supply_chain_cti"))
                .andExpect(jsonPath("$.copilotTone").value("technical_appsec"))
                .andExpect(jsonPath("$.visibleModules[0]").value("repo_scanner"))
                .andExpect(jsonPath("$.moduleLabels.inicio").value("Proyectos y hallazgos"))
                .andExpect(jsonPath("$.moduleLabels.amenazas").value("Cadena de suministro"))
                .andExpect(jsonPath("$.moduleLabels.repo_scanner").value("Proyectos"))
                .andExpect(jsonPath("$.moduleLabels.equipo").value("Mi estación"));

        mockAuth("tok-legal-analyst", UUID.randomUUID(), Role.ANALYST, TenantProfile.LEGAL);
        mvc.perform(get("/api/v1/profile/config").header("Authorization", "Bearer tok-legal-analyst"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile").value("LEGAL"))
                .andExpect(jsonPath("$.defaultView").value("expedientes"))
                .andExpect(jsonPath("$.ragCorpusScope").value("legal_expedientes"))
                .andExpect(jsonPath("$.copilotTone").value("forensic_legal"))
                .andExpect(jsonPath("$.visibleModules").value(org.hamcrest.Matchers.contains("expedientes", "preguntar", "seguridad_despacho", "cuenta")));

        mockAuth("tok-gen-client", UUID.randomUUID(), Role.CLIENT, TenantProfile.GENERAL);
        mvc.perform(get("/api/v1/profile/config").header("Authorization", "Bearer tok-gen-client"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile").value("GENERAL"))
                .andExpect(jsonPath("$.defaultView").value("inicio"))
                .andExpect(jsonPath("$.ragCorpusScope").value("general_cti"))
                .andExpect(jsonPath("$.copilotTone").value("balanced_defensive"));
    }
}
