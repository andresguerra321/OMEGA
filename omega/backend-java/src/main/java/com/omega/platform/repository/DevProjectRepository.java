package com.omega.platform.repository;

import com.omega.platform.domain.DevProjectEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DevProjectRepository extends JpaRepository<DevProjectEntity, UUID> {
    List<DevProjectEntity> findAllByTenantIdOrderByUpdatedAtDesc(UUID tenantId);
    Optional<DevProjectEntity> findByIdAndTenantId(UUID id, UUID tenantId);
    Optional<DevProjectEntity> findByTenantIdAndSlug(UUID tenantId, String slug);
    long deleteByIdAndTenantId(UUID id, UUID tenantId);
}
