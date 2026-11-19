package com.omega.platform.saas;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AlertDispatchRepository extends JpaRepository<AlertDispatchEntity, UUID> {

    List<AlertDispatchEntity> findTop20ByTenantIdOrderByCreatedAtDesc(UUID tenantId);
}
