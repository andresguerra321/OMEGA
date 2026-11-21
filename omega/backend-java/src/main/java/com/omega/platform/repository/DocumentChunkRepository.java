package com.omega.platform.repository;

import com.omega.platform.domain.DocumentChunkEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentChunkRepository extends JpaRepository<DocumentChunkEntity, UUID> {

    List<DocumentChunkEntity> findAllByTenantIdAndDocumentIdAndPageNumberOrderByChunkOrderAsc(UUID tenantId, UUID documentId, int pageNumber);

    long countByTenantIdAndDocumentId(UUID tenantId, UUID documentId);

    List<DocumentChunkEntity> findAllByTenantIdAndDocumentIdOrderByChunkOrderAsc(UUID tenantId, UUID documentId);
}
