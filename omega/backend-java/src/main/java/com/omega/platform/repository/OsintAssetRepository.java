package com.omega.platform.repository;

import com.omega.platform.domain.OsintMonitoredAssetEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OsintAssetRepository extends JpaRepository<OsintMonitoredAssetEntity, UUID> {

    List<OsintMonitoredAssetEntity> findAllByTenantIdAndUserIdOrderByConsentedAtDesc(UUID tenantId, UUID userId);

    Optional<OsintMonitoredAssetEntity> findByIdAndTenantIdAndUserId(UUID id, UUID tenantId, UUID userId);

    boolean existsByTenantIdAndUserIdAndAssetValue(UUID tenantId, UUID userId, String assetValue);
}
