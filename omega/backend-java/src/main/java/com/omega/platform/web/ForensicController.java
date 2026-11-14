package com.omega.platform.web;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.integration.forensic.ForensicBridgeService;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.ParallelTriageResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraRuleResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraScanResponse;
import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/forensics")
public class ForensicController {

    private final ForensicBridgeService forensicBridgeService;

    public ForensicController(ForensicBridgeService forensicBridgeService) {
        this.forensicBridgeService = forensicBridgeService;
    }

    @PostMapping(value = "/triage", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ParallelTriageResponse parallelTriage(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID expedienteId,
            @RequestPart("files") List<MultipartFile> files
    ) {
        return forensicBridgeService.runParallelTriage(principal, expedienteId, files);
    }

    @PostMapping("/link/verify")
    public LinkVerifyResponse verifyLink(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody VerifyLinkRequest request
    ) {
        return forensicBridgeService.verifyLink(principal, request.expedienteId(), request.url());
    }

    @PostMapping(value = "/yara/scan", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public YaraScanResponse yaraScan(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID expedienteId,
            @RequestPart("files") List<MultipartFile> files
    ) {
        return forensicBridgeService.scanArtifactsYara(principal, expedienteId, files);
    }

    @GetMapping("/yara/campaigns/{campaignId}")
    public YaraRuleResponse campaignYaraRule(@PathVariable UUID campaignId) {
        return forensicBridgeService.exportCampaignYaraRule(campaignId.toString());
    }

    @PostMapping(value = "/ioc/verify/file", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> verifyIocFile(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID expedienteId,
            @RequestPart("file") MultipartFile file
    ) {
        return forensicBridgeService.verifyIocFile(principal, expedienteId, file);
    }

    @PostMapping("/ioc/verify/text")
    public Map<String, Object> verifyIocText(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody IocTextRequest request
    ) {
        return forensicBridgeService.verifyIocText(principal, request.expedienteId(), request.indicatorsText());
    }

    @PostMapping("/triage/device-live")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> triageLiveDevice(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID expedienteId,
            @RequestBody Map<String, Object> payload
    ) {
        return forensicBridgeService.runLiveDeviceTriage(principal, expedienteId, payload);
    }

    @PostMapping("/triage/pc-live")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> triagePcLive(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID expedienteId,
            @RequestBody Map<String, Object> payload
    ) {
        return forensicBridgeService.runPcLiveTriage(principal, expedienteId, payload);
    }

    @PostMapping(value = "/triage/ios-manifest-targets", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> iosManifestTargets(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestPart("manifest") MultipartFile manifest
    ) {
        return forensicBridgeService.resolveIosManifestTargets(principal, manifest);
    }

    @PostMapping(value = "/triage/ios-manifest-decrypt", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> iosManifestDecrypt(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestPart("manifest_plist") MultipartFile manifestPlist,
            @RequestPart("manifest_db") MultipartFile manifestDb,
            @RequestParam("password") String password
    ) {
        return forensicBridgeService.decryptIosManifestTargets(principal, manifestPlist, manifestDb, password);
    }

    @GetMapping("/campaigns/{campaignId}/mvt-script")
    public Map<String, Object> campaignMvtScript(@PathVariable UUID campaignId) {
        return forensicBridgeService.exportCampaignMvtScript(campaignId.toString());
    }

    public record VerifyLinkRequest(@NotBlank String url, UUID expedienteId) {
    }

    public record IocTextRequest(
            @JsonProperty("indicators_text") @NotBlank @Size(min = 3) String indicatorsText,
            UUID expedienteId
    ) {
    }
}
