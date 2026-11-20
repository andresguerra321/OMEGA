package com.omega.platform.web;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.service.TenantProfileConfigService;
import com.omega.platform.service.TenantProfileConfigService.ProfileConfig;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Expone la configuración versionada asociada al perfil del tenant autenticado.
 */
@RestController
@RequestMapping("/api/v1/profile")
public class ProfileConfigController {

    private final TenantRepository tenantRepository;
    private final TenantProfileConfigService configService;

    public ProfileConfigController(
            TenantRepository tenantRepository,
            TenantProfileConfigService configService
    ) {
        this.tenantRepository = tenantRepository;
        this.configService = configService;
    }

    @GetMapping("/config")
    public ProfileConfig getProfileConfig() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(scope.tenantId())
                .orElseThrow(() -> new AccessDeniedException("Tenant inactivo o inexistente"));
        TenantProfile profile = tenant.getProfile() != null ? tenant.getProfile() : TenantProfile.GENERAL;
        return configService.getConfig(profile);
    }
}
