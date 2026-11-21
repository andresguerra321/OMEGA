package com.omega.platform.repository;

import com.omega.platform.domain.DevScanEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevScanRepository extends JpaRepository<DevScanEntity, UUID> {
    List<DevScanEntity> findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(UUID tenantId, UUID projectId);
    Optional<DevScanEntity> findByIdAndTenantId(UUID id, UUID tenantId);
    Optional<DevScanEntity> findFirstByTenantIdAndProjectIdOrderByCreatedAtDesc(UUID tenantId, UUID projectId);
    long countByTenantIdAndProjectId(UUID tenantId, UUID projectId);
}
