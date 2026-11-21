package com.omega.platform.web;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.security.Role;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.TenantProfileConfigService;
import com.omega.platform.service.TenantProfileConfigService.ProfileConfig;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Expone y actualiza la configuración versionada asociada al perfil del tenant autenticado.
 */
@RestController
@RequestMapping("/api/v1/profile")
public class ProfileConfigController {

    private final TenantRepository tenantRepository;
    private final TenantProfileConfigService configService;
    private final AuditLogService auditLogService;
    private final DocumentRepository documentRepository;

    public ProfileConfigController(
            TenantRepository tenantRepository,
            TenantProfileConfigService configService,
            AuditLogService auditLogService,
            DocumentRepository documentRepository
    ) {
        this.tenantRepository = tenantRepository;
        this.configService = configService;
        this.auditLogService = auditLogService;
        this.documentRepository = documentRepository;
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

    /**
     * Cambia el perfil sin borrar contenido; al entrar o salir de LEGAL sincroniza el alcance documental.
     * Solo ADMIN puede ejecutarlo y requiere confirmación explícita.
     */
    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ProfileConfig updateTenantProfile(@Valid @RequestBody UpdateTenantProfileRequest request) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        if (scope.role() != Role.ADMIN) {
            throw new AccessDeniedException("Solo un administrador del espacio puede cambiar el perfil");
        }
        if (!Boolean.TRUE.equals(request.confirmed())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Debes confirmar explícitamente el cambio de perfil del espacio");
        }
        TenantEntity tenant = tenantRepository.findActiveForUpdate(scope.tenantId())
                .orElseThrow(() -> new AccessDeniedException("Tenant inactivo o inexistente"));

        TenantProfile previousProfile = tenant.getProfile() != null ? tenant.getProfile() : TenantProfile.GENERAL;
        TenantProfile nextProfile = request.profile();
        if (previousProfile != nextProfile) {
            tenant.setProfile(nextProfile);
            tenantRepository.save(tenant);
            if (previousProfile == TenantProfile.LEGAL || nextProfile == TenantProfile.LEGAL) {
                documentRepository.retagTenantDocuments(scope.tenantId(), nextProfile.name());
            }
            auditLogService.record(
                    scope.tenantId(),
                    scope.userId(),
                    "TENANT_PROFILE_CHANGED",
                    "TENANT",
                    scope.tenantId().toString(),
                    Map.of(
                            "previousProfile", previousProfile.name(),
                            "newProfile", nextProfile.name(),
                            "confirmed", true
                    )
            );
        }
        return configService.getConfig(nextProfile);
    }

    public record UpdateTenantProfileRequest(
            @NotNull(message = "El perfil destino es obligatorio")
            TenantProfile profile,
            Boolean confirmed
    ) {
    }
}
