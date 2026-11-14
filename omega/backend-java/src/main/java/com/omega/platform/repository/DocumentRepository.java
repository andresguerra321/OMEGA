package com.omega.platform.repository;

import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentRepository extends JpaRepository<DocumentEntity, UUID> {

    Optional<DocumentEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<DocumentEntity> findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(UUID tenantId, UUID expedienteId);

    long countByTenantIdAndExpedienteIdAndStatus(UUID tenantId, UUID expedienteId, DocumentStatus status);
}
