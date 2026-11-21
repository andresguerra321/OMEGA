package com.omega.platform.repository;

import com.omega.platform.domain.DevMonitorSubscriptionEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevMonitorSubscriptionRepository extends JpaRepository<DevMonitorSubscriptionEntity, UUID> {
    List<DevMonitorSubscriptionEntity> findAllByTenantIdAndProjectId(UUID tenantId, UUID projectId);
    List<DevMonitorSubscriptionEntity> findAllByEnabledTrue();
    Optional<DevMonitorSubscriptionEntity> findByTenantIdAndProjectIdAndChannel(UUID tenantId, UUID projectId, String channel);
    long countByTenantIdAndProjectId(UUID tenantId, UUID projectId);
}
