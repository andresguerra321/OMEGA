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

    @Query(value = """
            SELECT a.* FROM omega_rag.audit_logs a WHERE a.tenant_id = :tenantId
            AND ((a.resource_type = 'EXPEDIENTE' AND a.resource_id = :caseId)
             OR (a.resource_type = 'DOCUMENT' AND CAST(a.metadata_json AS jsonb)->>'expedienteId' = :caseId))
            ORDER BY a.chain_seq DESC
            """, countQuery = """
            SELECT count(*) FROM omega_rag.audit_logs a WHERE a.tenant_id = :tenantId
            AND ((a.resource_type = 'EXPEDIENTE' AND a.resource_id = :caseId)
             OR (a.resource_type = 'DOCUMENT' AND CAST(a.metadata_json AS jsonb)->>'expedienteId' = :caseId))
            """, nativeQuery = true)
    org.springframework.data.domain.Page<AuditLogEntity> findCaseActivity(
            @Param("tenantId") UUID tenantId, @Param("caseId") String caseId, Pageable pageable);

    @Query(value = "SELECT pg_advisory_xact_lock(hashtextextended(:tenantKey, 0))", nativeQuery = true)
    void lockTenantChain(@Param("tenantKey") String tenantKey);

    Optional<AuditLogEntity> findFirstByTenantIdOrderByChainSeqDesc(UUID tenantId);

    List<AuditLogEntity> findAllByTenantIdOrderByChainSeqAsc(UUID tenantId);

    List<AuditLogEntity> findAllByTenantIdOrderByChainSeqDesc(UUID tenantId, Pageable pageable);
}
