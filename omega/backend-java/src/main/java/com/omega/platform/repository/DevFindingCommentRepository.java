package com.omega.platform.repository;

import com.omega.platform.domain.DevFindingCommentEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevFindingCommentRepository extends JpaRepository<DevFindingCommentEntity, UUID> {
    List<DevFindingCommentEntity> findAllByTenantIdAndFindingIdOrderByCreatedAtAsc(UUID tenantId, UUID findingId);
    long countByTenantIdAndFindingId(UUID tenantId, UUID findingId);
}
