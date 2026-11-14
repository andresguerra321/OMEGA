package com.omega.platform.repository;

import com.omega.platform.domain.IocIndicatorEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface IocIndicatorRepository extends JpaRepository<IocIndicatorEntity, UUID> {

    List<IocIndicatorEntity> findAllByNormalizedValue(String normalizedValue);

    List<IocIndicatorEntity> findAllByCampaignId(UUID campaignId);
}
