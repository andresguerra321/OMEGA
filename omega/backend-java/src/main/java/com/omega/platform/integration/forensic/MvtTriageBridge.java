package com.omega.platform.integration.forensic;

import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkCheckRequest;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.ParallelTriageResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraRuleResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraScanResponse;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.multipart.MultipartFile;

/**
 * Cliente especializado para triaje MVT, escaneo YARA, verificación de enlaces,
 * verificación IOC, volcados iOS Manifest.db y triaje en vivo de dispositivos/PC.
 */
@Service
public class MvtTriageBridge {

    @Autowired(required=false)
    private com.omega.platform.service.AnalysisEvidenceService evidence;
    private final ForensicWorkerTransport transport;
    private final ArchiveSecurityValidator archiveSecurityValidator;
    private final ExpedienteAuthorizationService authorizationService;
    private final AuditLogService auditLogService;

    @Autowired
    public MvtTriageBridge(
            ForensicWorkerTransport transport,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService) {
        this.transport = transport;
        this.archiveSecurityValidator = archiveSecurityValidator;
        this.authorizationService = authorizationService;
        this.auditLogService = auditLogService;
    }

    @Transactional
    public ParallelTriageResponse runParallelTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            List<MultipartFile> files) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(files);

        MultiValueMap<String, Object> body = transport.buildMultipartBody("files", files);
        ParallelTriageResponse rawResponse = transport.postMultipartToWorker(
                "/api/triage/parallel",
                body,
                ParallelTriageResponse.class,
                "triage paralelo");
        ParallelTriageResponse response = enrichParallelTriageResponse(rawResponse);

        Map<String, Object> meta = new LinkedHashMap<>();
        if (expedienteId != null) {
            meta.put("expedienteId", expedienteId.toString());
        }
        meta.put("totalFiles", response.totalFiles());
        meta.put("totalMatches", response.totalMatches());
        meta.put("yaraHitsCount", response.yaraHits() != null ? response.yaraHits().size() : 0);
        meta.put("verdictCode", response.diagnosis() != null ? response.diagnosis().verdictCode() : "UNKNOWN");

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_TRIAGE_EXECUTED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_TRIAGE",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
        if(evidence!=null) evidence.record(principal,expedienteId,"TRIAGE_FILES",response);
        return response;
    }

    @Transactional
    public LinkVerifyResponse verifyLink(OmegaPrincipal principal, UUID expedienteId, String rawUrl, boolean activeProbe) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }

        LinkVerifyResponse rawResponse = transport.postJsonToWorker(
                "/api/link/verify",
                new LinkCheckRequest(rawUrl, activeProbe),
                LinkVerifyResponse.class,
                "verificación de enlace");
        LinkVerifyResponse response = enrichLinkVerifyResponse(rawResponse);

        Map<String, Object> meta = new LinkedHashMap<>();
        if (expedienteId != null) {
            meta.put("expedienteId", expedienteId.toString());
        }
        meta.put("normalizedUrl", response.normalizedUrl());
        meta.put("riskLevel", response.riskLevel());
        meta.put("matchesCount", response.ctiMatches() != null ? response.ctiMatches().size() : 0);

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_LINK_VERIFIED",
                "LINK",
                response.host(),
                meta);
        if(evidence!=null) evidence.record(principal,expedienteId,"LINK_VERIFY",response);
        return response;
    }

    @Transactional
    public YaraScanResponse scanArtifactsYara(
            OmegaPrincipal principal,
            UUID expedienteId,
            List<MultipartFile> files) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(files);

        MultiValueMap<String, Object> body = transport.buildMultipartBody("files", files);
        YaraScanResponse response = transport.postMultipartToWorker(
                "/api/yara",
                body,
                YaraScanResponse.class,
                "escaneo YARA");

        Map<String, Object> meta = new LinkedHashMap<>();
        if (expedienteId != null) {
            meta.put("expedienteId", expedienteId.toString());
        }
        meta.put("filesScanned", response.filesScanned());
        meta.put("hitsCount", response.hitsCount());

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_YARA_SCANNED",
                expedienteId != null ? "EXPEDIENTE" : "YARA_SCAN",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
        if(evidence!=null) evidence.record(principal,expedienteId,"YARA_SCAN",response);
        return response;
    }

    @Transactional(readOnly = true)
    public YaraRuleResponse exportCampaignYaraRule(String campaignId) {
        return transport.getFromWorker(
                "/api/yara/{campaignId}",
                campaignId,
                YaraRuleResponse.class,
                "regla YARA de campaña");
    }

    @Transactional
    public Map<String, Object> verifyIocFile(
            OmegaPrincipal principal,
            UUID expedienteId,
            MultipartFile file) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(List.of(file));

        MultiValueMap<String, Object> body = transport.buildMultipartBody("file", List.of(file));
        Map<String, Object> response = transport.postMultipartToWorkerMap(
                "/api/ioc/verify/file",
                body,
                "verificación IOC de archivo",
                false);

        Map<String, Object> meta = ForensicWorkerTransport.baseAuditMeta(expedienteId);
        meta.put("detectedFormat", String.valueOf(response.getOrDefault("detected_format", "unknown")));
        meta.put("analyzedIndicators", response.getOrDefault("analyzed_indicators", 0));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOC_FILE_VERIFIED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_IOC",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
        if(evidence!=null) evidence.record(principal,expedienteId,"IOC_FILE",response);
        return response;
    }

    @Transactional
    public Map<String, Object> verifyIocText(
            OmegaPrincipal principal,
            UUID expedienteId,
            String indicatorsText) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }

        Map<String, Object> response = transport.postJsonToWorkerMap(
                "/api/ioc/verify/text",
                Map.of("indicators_text", indicatorsText),
                "verificación IOC textual",
                false);

        Map<String, Object> meta = ForensicWorkerTransport.baseAuditMeta(expedienteId);
        meta.put("analyzedIndicators", response.getOrDefault("analyzed_indicators", 0));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOC_TEXT_VERIFIED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_IOC",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
        if(evidence!=null) evidence.record(principal,expedienteId,"IOC_TEXT",response);
        return response;
    }

    @Transactional
    public Map<String, Object> runLiveDeviceTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            Map<String, Object> payload) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }

        Map<String, Object> response = transport.postJsonToWorkerMap(
                "/api/triage/device-live",
                payload,
                "triage móvil en vivo",
                true);

        Map<String, Object> meta = ForensicWorkerTransport.baseAuditMeta(expedienteId);
        meta.put("platform", String.valueOf(payload.getOrDefault("platform", "unknown")));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));
        meta.put("verdictCode", ForensicWorkerTransport.extractVerdictCode(response));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_DEVICE_LIVE_TRIAGED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_TRIAGE",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
        if(evidence!=null) evidence.record(principal,expedienteId,"DEVICE_LIVE",response);
        return response;
    }

    @Transactional
    public Map<String, Object> runPcLiveTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            Map<String, Object> payload) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }

        Map<String, Object> response = transport.postJsonToWorkerMap(
                "/api/triage/pc-live",
                payload,
                "auditoría PC en vivo",
                false);

        Map<String, Object> meta = ForensicWorkerTransport.baseAuditMeta(expedienteId);
        meta.put("platform", String.valueOf(payload.getOrDefault("platform", "win32")));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));
        meta.put("verdictCode", ForensicWorkerTransport.extractVerdictCode(response));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_PC_LIVE_TRIAGED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_TRIAGE",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
        if(evidence!=null) evidence.record(principal,expedienteId,"PC_LIVE",response);
        return response;
    }

    @Transactional
    public Map<String, Object> resolveIosManifestTargets(
            OmegaPrincipal principal,
            MultipartFile manifest) {
        archiveSecurityValidator.validateUploads(List.of(manifest));

        MultiValueMap<String, Object> body = transport.buildMultipartBody("manifest", List.of(manifest));
        Map<String, Object> response = transport.postMultipartToWorkerMap(
                "/api/triage/ios-manifest-targets",
                body,
                "resolución de Manifest.db iOS",
                false);

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOS_MANIFEST_PARSED",
                "FORENSIC_IOS_BACKUP",
                "ram-ephemeral",
                Map.of("targetsCount", response.getOrDefault("targets_count", 0)));
        return response;
    }

    @Transactional
    public Map<String, Object> decryptIosManifestTargets(
            OmegaPrincipal principal,
            MultipartFile manifestPlist,
            MultipartFile manifestDb,
            String password) {
        archiveSecurityValidator.validateUploads(List.of(manifestPlist, manifestDb));

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        transport.addFilePart(body, "manifest_plist", manifestPlist);
        transport.addFilePart(body, "manifest_db", manifestDb);
        body.add("password", password);

        Map<String, Object> response = transport.postMultipartToWorkerMap(
                "/api/triage/ios-manifest-decrypt",
                body,
                "descifrado de respaldo iOS",
                true);

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOS_MANIFEST_DECRYPTED",
                "FORENSIC_IOS_BACKUP",
                "ram-ephemeral",
                Map.of("targetsCount", response.getOrDefault("targets_count", 0)));
        return response;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> exportCampaignMvtScript(String campaignId) {
        return transport.getMapFromWorker(
                "/api/campaigns/{campaignId}/mvt-script",
                campaignId,
                "script MVT de campaña");
    }

    private LinkVerifyResponse enrichLinkVerifyResponse(LinkVerifyResponse raw) {
        if (raw == null || raw.passiveCtCertificates() != null || raw.host() == null || raw.host().isBlank()) {
            return raw;
        }
        String host = raw.host().trim().toLowerCase();
        if (host.matches("^(?:\\d{1,3}\\.){3}\\d{1,3}$")) {
            return raw;
        }
        Integer ctCount = probePassiveCtCount(host);
        if (ctCount == null && raw.rootDomain() != null && !raw.rootDomain().equals(host)) {
            ctCount = probePassiveCtCount(raw.rootDomain());
        }
        if (ctCount == null) {
            return raw;
        }
        return new LinkVerifyResponse(
                raw.normalizedUrl(),
                raw.host(),
                raw.rootDomain(),
                raw.scheme(),
                raw.path(),
                raw.riskLevel(),
                raw.verdict(),
                raw.recommendation(),
                raw.heuristics(),
                ctCount,
                raw.ctiMatches(),
                raw.privacyNotice(), raw.domainAgeDays(), raw.freshTlsCertificate(), raw.cloakingDetected(),
                raw.evasionRiskScore(), raw.evasionReasons(), raw.infrastructureIntelligence());
    }

    private Integer probePassiveCtCount(String domain) {
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        String encoded = URLEncoder.encode(domain, StandardCharsets.UTF_8);
        try {
            HttpRequest req = HttpRequest
                    .newBuilder(URI.create("https://api.certspotter.com/v1/issuances?domain=" + encoded))
                    .timeout(Duration.ofSeconds(3))
                    .header("User-Agent", "Omega-CTI-Passive-Check/1.0")
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200 && res.body() != null && res.body().trim().startsWith("[")) {
                String body = res.body().trim();
                if ("[]".equals(body)) {
                    return 0;
                }
                int count = body.split("\"id\"\\s*:").length - 1;
                if (count > 0) {
                    return count;
                }
            }
        } catch (Exception ignored) {
        }
        try {
            HttpRequest req = HttpRequest
                    .newBuilder(URI.create("https://api.hackertarget.com/hostsearch/?q=" + encoded))
                    .timeout(Duration.ofSeconds(3))
                    .header("User-Agent", "Omega-CTI-Passive-Check/1.0")
                    .GET()
                    .build();
            HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200 && res.body() != null) {
                String text = res.body().trim();
                if (!text.isEmpty() && !text.toLowerCase().contains("error")
                        && !text.toLowerCase().contains("api count exceeded")) {
                    int lines = 0;
                    for (String ln : text.split("\\R")) {
                        if (ln.contains(",")) {
                            lines++;
                        }
                    }
                    return lines;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private ParallelTriageResponse enrichParallelTriageResponse(ParallelTriageResponse r) {
        Map<String, Object> freshness = r.catalogFreshness() != null ? r.catalogFreshness() : transport.buildFreshnessMap();
        String scope = (r.osScopeNotice() != null && !r.osScopeNotice().isBlank()) ? r.osScopeNotice()
                : ForensicWorkerTransport.DEFAULT_OS_SCOPE_NOTICE;
        List<Map<String, Object>> mitigations = r.platformMitigations() != null ? r.platformMitigations() : List.of();
        return new ParallelTriageResponse(
                r.pipelineMode(),
                r.totalFiles(),
                r.totalIndicatorsAnalyzed(),
                r.totalMatches(),
                r.crashAnomalies(),
                r.behavioralAnomalies(),
                r.manifestFindings(),
                r.yaraHits(),
                r.deviceSummary(),
                r.hardeningChecks(),
                r.abuseAlerts(),
                r.liveSockets(),
                r.liveSocketsTotal(),
                r.cachedDnsCount(),
                r.cachedDnsSample(),
                r.timeline(),
                r.timelineSummary(),
                r.yaraEngine(),
                r.diagnosis(),
                r.subagents(),
                r.ephemeralNotice(),
                freshness,
                scope,
                mitigations);
    }
}
