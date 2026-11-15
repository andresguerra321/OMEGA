package com.omega.platform.repository;

import com.omega.platform.domain.UserEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<UserEntity, UUID> {

    Optional<UserEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    Optional<UserEntity> findByTenantIdAndEmailIgnoreCase(UUID tenantId, String email);

    boolean existsByTenantIdAndEmailIgnoreCase(UUID tenantId, String email);

    @Query("""
            SELECT CASE WHEN COUNT(u) > 0 THEN true ELSE false END
            FROM UserEntity u
            WHERE LOWER(u.email) = LOWER(:email)
            """)
    boolean existsAnyByEmailIgnoreCase(@Param("email") String email);

    @Query("""
            SELECT u FROM UserEntity u
            JOIN TenantEntity t ON t.id = u.tenantId
            WHERE LOWER(u.email) = LOWER(:email)
              AND u.active = true
              AND t.active = true
            ORDER BY u.createdAt DESC
            """)
    List<UserEntity> findAllActiveByEmailIgnoreCase(@Param("email") String email);

    List<UserEntity> findAllByTenantIdOrderByCreatedAtAsc(UUID tenantId);

    @Query("""
            SELECT u FROM UserEntity u
            JOIN TenantEntity t ON t.id = u.tenantId
            WHERE u.id = :userId
              AND u.tenantId = :tenantId
              AND u.active = true
              AND t.active = true
            """)
    Optional<UserEntity> findActiveUserInActiveTenant(
            @Param("userId") UUID userId,
            @Param("tenantId") UUID tenantId
    );
}
