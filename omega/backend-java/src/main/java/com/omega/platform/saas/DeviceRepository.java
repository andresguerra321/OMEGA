package com.omega.platform.saas;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DeviceRepository extends JpaRepository<DeviceEntity, UUID> {

    List<DeviceEntity> findByTenantIdOrderByLastHeartbeatAtDesc(UUID tenantId);

    Optional<DeviceEntity> findByTenantIdAndDeviceUid(UUID tenantId, String deviceUid);

    Optional<DeviceEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    long countByTenantIdAndStatus(UUID tenantId, String status);

    @Query("""
            SELECT COUNT(d)
              FROM DeviceEntity d, com.omega.platform.domain.TenantEntity t
             WHERE d.tenantId = t.id
               AND t.active = true
               AND COALESCE(t.billingTenantId, t.id) = :billingTenantId
               AND d.status = :status
            """)
    long countActiveInBillingAccount(
            @Param("billingTenantId") UUID billingTenantId,
            @Param("status") String status
    );
}
