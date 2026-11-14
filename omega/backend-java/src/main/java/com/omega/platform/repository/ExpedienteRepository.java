package com.omega.platform.repository;

import com.omega.platform.domain.ExpedienteEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ExpedienteRepository extends JpaRepository<ExpedienteEntity, UUID> {

    Optional<ExpedienteEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<ExpedienteEntity> findAllByTenantIdOrderByCreatedAtDesc(UUID tenantId);

    @Query("""
            SELECT DISTINCT e FROM ExpedienteEntity e
            LEFT JOIN ExpedientePermissionEntity p
                ON p.expedienteId = e.id AND p.tenantId = e.tenantId AND p.userId = :userId
            WHERE e.tenantId = :tenantId
              AND (e.ownerUserId = :userId OR p.id IS NOT NULL)
            ORDER BY e.createdAt DESC
            """)
    List<ExpedienteEntity> findAllAccessibleByUserInTenant(
            @Param("tenantId") UUID tenantId,
            @Param("userId") UUID userId
    );
}
