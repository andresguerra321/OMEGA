package com.omega.platform.web;

import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.cti.StixCatalogService.StixSyncSummary;
import com.omega.platform.domain.CampaignEntity;
import com.omega.platform.domain.IocIndicatorEntity;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/cti")
public class CtiCatalogController {

    private final StixCatalogService stixCatalogService;
    private final AuditLogService auditLogService;

    public CtiCatalogController(StixCatalogService stixCatalogService, AuditLogService auditLogService) {
        this.stixCatalogService = stixCatalogService;
        this.auditLogService = auditLogService;
    }

    @PostMapping("/stix/sync")
    @PreAuthorize("hasRole('ADMIN')")
    public StixSyncSummary syncStix(@AuthenticationPrincipal OmegaPrincipal principal) {
        StixSyncSummary summary = stixCatalogService.syncConfiguredDirectory();
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "STIX_CATALOG_SYNCED",
                "CTI_CATALOG",
                "stix2",
                Map.of(
                        "filesScanned", summary.filesScanned(),
                        "indicatorsParsed", summary.indicatorsParsed(),
                        "netInserted", summary.netIndicatorsInserted(),
                        "totalIndicators", summary.totalIndicatorsInCatalog()
                )
        );
        return summary;
    }

    @GetMapping("/campaigns")
    public List<CampaignDto> campaigns() {
        return stixCatalogService.listCampaigns().stream()
                .map(CampaignDto::fromEntity)
                .toList();
    }

    @GetMapping("/indicators/lookup")
    public List<IocLookupDto> lookup(@RequestParam String value) {
        return stixCatalogService.lookupIndicator(value).stream()
                .map(IocLookupDto::fromEntity)
                .toList();
    }

    public record CampaignDto(
            UUID id,
            String name,
            String spywareFamily,
            String suspectedActor,
            String sourceFeed,
            Instant createdAt
    ) {
        static CampaignDto fromEntity(CampaignEntity e) {
            return new CampaignDto(
                    e.getId(),
                    e.getName(),
                    e.getSpywareFamily(),
                    e.getSuspectedActor(),
                    e.getSourceFeed(),
                    e.getCreatedAt()
            );
        }
    }

    public record IocLookupDto(
            UUID id,
            UUID campaignId,
            String iocType,
            String iocValue,
            String sourceReport,
            String organization
    ) {
        static IocLookupDto fromEntity(IocIndicatorEntity e) {
            return new IocLookupDto(
                    e.getId(),
                    e.getCampaignId(),
                    e.getIocType(),
                    e.getIocValue(),
                    e.getSourceReport(),
                    e.getOrganization()
            );
        }
    }
}
