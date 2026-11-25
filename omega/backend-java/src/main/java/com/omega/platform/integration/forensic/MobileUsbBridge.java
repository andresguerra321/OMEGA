package com.omega.platform.integration.forensic;

import com.omega.platform.integration.forensic.ForensicWorkerContracts.MobileUsbAuditWorkerRequest;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClientException;

/**
 * Cliente especializado para auditoría forense móvil USB (iOS/Android) con
 * registro de auditoría estrictamente libre de PII/artefactos.
 */
@Service
public class MobileUsbBridge {
    @Autowired(required=false)
    private com.omega.platform.service.AnalysisEvidenceService evidence;

    private final ForensicWorkerTransport transport;
    private final AuditLogService auditLogService;

    @Autowired
    public MobileUsbBridge(
            ForensicWorkerTransport transport,
            AuditLogService auditLogService) {
        this.transport = transport;
        this.auditLogService = auditLogService;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> listMobileUsbDevices() {
        try {
            Map<String, Object> response = transport.workerClient().get()
                    .uri("/api/mobile/usb/devices")
                    .retrieve()
                    .body(ForensicWorkerTransport.MAP_TYPE);
            return response != null ? response : Map.of("status", "EMPTY", "devices", List.of());
        } catch (RestClientException ex) {
            throw ForensicWorkerTransport.translateWorkerException(ex, "detección USB móvil", false);
        }
    }

    @Transactional
    public Map<String, Object> startMobileUsbAudit(
            OmegaPrincipal principal,
            String platform,
            String deviceId,
            String backupPassword,
            boolean asyncMode) {
        MobileUsbAuditWorkerRequest req = new MobileUsbAuditWorkerRequest(
                platform,
                deviceId,
                backupPassword,
                asyncMode);
        Map<String, Object> response = transport.postJsonToWorkerMap(
                "/api/mobile/usb/audit",
                req,
                "auditoría USB móvil",
                true);
        recordMobileUsbAuditIfCompleted(principal, response);
        return response;
    }

    @Transactional
    public Map<String, Object> getMobileUsbAuditJob(OmegaPrincipal principal, String jobId) {
        Map<String, Object> response = transport.getMapFromWorker(
                "/api/mobile/usb/audit/{jobId}",
                jobId,
                "estado de auditoría USB móvil");
        recordMobileUsbAuditIfCompleted(principal, response);
        return response;
    }

    @SuppressWarnings("unchecked")
    private void recordMobileUsbAuditIfCompleted(OmegaPrincipal principal, Map<String, Object> jobResponse) {
        if (principal == null || jobResponse == null) {
            return;
        }
        String status = String.valueOf(jobResponse.getOrDefault("status", ""));
        Object resultObj = jobResponse.get("result");
        if (!"COMPLETED".equalsIgnoreCase(status) || !(resultObj instanceof Map<?, ?> rawResult)) {
            return;
        }
        Map<String, Object> res = (Map<String, Object>) rawResult;
        String platform = String.valueOf(res.getOrDefault("platform", "IOS"));
        String modelHash = String.valueOf(res.getOrDefault("deviceModelHash", "unknown"));
        int findingsCount = res.get("findingsCount") instanceof Number n ? n.intValue() : 0;
        String riskLevel = String.valueOf(res.getOrDefault("riskLevel", "LOW"));

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("platform", platform);
        meta.put("deviceModelHash", modelHash);
        meta.put("findingsCount", findingsCount);
        meta.put("riskLevel", riskLevel);
        meta.put("zeroRetentionWiped", true);

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_MOBILE_USB_AUDITED",
                "MOBILE_USB",
                modelHash,
                meta);
        if(evidence!=null) evidence.record(principal,null,"MOBILE_USB",res,
            jobResponse.get("jobId")==null?null:jobResponse.get("jobId").toString());
    }
}
