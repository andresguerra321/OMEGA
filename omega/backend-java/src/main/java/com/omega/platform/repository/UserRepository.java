package com.omega.platform.repository;

import com.omega.platform.domain.UserEntity;
import com.omega.platform.security.Role;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<UserEntity, UUID> {

    interface AuthenticatedWorkspaceMember {
        UUID getUserId();
        UUID getTenantId();
        String getEmail();
        Role getRole();
        boolean isActive();
    }

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
            SELECT u.id AS userId,
                   wm.tenantId AS tenantId,
                   u.email AS email,
                   wm.role AS role,
                   true AS active
              FROM UserEntity u
              JOIN WorkspaceMembershipEntity wm ON wm.userId = u.id
              JOIN TenantEntity t ON t.id = wm.tenantId
             WHERE u.id = :userId
               AND wm.tenantId = :tenantId
               AND u.active = true
               AND t.active = true
               AND wm.active = true
            """)
    Optional<AuthenticatedWorkspaceMember> findActiveWorkspaceMember(
            @Param("userId") UUID userId,
            @Param("tenantId") UUID tenantId
    );

    @Query("""
            SELECT wm.role
              FROM WorkspaceMembershipEntity wm
              JOIN UserEntity u ON u.id = wm.userId
              JOIN TenantEntity t ON t.id = wm.tenantId
             WHERE wm.userId = :userId
               AND wm.tenantId = :tenantId
               AND u.active = true
               AND t.active = true
               AND wm.active = true
            """)
    Optional<Role> findActiveWorkspaceRole(
            @Param("userId") UUID userId,
            @Param("tenantId") UUID tenantId
    );

    @Query("""
            SELECT u
              FROM UserEntity u
              JOIN WorkspaceMembershipEntity wm ON wm.userId = u.id
              JOIN TenantEntity t ON t.id = wm.tenantId
             WHERE wm.tenantId = :tenantId
               AND LOWER(u.email) = LOWER(:email)
               AND u.active = true
               AND t.active = true
               AND wm.active = true
            """)
    Optional<UserEntity> findActiveMemberUserByTenantIdAndEmailIgnoreCase(
            @Param("tenantId") UUID tenantId,
            @Param("email") String email
    );
}
