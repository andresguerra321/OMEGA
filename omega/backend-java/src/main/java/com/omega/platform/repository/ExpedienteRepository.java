package com.omega.platform.repository;

import com.omega.platform.domain.ExpedienteEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ExpedienteRepository extends JpaRepository<ExpedienteEntity, UUID> {

    @Query("""
            SELECT e FROM ExpedienteEntity e WHERE e.tenantId = :tenantId
            AND (:admin = true OR e.ownerUserId = :userId OR EXISTS
                (SELECT p.id FROM ExpedientePermissionEntity p WHERE p.tenantId = :tenantId
                 AND p.expedienteId = e.id AND p.userId = :userId))
            AND (:search = '' OR LOWER(e.title) LIKE LOWER(CONCAT('%', :search, '%'))
                 OR LOWER(e.caseReference) LIKE LOWER(CONCAT('%', :search, '%')))
            AND (:state IS NULL OR e.status = :state)
            AND (:classification IS NULL OR e.classification = :classification)
            """)
    org.springframework.data.domain.Page<ExpedienteEntity> searchAccessible(
            @Param("tenantId") UUID tenantId, @Param("userId") UUID userId, @Param("admin") boolean admin,
            @Param("search") String search, @Param("state") com.omega.platform.domain.ExpedienteStatus state,
            @Param("classification") com.omega.platform.domain.ClassificationLevel classification,
            org.springframework.data.domain.Pageable pageable);

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
