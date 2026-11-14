package com.omega.platform.repository;

import com.omega.platform.domain.CampaignEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CampaignRepository extends JpaRepository<CampaignEntity, UUID> {

    Optional<CampaignEntity> findByExternalStixId(String externalStixId);

    List<CampaignEntity> findAllByOrderByCreatedAtDesc();
}
