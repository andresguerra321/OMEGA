package com.omega.platform.repository;

import com.omega.platform.domain.RepoScanUsageEntity;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RepoScanUsageRepository extends JpaRepository<RepoScanUsageEntity, UUID> {

    Optional<RepoScanUsageEntity> findByTenantIdAndPeriodYm(UUID tenantId, String periodYm);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE RepoScanUsageEntity u
               SET u.scansUsed = u.scansUsed + 1,
                   u.updatedAt = :now
             WHERE u.tenantId = :tenantId
               AND u.periodYm = :periodYm
               AND u.scansUsed < :quota
            """)
    int incrementScansUsedAtomically(
            @Param("tenantId") UUID tenantId,
            @Param("periodYm") String periodYm,
            @Param("quota") int quota,
            @Param("now") Instant now);
}
