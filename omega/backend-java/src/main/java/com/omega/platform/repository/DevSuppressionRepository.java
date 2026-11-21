package com.omega.platform.repository;

import com.omega.platform.domain.DevSuppressionEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevSuppressionRepository extends JpaRepository<DevSuppressionEntity, UUID> {
    List<DevSuppressionEntity> findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(UUID tenantId, UUID projectId);
    Optional<DevSuppressionEntity> findByIdAndTenantId(UUID id, UUID tenantId);
    long countByTenantIdAndProjectId(UUID tenantId, UUID projectId);
}
