package com.omega.platform.repository;

import com.omega.platform.domain.GitHubAppInstallationEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GitHubAppInstallationRepository extends JpaRepository<GitHubAppInstallationEntity, UUID> {

    Optional<GitHubAppInstallationEntity> findByTenantId(UUID tenantId);

    Optional<GitHubAppInstallationEntity> findByInstallationId(long installationId);
}
