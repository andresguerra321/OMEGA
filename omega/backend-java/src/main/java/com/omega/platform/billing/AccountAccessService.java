package com.omega.platform.billing;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

@Service
public class AccountAccessService {
    private final TenantRepository tenants;
    public AccountAccessService(TenantRepository tenants) { this.tenants = tenants; }

    public boolean canManage(UUID tenantId, UUID userId, Role role) {
        TenantEntity tenant = tenants.findByIdAndActiveTrue(tenantId)
                .orElseThrow(() -> new AccessDeniedException("Cuenta no disponible"));
        return "INDIVIDUAL".equals(tenant.getAccountType())
                ? userId.equals(tenant.getOwnerUserId()) : role == Role.ADMIN;
    }

    public void requireManager(OmegaPrincipal actor) {
        if (actor == null || !canManage(actor.tenantId(), actor.userId(), actor.role()))
            throw new AccessDeniedException("Solo el titular o un administrador de la organización puede realizar esta acción.");
    }
}
