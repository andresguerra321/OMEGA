package com.omega.platform.repository;

import com.omega.platform.domain.ApiTokenEntity;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApiTokenRepository extends JpaRepository<ApiTokenEntity, UUID> {

    Optional<ApiTokenEntity> findByTokenHash(String tokenHash);

    Optional<ApiTokenEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<ApiTokenEntity> findAllByTenantIdOrderByCreatedAtDesc(UUID tenantId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE ApiTokenEntity t
               SET t.usesCount = t.usesCount + 1,
                   t.lastUsedAt = :now
             WHERE t.id = :id
               AND t.tenantId = :tenantId
               AND t.revokedAt IS NULL
               AND (t.expiresAt IS NULL OR t.expiresAt > :now)
               AND (t.maxUses IS NULL OR t.usesCount < t.maxUses)
            """)
    int incrementUseAtomically(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId,
            @Param("now") Instant now);
}
