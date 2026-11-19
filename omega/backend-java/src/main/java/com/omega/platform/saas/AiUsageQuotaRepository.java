package com.omega.platform.saas;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiUsageQuotaRepository extends JpaRepository<AiUsageQuotaEntity, UUID> {

    Optional<AiUsageQuotaEntity> findByTenantIdAndUserIdAndPeriodYm(UUID tenantId, UUID userId, String periodYm);
}
