package com.omega.platform.repository;

import com.omega.platform.domain.OrganizationEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrganizationRepository extends JpaRepository<OrganizationEntity, UUID> {

    Optional<OrganizationEntity> findByIdAndActiveTrue(UUID id);

    Optional<OrganizationEntity> findByBillingTenantIdAndActiveTrue(UUID billingTenantId);

    Optional<OrganizationEntity> findBySlugAndActiveTrue(String slug);

    boolean existsBySlug(String slug);
}
