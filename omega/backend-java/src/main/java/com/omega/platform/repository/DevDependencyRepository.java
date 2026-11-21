package com.omega.platform.repository;

import com.omega.platform.domain.DevDependencyEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevDependencyRepository extends JpaRepository<DevDependencyEntity, UUID> {
    List<DevDependencyEntity> findAllByTenantIdAndScanIdOrderByEcosystemAscPackageNameAsc(UUID tenantId, UUID scanId);
    List<DevDependencyEntity> findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(UUID tenantId, UUID projectId);
    long countByTenantIdAndProjectId(UUID tenantId, UUID projectId);
}
