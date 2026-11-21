package com.omega.platform.repository;

import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DocumentRepository extends JpaRepository<DocumentEntity, UUID> {

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT d FROM DocumentEntity d WHERE d.id = :id AND d.tenantId = :tenantId")
    Optional<DocumentEntity> findScopedForUpdate(@Param("id") UUID id, @Param("tenantId") UUID tenantId);

    org.springframework.data.domain.Page<DocumentEntity> findAllByTenantIdAndExpedienteId(
            UUID tenantId, UUID expedienteId, org.springframework.data.domain.Pageable pageable);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE DocumentEntity d SET d.corpusScope = :scope WHERE d.tenantId = :tenantId")
    int retagTenantDocuments(@Param("tenantId") UUID tenantId, @Param("scope") String scope);

    Optional<DocumentEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<DocumentEntity> findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(UUID tenantId, UUID expedienteId);

    long countByTenantIdAndExpedienteIdAndStatus(UUID tenantId, UUID expedienteId, DocumentStatus status);
}
