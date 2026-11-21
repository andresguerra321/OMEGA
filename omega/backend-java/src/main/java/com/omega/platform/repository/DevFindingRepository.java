package com.omega.platform.repository;

import com.omega.platform.domain.DevFindingEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevFindingRepository extends JpaRepository<DevFindingEntity, UUID> {
    List<DevFindingEntity> findAllByTenantIdAndScanIdOrderByScorePointsDesc(UUID tenantId, UUID scanId);
    List<DevFindingEntity> findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(UUID tenantId, UUID projectId);
    List<DevFindingEntity> findAllByTenantIdOrderByCreatedAtDesc(UUID tenantId);
    Optional<DevFindingEntity> findByIdAndTenantId(UUID id, UUID tenantId);
    long countByTenantIdAndProjectId(UUID tenantId, UUID projectId);
}
