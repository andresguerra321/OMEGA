package com.omega.platform.repository;

import com.omega.platform.domain.RepoScanUsageEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RepoScanUsageRepository extends JpaRepository<RepoScanUsageEntity, UUID> {

    Optional<RepoScanUsageEntity> findByTenantIdAndPeriodYm(UUID tenantId, String periodYm);
}
