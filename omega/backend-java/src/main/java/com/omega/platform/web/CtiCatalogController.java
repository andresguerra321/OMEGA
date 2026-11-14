package com.omega.platform.web;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.cti.CtiDossierService;
import com.omega.platform.cti.CtiDossierService.CampaignDossierDto;
import com.omega.platform.cti.CtiDossierService.CampaignListResponse;
import com.omega.platform.cti.PublicCorpusRagService;
import com.omega.platform.cti.PublicCorpusRagService.PublicCtiQueryRequest;
import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.cti.StixCatalogService.StixSyncSummary;
import com.omega.platform.cti.WebIntelExtractorService;
import com.omega.platform.cti.WebIntelExtractorService.WebIntelScanResponse;
import com.omega.platform.domain.IocIndicatorEntity;
import com.omega.platform.rag.HybridRagQueryService.RagQueryResponse;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/cti")
public class CtiCatalogController {

    private final StixCatalogService stixCatalogService;
    private final CtiDossierService ctiDossierService;
    private final PublicCorpusRagService publicCorpusRagService;
    private final WebIntelExtractorService webIntelExtractorService;
    private final AuditLogService auditLogService;

    public CtiCatalogController(
            StixCatalogService stixCatalogService,
            CtiDossierService ctiDossierService,
            PublicCorpusRagService publicCorpusRagService,
            WebIntelExtractorService webIntelExtractorService,
            AuditLogService auditLogService
    ) {
        this.stixCatalogService = stixCatalogService;
        this.ctiDossierService = ctiDossierService;
        this.publicCorpusRagService = publicCorpusRagService;
        this.webIntelExtractorService = webIntelExtractorService;
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
    public CampaignListResponse campaigns() {
        return ctiDossierService.listCampaignSummaries();
    }

    @GetMapping("/campaigns/{campaignId}")
    public CampaignDossierDto campaignDetail(@PathVariable UUID campaignId) {
        return ctiDossierService.getCampaignDossier(campaignId);
    }

    @PostMapping("/query")
    public RagQueryResponse queryPublicCorpus(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody PublicCtiQueryRequest request
    ) {
        return publicCorpusRagService.queryPublicCorpus(principal, request);
    }

    @PostMapping("/webloader-scan")
    public WebIntelScanResponse scanWebIntel(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody WebIntelScanRequest request
    ) {
        return webIntelExtractorService.scanUrlEphemerally(
                principal,
                request.url(),
                request.activeNet4Ips()
        );
    }

    @GetMapping("/indicators/lookup")
    public List<IocLookupDto> lookup(@RequestParam String value) {
        return stixCatalogService.lookupIndicator(value).stream()
                .map(IocLookupDto::fromEntity)
                .toList();
    }

    public record WebIntelScanRequest(
            @NotBlank String url,
            @JsonProperty("active_net4_ips") List<String> activeNet4Ips
    ) {
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
