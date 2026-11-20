package com.omega.platform.web;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import java.util.List;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Expone la configuración estática asociada al perfil del tenant autenticado.
 */
@RestController
@RequestMapping("/api/v1/profile")
public class ProfileConfigController {

    private final TenantRepository tenantRepository;

    public ProfileConfigController(TenantRepository tenantRepository) {
        this.tenantRepository = tenantRepository;
    }

    @GetMapping("/config")
    public ProfileConfigResponse getProfileConfig() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(scope.tenantId())
                .orElseThrow(() -> new AccessDeniedException("Tenant inactivo o inexistente"));
        TenantProfile profile = tenant.getProfile() != null ? tenant.getProfile() : TenantProfile.GENERAL;
        return ProfileConfigResponse.forProfile(profile);
    }

    public record ProfileConfigResponse(
            TenantProfile profile,
            List<String> visibleModules,
            String ragCorpusScope,
            String copilotTone
    ) {
        public static ProfileConfigResponse forProfile(TenantProfile profile) {
            return switch (profile) {
                case LEGAL -> new ProfileConfigResponse(
                        TenantProfile.LEGAL,
                        List.of("inicio", "equipo", "exposicion", "amenazas", "preguntar", "expedientes", "cuenta"),
                        "legal_expedientes",
                        "forensic_legal");
                case DEVELOPER -> new ProfileConfigResponse(
                        TenantProfile.DEVELOPER,
                        List.of("inicio", "equipo", "exposicion", "amenazas", "preguntar", "repo_scanner", "cuenta"),
                        "dev_supply_chain_cti",
                        "technical_appsec");
                case GENERAL -> new ProfileConfigResponse(
                        TenantProfile.GENERAL,
                        List.of("inicio", "equipo", "exposicion", "amenazas", "preguntar", "cuenta"),
                        "general_cti",
                        "balanced_defensive");
            };
        }
    }
}
