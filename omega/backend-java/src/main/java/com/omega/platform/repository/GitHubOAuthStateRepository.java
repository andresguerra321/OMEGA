package com.omega.platform.repository;

import com.omega.platform.domain.GitHubOAuthStateEntity;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface GitHubOAuthStateRepository extends JpaRepository<GitHubOAuthStateEntity, String> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<GitHubOAuthStateEntity> findByStateTokenAndTenantIdAndUserId(
            String stateToken,
            UUID tenantId,
            UUID userId
    );
}
