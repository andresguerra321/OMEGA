package com.omega.platform.web;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

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
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, SessionCookieHelper.class, JsonSecurityHandlers.class})
class TenantProfileMigrationAndEndpointTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TenantRepository tenantRepository;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserRepository userRepository;

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
    void profileConfigReturnsDeveloperStaticConfig() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        JwtService.ParsedJwtClaims claims = new JwtService.ParsedJwtClaims(
                userId, tenantId, "dev@omega.test", Role.ADMIN);
        UserEntity user = mock(UserEntity.class);
        when(user.getId()).thenReturn(userId);
        when(user.getTenantId()).thenReturn(tenantId);
        when(user.isActive()).thenReturn(true);
        when(user.getRole()).thenReturn(Role.ADMIN);
        when(user.getEmail()).thenReturn("dev@omega.test");

        when(jwtService.parseAndValidate("tok-dev")).thenReturn(claims);
        when(userRepository.findActiveUserInActiveTenant(userId, tenantId)).thenReturn(Optional.of(user));
        when(tenantRepository.findByIdAndActiveTrue(tenantId))
                .thenReturn(Optional.of(new TenantEntity("devsec", "DevSec Lab", TenantProfile.DEVELOPER)));

        mvc.perform(get("/api/v1/profile/config").header("Authorization", "Bearer tok-dev"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile").value("DEVELOPER"))
                .andExpect(jsonPath("$.ragCorpusScope").value("dev_supply_chain_cti"))
                .andExpect(jsonPath("$.copilotTone").value("technical_appsec"))
                .andExpect(jsonPath("$.visibleModules[5]").value("repo_scanner"));
    }

    @Test
    void profileConfigReturnsLegalStaticConfig() throws Exception {
        UUID legalTenantId = UUID.randomUUID();
        UUID legalUserId = UUID.randomUUID();
        JwtService.ParsedJwtClaims legalClaims = new JwtService.ParsedJwtClaims(
                legalUserId, legalTenantId, "legal@omega.test", Role.ANALYST);
        UserEntity legalUser = mock(UserEntity.class);
        when(legalUser.getId()).thenReturn(legalUserId);
        when(legalUser.getTenantId()).thenReturn(legalTenantId);
        when(legalUser.isActive()).thenReturn(true);
        when(legalUser.getRole()).thenReturn(Role.ANALYST);
        when(legalUser.getEmail()).thenReturn("legal@omega.test");

        when(jwtService.parseAndValidate("tok-legal")).thenReturn(legalClaims);
        when(userRepository.findActiveUserInActiveTenant(legalUserId, legalTenantId))
                .thenReturn(Optional.of(legalUser));
        when(tenantRepository.findByIdAndActiveTrue(legalTenantId))
                .thenReturn(Optional.of(new TenantEntity("bufete", "Bufete", TenantProfile.LEGAL)));

        mvc.perform(get("/api/v1/profile/config").header("Authorization", "Bearer tok-legal"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile").value("LEGAL"))
                .andExpect(jsonPath("$.ragCorpusScope").value("legal_expedientes"))
                .andExpect(jsonPath("$.copilotTone").value("forensic_legal"))
                .andExpect(jsonPath("$.visibleModules[5]").value("expedientes"));
    }
}
