package com.omega.platform.repository;

import com.omega.platform.domain.ApiTokenEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApiTokenRepository extends JpaRepository<ApiTokenEntity, UUID> {

    Optional<ApiTokenEntity> findByTokenHash(String tokenHash);

    Optional<ApiTokenEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<ApiTokenEntity> findAllByTenantIdOrderByCreatedAtDesc(UUID tenantId);
}
