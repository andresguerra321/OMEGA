package com.omega.platform.repository;

import com.omega.platform.domain.AuditLogEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditLogRepository extends JpaRepository<AuditLogEntity, UUID> {

    @Query(value = "SELECT pg_advisory_xact_lock(hashtextextended(:tenantKey, 0))", nativeQuery = true)
    void lockTenantChain(@Param("tenantKey") String tenantKey);

    Optional<AuditLogEntity> findFirstByTenantIdOrderByChainSeqDesc(UUID tenantId);

    List<AuditLogEntity> findAllByTenantIdOrderByChainSeqAsc(UUID tenantId);

    List<AuditLogEntity> findAllByTenantIdOrderByChainSeqDesc(UUID tenantId, Pageable pageable);
}
