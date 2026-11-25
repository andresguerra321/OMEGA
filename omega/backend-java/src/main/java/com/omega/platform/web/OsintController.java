package com.omega.platform.web;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.OsintExposureService;
import com.omega.platform.service.OsintExposureService.AssetDto;
import com.omega.platform.service.OsintExposureService.AssetListResponse;
import com.omega.platform.service.OsintExposureService.OsintScanReport;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Endpoints multi-tenant de monitoreo OSINT pasivo sobre activos autorizados (RNF8).
 */
@RestController
@RequestMapping("/api/v1/osint")
public class OsintController {

    private final OsintExposureService osintExposureService;

    public OsintController(OsintExposureService osintExposureService) {
        this.osintExposureService = osintExposureService;
    }

    @GetMapping("/assets")
    public AssetListResponse listAssets(@AuthenticationPrincipal OmegaPrincipal principal) {
        return osintExposureService.listAssets(principal);
    }

    @PostMapping("/assets")
    @ResponseStatus(HttpStatus.CREATED)
    public AssetDto registerAsset(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody CreateOsintAssetRequest request
    ) {
        return osintExposureService.registerAsset(
                principal,
                request.assetType(),
                request.assetValue(),
                Boolean.TRUE.equals(request.explicitConsent())
        );
    }

    @PostMapping("/assets/{assetId}/scan")
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.LINK_VERIFY)
    public OsintScanReport scanAsset(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID assetId
    ) {
        return osintExposureService.scanAsset(principal, assetId);
    }

    @DeleteMapping("/assets/{assetId}")
    public Map<String, Object> revokeAsset(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID assetId
    ) {
        return osintExposureService.revokeAsset(principal, assetId);
    }

    public record CreateOsintAssetRequest(
            @JsonProperty("asset_type") @NotBlank String assetType,
            @JsonProperty("asset_value") @NotBlank String assetValue,
            @JsonProperty("explicit_consent") Boolean explicitConsent
    ) {
    }
}
