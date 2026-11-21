package com.omega.platform.repository;

import com.omega.platform.domain.ExpedientePermissionEntity;
import java.util.Optional;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExpedientePermissionRepository extends JpaRepository<ExpedientePermissionEntity, UUID> {

    List<ExpedientePermissionEntity> findAllByTenantIdAndExpedienteIdOrderByGrantedAtAsc(UUID tenantId, UUID expedienteId);

    Optional<ExpedientePermissionEntity> findByTenantIdAndExpedienteIdAndUserId(
            UUID tenantId,
            UUID expedienteId,
            UUID userId
    );
}
