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
@RequestMapping({"/api/v1/forensics", "/api/v1/forensic"})
public class ForensicController {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.CreditService credits;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.AccountAccessService accountAccess;

    private void requireManager(OmegaPrincipal principal) {
        if(accountAccess!=null) accountAccess.requireManager(principal);
        else if(principal==null || principal.role()!=com.omega.platform.security.Role.ADMIN)
            throw new org.springframework.security.access.AccessDeniedException("Solo el titular o un administrador puede gestionar este equipo.");
    }

    private final ForensicBridgeService forensicBridgeService;

    public ForensicController(ForensicBridgeService forensicBridgeService) {
        this.forensicBridgeService = forensicBridgeService;
    }

    @PostMapping("/containment/challenge")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> containmentChallenge(@AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody com.omega.platform.integration.forensic.ForensicWorkerContracts.ContainmentCredentials credentials) {
        requireManager(principal);
        return forensicBridgeService.containmentChallenge(principal, credentials.currentPassword());
    }

    @PostMapping("/containment/execute")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> executeContainment(@AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody com.omega.platform.integration.forensic.ForensicWorkerContracts.ContainmentRequest request) {
        requireManager(principal);
        return forensicBridgeService.executeContainment(principal, request);
    }

    @PostMapping("/containment/rollback/{actionId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> rollbackContainment(@AuthenticationPrincipal OmegaPrincipal principal, @PathVariable String actionId,
            @Valid @RequestBody com.omega.platform.integration.forensic.ForensicWorkerContracts.ContainmentCredentials credentials) {
        requireManager(principal);
        return forensicBridgeService.rollbackContainment(principal, actionId, credentials);
    }

    @GetMapping("/containment/history")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> containmentHistory(@AuthenticationPrincipal OmegaPrincipal principal) {
        requireManager(principal);
        return forensicBridgeService.containmentHistory(principal);
    }

    @GetMapping("/host/realtime/status")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeStatus hostStatus(
            @AuthenticationPrincipal OmegaPrincipal principal) {
        requireManager(principal);
        return forensicBridgeService.hostRealtimeStatus(principal);
    }

    @PostMapping("/host/realtime/toggle")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeStatus toggleHost(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestBody @Valid com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeToggleRequest request) {
        requireManager(principal);
        return forensicBridgeService.toggleHostRealtime(principal, request.enabled());
    }

    @PostMapping("/host/persistence/audit")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public com.omega.platform.integration.forensic.ForensicWorkerContracts.PersistenceAuditResponse hostPersistence(
            @AuthenticationPrincipal OmegaPrincipal principal) {
        requireManager(principal);
        return forensicBridgeService.auditHostPersistence(principal);
    }

    @PostMapping(value = "/triage", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.FORENSIC_STANDARD)
    public ParallelTriageResponse parallelTriage(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID expedienteId,
            @RequestPart("files") List<MultipartFile> files
    ) {
        return forensicBridgeService.runParallelTriage(principal, expedienteId, files);
    }

    @PostMapping("/link/verify")
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.LINK_VERIFY)
    public LinkVerifyResponse verifyLink(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody VerifyLinkRequest request
    ) {
        return forensicBridgeService.verifyLink(principal, request.expedienteId(), request.url(), request.activeProbe());
    }

    @PostMapping(value = "/yara/scan", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.YARA_SCAN)
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
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.FORENSIC_STANDARD)
    public Map<String, Object> triageLiveDevice(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID expedienteId,
            @RequestBody Map<String, Object> payload
    ) {
        return forensicBridgeService.runLiveDeviceTriage(principal, expedienteId, payload);
    }

    @PostMapping("/triage/pc-live")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.FORENSIC_DEEP)
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

    @GetMapping("/mobile/devices")
    public Map<String, Object> listMobileDevices() {
        return forensicBridgeService.listMobileUsbDevices();
    }

    @PostMapping("/mobile/audit")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> startMobileAudit(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody MobileAuditRequest request
    ) {
        boolean metered = credits != null && credits.enforced();
        UUID reservation = !metered ? null : credits.reserve(principal.tenantId(),principal.userId(),
                com.omega.platform.billing.CreditOperation.FORENSIC_STANDARD,15,null);
        Map<String,Object> result;
        try { result = forensicBridgeService.startMobileUsbAudit(
                principal,
                request.platform(),
                request.deviceId(),
                request.backupPassword(),
                Boolean.TRUE.equals(request.asyncMode())
        ); } catch (RuntimeException ex) {
            if (metered) credits.settle(principal.tenantId(),reservation,0);
            throw ex;
        }
        if(metered) {
            String status=String.valueOf(result.getOrDefault("status",""));
            if("COMPLETED".equalsIgnoreCase(status)) credits.settle(principal.tenantId(),reservation,15);
            else if(result.get("jobId") != null) {
                credits.attachReference(principal.tenantId(),reservation,"mobile:"+result.get("jobId"));
                credits.settleMobile(principal.tenantId(),result.get("jobId").toString(),status);
            } else credits.settle(principal.tenantId(),reservation,0);
        }
        return result;
    }

    @GetMapping("/mobile/audit/{jobId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> getMobileAuditStatus(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable String jobId
    ) {
        Map<String,Object> result=forensicBridgeService.getMobileUsbAuditJob(principal, jobId);
        if(credits!=null) credits.settleMobile(principal.tenantId(),jobId,String.valueOf(result.getOrDefault("status","")));
        return result;
    }

    public record MobileAuditRequest(
            @NotBlank String platform,
            @JsonProperty("device_id") @NotBlank String deviceId,
            @JsonProperty("backup_password") String backupPassword,
            @JsonProperty("async_mode") Boolean asyncMode
    ) {
    }

    public record VerifyLinkRequest(@NotBlank String url, UUID expedienteId, boolean activeProbe) {
    }

    public record IocTextRequest(
            @JsonProperty("indicators_text") @NotBlank @Size(min = 3) String indicatorsText,
            UUID expedienteId
    ) {
    }
}
