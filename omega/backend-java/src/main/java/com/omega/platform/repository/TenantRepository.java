package com.omega.platform.repository;

import com.omega.platform.domain.TenantEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantRepository extends JpaRepository<TenantEntity, UUID> {

    Optional<TenantEntity> findBySlugAndActiveTrue(String slug);

    Optional<TenantEntity> findByIdAndActiveTrue(UUID id);

    boolean existsBySlug(String slug);
}
