package com.omega.platform.repository;

import com.omega.platform.domain.GitHubOAuthStateEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GitHubOAuthStateRepository extends JpaRepository<GitHubOAuthStateEntity, String> {

    Optional<GitHubOAuthStateEntity> findByStateTokenAndTenantIdAndUserId(
            String stateToken,
            UUID tenantId,
            UUID userId
    );
}
