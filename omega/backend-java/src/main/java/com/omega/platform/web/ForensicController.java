package com.omega.platform.web;

import com.omega.platform.integration.forensic.ForensicBridgeService;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.ParallelTriageResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraRuleResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraScanResponse;
import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
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

    public record VerifyLinkRequest(@NotBlank String url, UUID expedienteId) {
    }
}
