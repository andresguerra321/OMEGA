package com.omega.platform.saas;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeviceRepository extends JpaRepository<DeviceEntity, UUID> {

    List<DeviceEntity> findByTenantIdOrderByLastHeartbeatAtDesc(UUID tenantId);

    Optional<DeviceEntity> findByTenantIdAndDeviceUid(UUID tenantId, String deviceUid);

    Optional<DeviceEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    long countByTenantIdAndStatus(UUID tenantId, String status);
}
