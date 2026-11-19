package com.omega.platform.integration.forensic;

import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.ParallelTriageResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.PersistenceAuditResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeStatus;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraRuleResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraScanResponse;
import com.omega.platform.security.ContainmentAuthorizationService;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.multipart.MultipartFile;

/**
 * Fachada orquestadora hacia los 4 clientes especializados del puente forense:
 * {@link HostSensorBridge}, {@link ContainmentBridge}, {@link MobileUsbBridge}
 * y {@link MvtTriageBridge}.
 */
@Service
public class ForensicBridgeService {

    private final HostSensorBridge hostSensorBridge;
    private final ContainmentBridge containmentBridge;
    private final MobileUsbBridge mobileUsbBridge;
    private final MvtTriageBridge mvtTriageBridge;

    @Autowired
    public ForensicBridgeService(
            HostSensorBridge hostSensorBridge,
            ContainmentBridge containmentBridge,
            MobileUsbBridge mobileUsbBridge,
            MvtTriageBridge mvtTriageBridge) {
        this.hostSensorBridge = hostSensorBridge;
        this.containmentBridge = containmentBridge;
        this.mobileUsbBridge = mobileUsbBridge;
        this.mvtTriageBridge = mvtTriageBridge;
    }

    public ForensicBridgeService(
            RestClient forensicWorkerRestClient,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService) {
        this(forensicWorkerRestClient, archiveSecurityValidator, authorizationService, auditLogService, null);
    }

    public ForensicBridgeService(
            RestClient forensicWorkerRestClient,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService,
            StixCatalogService stixCatalogService) {
        ForensicWorkerTransport transport = new ForensicWorkerTransport(forensicWorkerRestClient, stixCatalogService);
        HostSensorBridge hostBridge = new HostSensorBridge(transport, auditLogService);
        this.hostSensorBridge = hostBridge;
        this.containmentBridge = new ContainmentBridge(hostBridge, authorizationService, auditLogService);
        this.mobileUsbBridge = new MobileUsbBridge(transport, auditLogService);
        this.mvtTriageBridge = new MvtTriageBridge(transport, archiveSecurityValidator, authorizationService, auditLogService);
    }

    public void setContainmentAuthorization(ContainmentAuthorizationService authorization) {
        containmentBridge.setContainmentAuthorization(authorization);
    }

    public void setHostWorkerRestClient(@Qualifier("hostWorkerRestClient") RestClient client) {
        hostSensorBridge.setHostWorkerRestClient(client);
    }

    // ---- HostSensorBridge ----

    public void refreshHostCatalogInBackground() {
        hostSensorBridge.refreshHostCatalogInBackground();
    }

    public RealtimeStatus hostRealtimeStatus(OmegaPrincipal principal) {
        return hostSensorBridge.hostRealtimeStatus(principal);
    }

    public RealtimeStatus toggleHostRealtime(OmegaPrincipal principal, boolean enabled) {
        return hostSensorBridge.toggleHostRealtime(principal, enabled);
    }

    public PersistenceAuditResponse auditHostPersistence(OmegaPrincipal principal) {
        return hostSensorBridge.auditHostPersistence(principal);
    }

    // ---- ContainmentBridge ----

    public Map<String, Object> containmentChallenge(OmegaPrincipal principal, String password) {
        return containmentBridge.containmentChallenge(principal, password);
    }

    public Map<String, Object> executeContainment(
            OmegaPrincipal principal,
            ForensicWorkerContracts.ContainmentRequest request) {
        return containmentBridge.executeContainment(principal, request);
    }

    public Map<String, Object> rollbackContainment(
            OmegaPrincipal principal,
            String actionId,
            ForensicWorkerContracts.ContainmentCredentials credentials) {
        return containmentBridge.rollbackContainment(principal, actionId, credentials);
    }

    public Map<String, Object> containmentHistory(OmegaPrincipal principal) {
        return containmentBridge.containmentHistory(principal);
    }

    // ---- MobileUsbBridge ----

    public Map<String, Object> listMobileUsbDevices() {
        return mobileUsbBridge.listMobileUsbDevices();
    }

    public Map<String, Object> startMobileUsbAudit(
            OmegaPrincipal principal,
            String platform,
            String deviceId,
            String backupPassword,
            boolean asyncMode) {
        return mobileUsbBridge.startMobileUsbAudit(principal, platform, deviceId, backupPassword, asyncMode);
    }

    public Map<String, Object> getMobileUsbAuditJob(OmegaPrincipal principal, String jobId) {
        return mobileUsbBridge.getMobileUsbAuditJob(principal, jobId);
    }

    // ---- MvtTriageBridge ----

    public ParallelTriageResponse runParallelTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            List<MultipartFile> files) {
        return mvtTriageBridge.runParallelTriage(principal, expedienteId, files);
    }

    public LinkVerifyResponse verifyLink(OmegaPrincipal principal, UUID expedienteId, String rawUrl) {
        return mvtTriageBridge.verifyLink(principal, expedienteId, rawUrl, false);
    }

    public LinkVerifyResponse verifyLink(
            OmegaPrincipal principal,
            UUID expedienteId,
            String rawUrl,
            boolean activeProbe) {
        return mvtTriageBridge.verifyLink(principal, expedienteId, rawUrl, activeProbe);
    }

    public YaraScanResponse scanArtifactsYara(
            OmegaPrincipal principal,
            UUID expedienteId,
            List<MultipartFile> files) {
        return mvtTriageBridge.scanArtifactsYara(principal, expedienteId, files);
    }

    public YaraRuleResponse exportCampaignYaraRule(String campaignId) {
        return mvtTriageBridge.exportCampaignYaraRule(campaignId);
    }

    public Map<String, Object> verifyIocFile(
            OmegaPrincipal principal,
            UUID expedienteId,
            MultipartFile file) {
        return mvtTriageBridge.verifyIocFile(principal, expedienteId, file);
    }

    public Map<String, Object> verifyIocText(
            OmegaPrincipal principal,
            UUID expedienteId,
            String indicatorsText) {
        return mvtTriageBridge.verifyIocText(principal, expedienteId, indicatorsText);
    }

    public Map<String, Object> runLiveDeviceTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            Map<String, Object> payload) {
        return mvtTriageBridge.runLiveDeviceTriage(principal, expedienteId, payload);
    }

    public Map<String, Object> runPcLiveTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            Map<String, Object> payload) {
        return mvtTriageBridge.runPcLiveTriage(principal, expedienteId, payload);
    }

    public Map<String, Object> resolveIosManifestTargets(
            OmegaPrincipal principal,
            MultipartFile manifest) {
        return mvtTriageBridge.resolveIosManifestTargets(principal, manifest);
    }

    public Map<String, Object> decryptIosManifestTargets(
            OmegaPrincipal principal,
            MultipartFile manifestPlist,
            MultipartFile manifestDb,
            String password) {
        return mvtTriageBridge.decryptIosManifestTargets(principal, manifestPlist, manifestDb, password);
    }

    public Map<String, Object> exportCampaignMvtScript(String campaignId) {
        return mvtTriageBridge.exportCampaignMvtScript(campaignId);
    }
}
