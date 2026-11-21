package com.omega.platform.repository;

import com.omega.platform.domain.DevPolicyEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevPolicyRepository extends JpaRepository<DevPolicyEntity, UUID> {
    Optional<DevPolicyEntity> findByTenantIdAndProjectIdIsNull(UUID tenantId);
    Optional<DevPolicyEntity> findByTenantIdAndProjectId(UUID tenantId, UUID projectId);
    long countByTenantIdAndProjectId(UUID tenantId, UUID projectId);
}
