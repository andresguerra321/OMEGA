package com.omega.platform.repository;

import com.omega.platform.domain.TenantEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

public interface TenantRepository extends JpaRepository<TenantEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM TenantEntity t WHERE t.id = :tenantId AND t.active = true")
    Optional<TenantEntity> findActiveForUpdate(@Param("tenantId") UUID tenantId);

    Optional<TenantEntity> findBySlugAndActiveTrue(String slug);

    Optional<TenantEntity> findByIdAndActiveTrue(UUID id);

    boolean existsBySlug(String slug);
}
