package com.omega.platform.security;

import com.omega.platform.domain.ExpedienteEntity;
import com.omega.platform.domain.ExpedientePermissionEntity;
import com.omega.platform.domain.ExpedientePermissionLevel;
import com.omega.platform.repository.ExpedientePermissionRepository;
import com.omega.platform.repository.ExpedienteRepository;
import com.omega.platform.service.ResourceNotFoundException;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * Guardia centralizada de aislamiento multi-tenant y permisos por expediente.
 * Si el expediente pertenece a otro tenant o no existe, responde 404 sin filtrar existencia cross-tenant.
 */
@Service
public class ExpedienteAuthorizationService {

    private final ExpedienteRepository expedienteRepository;
    private final ExpedientePermissionRepository permissionRepository;

    public ExpedienteAuthorizationService(
            ExpedienteRepository expedienteRepository,
            ExpedientePermissionRepository permissionRepository
    ) {
        this.expedienteRepository = expedienteRepository;
        this.permissionRepository = permissionRepository;
    }

    public ExpedienteEntity requireReadAccess(OmegaPrincipal principal, UUID expedienteId) {
        return authorize(principal, expedienteId, false);
    }

    public ExpedienteEntity requireWriteAccess(OmegaPrincipal principal, UUID expedienteId) {
        return authorize(principal, expedienteId, true);
    }

    private ExpedienteEntity authorize(OmegaPrincipal principal, UUID expedienteId, boolean writeRequired) {
        UUID tenantId = principal.tenantId();
        ExpedienteEntity expediente = expedienteRepository.findByIdAndTenantId(expedienteId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Expediente no encontrado en el tenant actual"));

        if (principal.role() == Role.ADMIN || expediente.getOwnerUserId().equals(principal.userId())) {
            return expediente;
        }

        ExpedientePermissionEntity grant = permissionRepository
                .findByTenantIdAndExpedienteIdAndUserId(tenantId, expedienteId, principal.userId())
                .orElseThrow(() -> new AccessDeniedException("Sin permisos sobre el expediente solicitado"));

        if (writeRequired && grant.getPermission() != ExpedientePermissionLevel.WRITE) {
            throw new AccessDeniedException("Se requiere permiso WRITE sobre el expediente");
        }

        return expediente;
    }
}
