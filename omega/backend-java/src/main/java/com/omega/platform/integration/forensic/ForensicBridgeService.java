package com.omega.platform.integration.forensic;

import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkCheckRequest;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.MobileUsbAuditWorkerRequest;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.ParallelTriageResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraRuleResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraScanResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.PersistenceAuditResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeStatus;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeToggleRequest;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.ResourceNotFoundException;
import java.io.IOException;
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
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.multipart.MultipartFile;

/**
 * Puente autenticado y auditado entre Spring Boot y el microservicio forense
 * interno `omega/api`.
 * Ejecuta validación anti-Zip-Slip / anti-Bomba antes de delegar volcados al
 * worker en RAM.
 */
@Service
public class ForensicBridgeService {

    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE = new ParameterizedTypeReference<>() {
    };

    private static final String DEFAULT_OS_SCOPE_NOTICE = "OMEGA analiza artefactos en espacio de usuario contra el catálogo CTI vigente; \"0 coincidencias\" no certifica ausencia de exploits zero-click en kernel/BlastDoor/CoreGraphics.";

    private final RestClient forensicWorkerRestClient;
    private final ArchiveSecurityValidator archiveSecurityValidator;
    private final ExpedienteAuthorizationService authorizationService;
    private final AuditLogService auditLogService;
    private final StixCatalogService stixCatalogService;
    private RestClient hostWorkerRestClient;
    private com.omega.platform.security.ContainmentAuthorizationService containmentAuthorization;
    @Autowired(required = false)
    private com.omega.platform.config.SovereignModePolicy sovereignPolicy;

    @Autowired
    public void setContainmentAuthorization(com.omega.platform.security.ContainmentAuthorizationService authorization) {
        this.containmentAuthorization = authorization;
    }

    public Map<String, Object> containmentChallenge(OmegaPrincipal principal, String password) {
        if (containmentAuthorization == null) throw new org.springframework.security.access.AccessDeniedException("Verificación sensible no configurada");
        return containmentAuthorization.challenge(principal, password);
    }

    public Map<String, Object> executeContainment(OmegaPrincipal principal, ForensicWorkerContracts.ContainmentRequest request) {
        if (request.expedienteId() != null) authorizationService.requireWriteAccess(principal, request.expedienteId());
        if (sovereignPolicy != null && sovereignPolicy.enabled() && "BLOCK_NETWORK_INDICATOR".equals(request.actionType())) {
            String indicator = String.valueOf(request.target().getOrDefault("indicator", ""));
            if (!indicator.matches("[0-9a-fA-F:.]+")) throw new IllegalArgumentException("En modo local, selecciona una IP ya medida: no se resolverán dominios por DNS externo.");
        }
        if (!request.dryRun()) {
            if (containmentAuthorization == null) throw new org.springframework.security.access.AccessDeniedException("Verificación sensible no configurada");
            containmentAuthorization.authorize(principal, request.currentPassword(), request.challengeToken(), request.code());
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("actionType", request.actionType()); payload.put("target", request.target());
        payload.put("dryRun", request.dryRun()); payload.put("previewToken", request.previewToken());
        return containmentOperation(principal, "/api/containment/execute", payload, request.actionType(),
                String.valueOf(request.target().getOrDefault("sha256", "")), request.dryRun(), request.expedienteId());
    }

    public Map<String, Object> rollbackContainment(OmegaPrincipal principal, String actionId, ForensicWorkerContracts.ContainmentCredentials credentials) {
        UUID.fromString(actionId);
        if (credentials.expedienteId() != null) authorizationService.requireWriteAccess(principal, credentials.expedienteId());
        if (containmentAuthorization == null) throw new org.springframework.security.access.AccessDeniedException("Verificación sensible no configurada");
        containmentAuthorization.authorize(principal, credentials.currentPassword(), credentials.challengeToken(), credentials.code());
        return containmentOperation(principal, "/api/containment/rollback/" + actionId, Map.of(), "ROLLBACK", "", false, credentials.expedienteId());
    }

    private Map<String, Object> containmentOperation(OmegaPrincipal principal, String uri, Map<String, Object> payload,
            String actionType, String targetHash, boolean dryRun, UUID expedienteId) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("actionType", actionType); meta.put("targetHash", targetHash); meta.put("dryRun", dryRun);
        if (expedienteId != null) {
            meta.put("expedienteId", expedienteId.toString());
            meta.put("caseAssociationSource", "USER_SELECTED_CASE");
        }
        auditLogService.record(principal.tenantId(), principal.userId(), "CONTAINMENT_REQUESTED", "HOST_CONTAINMENT", "pending", meta);
        try {
            Map<String, Object> result = hostClient().post().uri(uri)
                    .header("X-Host-Tenant", principal.tenantId().toString()).header("X-Host-Actor", principal.userId().toString())
                    .contentType(MediaType.APPLICATION_JSON).body(payload).retrieve().body(MAP_TYPE);
            if (result == null) throw new ForensicWorkerException("Respuesta de contención vacía", null);
            meta.put("actionId", result.getOrDefault("actionId", "unknown"));
            if (result.get("target") instanceof Map<?, ?> measured) {
                if (measured.get("sha256") instanceof String sha && !sha.isBlank()) {
                    meta.put("targetHash", sha);
                    meta.put("targetHashKind", "FILE_SHA256");
                } else {
                    try {
                        meta.put("targetHash", java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                                .digest(String.valueOf(measured).getBytes(StandardCharsets.UTF_8))));
                        meta.put("targetHashKind", "TARGET_DESCRIPTION_SHA256");
                    } catch (java.security.NoSuchAlgorithmException impossible) {
                        throw new IllegalStateException("SHA-256 no disponible", impossible);
                    }
                }
            }
            meta.put("result", result.getOrDefault("status", "UNKNOWN"));
            auditLogService.record(principal.tenantId(), principal.userId(), "ROLLBACK".equals(actionType) ? "CONTAINMENT_ROLLBACK" : "CONTAINMENT_RESULT",
                    "HOST_CONTAINMENT", String.valueOf(meta.get("actionId")), meta);
            return result;
        } catch (RestClientException ex) {
            meta.put("result", "WORKER_ERROR_CHECK_HISTORY");
            auditLogService.record(principal.tenantId(), principal.userId(), "CONTAINMENT_ERROR", "HOST_CONTAINMENT", "unknown", meta);
            throw translateWorkerException(ex, "contención del equipo; consulta el historial para confirmar el estado", false);
        }
    }

    public Map<String, Object> containmentHistory(OmegaPrincipal principal) {
        try {
            return hostClient().get().uri("/api/containment/history").header("X-Host-Tenant", principal.tenantId().toString())
                    .retrieve().body(MAP_TYPE);
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, "historial de contención", false);
        }
    }
    private long lastHostCatalogSync;
    @org.springframework.beans.factory.annotation.Value("${OMEGA_HOST_OWNER_TENANT_ID:}")
    private String hostOwnerTenantId = "";

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 60000, initialDelay = 10000)
    public void refreshHostCatalogInBackground() {
        if (hostOwnerTenantId.isBlank()) {
            return;
        }
        try {
            syncHostCatalog(UUID.fromString(hostOwnerTenantId));
        } catch (RuntimeException ex) {
            org.slf4j.LoggerFactory.getLogger(ForensicBridgeService.class)
                    .warn("No se pudo actualizar el catálogo del sensor de equipo: {}", ex.getClass().getSimpleName());
        }
    }

    @Autowired
    public void setHostWorkerRestClient(@Qualifier("hostWorkerRestClient") RestClient client) {
        this.hostWorkerRestClient = client;
    }

    private RestClient hostClient() {
        return hostWorkerRestClient == null ? forensicWorkerRestClient : hostWorkerRestClient;
    }

    private synchronized void syncHostCatalog(UUID tenantId) {
        if (stixCatalogService == null || (lastHostCatalogSync != 0 && System.nanoTime() - lastHostCatalogSync < Duration.ofSeconds(60).toNanos())) {
            return;
        }
        try {
            hostClient().post().uri("/api/host/iocs/sync")
                    .header("X-Host-Tenant", tenantId.toString())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("indicators", stixCatalogService.hostIndicators())).retrieve().toBodilessEntity();
            lastHostCatalogSync = System.nanoTime();
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, "sincronización del catálogo del sensor", false);
        }
    }

    public RealtimeStatus hostRealtimeStatus(OmegaPrincipal principal) {
        syncHostCatalog(principal.tenantId());
        try {
            return hostClient().get().uri("/api/host/realtime/status")
                    .header("X-Host-Tenant", principal.tenantId().toString()).retrieve().body(RealtimeStatus.class);
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, "estado del sensor de equipo", false);
        }
    }

    public RealtimeStatus toggleHostRealtime(OmegaPrincipal principal, boolean enabled) {
        syncHostCatalog(principal.tenantId());
        try {
            RealtimeStatus response = hostClient().post().uri("/api/host/realtime/toggle")
                    .header("X-Host-Tenant", principal.tenantId().toString()).contentType(MediaType.APPLICATION_JSON)
                    .body(new RealtimeToggleRequest(enabled)).retrieve().body(RealtimeStatus.class);
            auditLogService.record(principal.tenantId(), principal.userId(), "HOST_WATCH_TOGGLED", "HOST_SENSOR", "native-host", Map.of("enabled", enabled));
            return response;
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, "activar/pausar sensor de equipo", false);
        }
    }

    public PersistenceAuditResponse auditHostPersistence(OmegaPrincipal principal) {
        syncHostCatalog(principal.tenantId());
        try {
            PersistenceAuditResponse response = hostClient().post().uri("/api/host/persistence/audit")
                    .header("X-Host-Tenant", principal.tenantId().toString()).contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of()).retrieve().body(PersistenceAuditResponse.class);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía de persistencia", null);
            }
            auditLogService.record(principal.tenantId(), principal.userId(), "HOST_PERSISTENCE_AUDITED", "HOST_SENSOR", response.hostname(),
                    Map.of("findingCount", response.findings().size(), "complete", response.complete(), "scope", response.scope()));
            return response;
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, "auditoría de persistencia", false);
        }
    }

    public ForensicBridgeService(
            @Qualifier("forensicWorkerRestClient") RestClient forensicWorkerRestClient,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService) {
        this(forensicWorkerRestClient, archiveSecurityValidator, authorizationService, auditLogService, null);
    }

    @Autowired
    public ForensicBridgeService(
            @Qualifier("forensicWorkerRestClient") RestClient forensicWorkerRestClient,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService,
            StixCatalogService stixCatalogService) {
        this.forensicWorkerRestClient = forensicWorkerRestClient;
        this.archiveSecurityValidator = archiveSecurityValidator;
        this.authorizationService = authorizationService;
        this.auditLogService = auditLogService;
        this.stixCatalogService = stixCatalogService;
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

        MultiValueMap<String, Object> body = buildMultipartBody("files", files);
        ParallelTriageResponse rawResponse = postMultipartToWorker(
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
        return response;
    }

    @Transactional
    public LinkVerifyResponse verifyLink(OmegaPrincipal principal, UUID expedienteId, String rawUrl) {
        return verifyLink(principal, expedienteId, rawUrl, false);
    }

    @Transactional
    public LinkVerifyResponse verifyLink(OmegaPrincipal principal, UUID expedienteId, String rawUrl, boolean activeProbe) {
        if (expedienteId != null) {
            authorizationService.requireReadAccess(principal, expedienteId);
        }

        LinkVerifyResponse rawResponse = postJsonToWorker(
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
        return response;
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
        // 1. CertSpotter CT API
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
        // 2. HackerTarget hostsearch fallback
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
                        if (ln.contains(","))
                            lines++;
                    }
                    return lines;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    @Transactional
    public YaraScanResponse scanArtifactsYara(
            OmegaPrincipal principal,
            UUID expedienteId,
            List<MultipartFile> files) {
        if (expedienteId != null) {
            authorizationService.requireReadAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(files);

        MultiValueMap<String, Object> body = buildMultipartBody("files", files);
        YaraScanResponse response = postMultipartToWorker(
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
        return response;
    }

    @Transactional(readOnly = true)
    public YaraRuleResponse exportCampaignYaraRule(String campaignId) {
        return getFromWorker(
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
            authorizationService.requireReadAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(List.of(file));

        MultiValueMap<String, Object> body = buildMultipartBody("file", List.of(file));
        Map<String, Object> response = postMultipartToWorkerMap(
                "/api/ioc/verify/file",
                body,
                "verificación IOC de archivo",
                false);

        Map<String, Object> meta = baseAuditMeta(expedienteId);
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
        return response;
    }

    @Transactional
    public Map<String, Object> verifyIocText(
            OmegaPrincipal principal,
            UUID expedienteId,
            String indicatorsText) {
        if (expedienteId != null) {
            authorizationService.requireReadAccess(principal, expedienteId);
        }

        Map<String, Object> response = postJsonToWorkerMap(
                "/api/ioc/verify/text",
                Map.of("indicators_text", indicatorsText),
                "verificación IOC textual",
                false);

        Map<String, Object> meta = baseAuditMeta(expedienteId);
        meta.put("analyzedIndicators", response.getOrDefault("analyzed_indicators", 0));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOC_TEXT_VERIFIED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_IOC",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
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

        Map<String, Object> response = postJsonToWorkerMap(
                "/api/triage/device-live",
                payload,
                "triage móvil en vivo",
                true);

        Map<String, Object> meta = baseAuditMeta(expedienteId);
        meta.put("platform", String.valueOf(payload.getOrDefault("platform", "unknown")));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));
        meta.put("verdictCode", extractVerdictCode(response));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_DEVICE_LIVE_TRIAGED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_TRIAGE",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
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

        Map<String, Object> response = postJsonToWorkerMap(
                "/api/triage/pc-live",
                payload,
                "auditoría PC en vivo",
                false);

        Map<String, Object> meta = baseAuditMeta(expedienteId);
        meta.put("platform", String.valueOf(payload.getOrDefault("platform", "win32")));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));
        meta.put("verdictCode", extractVerdictCode(response));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_PC_LIVE_TRIAGED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_TRIAGE",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta);
        return response;
    }

    @Transactional
    public Map<String, Object> resolveIosManifestTargets(
            OmegaPrincipal principal,
            MultipartFile manifest) {
        archiveSecurityValidator.validateUploads(List.of(manifest));

        MultiValueMap<String, Object> body = buildMultipartBody("manifest", List.of(manifest));
        Map<String, Object> response = postMultipartToWorkerMap(
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
        addFilePart(body, "manifest_plist", manifestPlist);
        addFilePart(body, "manifest_db", manifestDb);
        body.add("password", password);

        Map<String, Object> response = postMultipartToWorkerMap(
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
        return getMapFromWorker(
                "/api/campaigns/{campaignId}/mvt-script",
                campaignId,
                "script MVT de campaña");
    }

    private <T> T postMultipartToWorker(
            String uri,
            MultiValueMap<String, Object> body,
            Class<T> responseType,
            String operationName) {
        try {
            T response = forensicWorkerRestClient.post()
                    .uri(uri)
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(body)
                    .retrieve()
                    .body(responseType);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía del worker forense en " + operationName, null);
            }
            return response;
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, operationName, false);
        }
    }

    private Map<String, Object> postMultipartToWorkerMap(
            String uri,
            MultiValueMap<String, Object> body,
            String operationName,
            boolean treatUnauthorizedAsBadBackupPassword) {
        try {
            Map<String, Object> response = forensicWorkerRestClient.post()
                    .uri(uri)
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(body)
                    .retrieve()
                    .body(MAP_TYPE);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía del worker forense en " + operationName, null);
            }
            return enrichOperationalBoundaryMetadata(response);
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, operationName, treatUnauthorizedAsBadBackupPassword);
        }
    }

    private <T> T postJsonToWorker(
            String uri,
            Object payload,
            Class<T> responseType,
            String operationName) {
        try {
            T response = forensicWorkerRestClient.post()
                    .uri(uri)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .body(responseType);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía del worker forense en " + operationName, null);
            }
            return response;
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, operationName, false);
        }
    }

    private Map<String, Object> postJsonToWorkerMap(
            String uri,
            Object payload,
            String operationName,
            boolean treatUnauthorizedAsBadBackupPassword) {
        try {
            Map<String, Object> response = forensicWorkerRestClient.post()
                    .uri(uri)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .body(MAP_TYPE);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía del worker forense en " + operationName, null);
            }
            return enrichOperationalBoundaryMetadata(response);
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, operationName, treatUnauthorizedAsBadBackupPassword);
        }
    }

    private <T> T getFromWorker(String uri, String campaignId, Class<T> responseType, String operationName) {
        try {
            T response = forensicWorkerRestClient.get()
                    .uri(uri, campaignId)
                    .retrieve()
                    .body(responseType);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía del worker forense en " + operationName, null);
            }
            return response;
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, operationName, false);
        }
    }

    private Map<String, Object> getMapFromWorker(String uri, String campaignId, String operationName) {
        try {
            Map<String, Object> response = forensicWorkerRestClient.get()
                    .uri(uri, campaignId)
                    .retrieve()
                    .body(MAP_TYPE);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía del worker forense en " + operationName, null);
            }
            return response;
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, operationName, false);
        }
    }

    private static RuntimeException translateWorkerException(
            RestClientException ex,
            String operationName,
            boolean treatUnauthorizedAsBadBackupPassword) {
        // Evita reenviar HTTP 401 de contraseña iOS incorrecta como 401 al SPA
        // (cerraría el JWT del analista),
        // preservando 502 fail-closed si el rechazo viene por X-Internal-Service-Token
        // inválido.
        if (treatUnauthorizedAsBadBackupPassword && ex instanceof HttpClientErrorException.Unauthorized unauth) {
            String body = unauth.getResponseBodyAsString();
            if (body.contains("Contraseña incorrecta") || body.contains("INVALID_BACKUP_PASSWORD")) {
                return new InvalidDocumentException(
                        "Contraseña incorrecta para la copia de seguridad encriptada de iOS.", ex);
            }
        }
        if (ex instanceof HttpClientErrorException.BadRequest badReq) {
            return new InvalidDocumentException(
                    "Solicitud rechazada en " + operationName + ": " + badReq.getStatusText(), ex);
        }
        if (ex instanceof HttpClientErrorException.NotFound) {
            return new ResourceNotFoundException("Recurso no encontrado en " + operationName);
        }
        return new ForensicWorkerException("Error comunicando con el worker forense en " + operationName, ex);
    }

    private static Map<String, Object> baseAuditMeta(UUID expedienteId) {
        Map<String, Object> meta = new LinkedHashMap<>();
        if (expedienteId != null) {
            meta.put("expedienteId", expedienteId.toString());
        }
        return meta;
    }

    private static String extractVerdictCode(Map<String, Object> response) {
        Object diagObj = response.get("diagnosis");
        if (diagObj instanceof Map<?, ?> diagMap) {
            Object code = diagMap.get("verdict_code");
            if (code != null) {
                return String.valueOf(code);
            }
        }
        return "UNKNOWN";
    }

    private MultiValueMap<String, Object> buildMultipartBody(String partName, List<MultipartFile> files) {
        MultiValueMap<String, Object> map = new LinkedMultiValueMap<>();
        for (MultipartFile file : files) {
            addFilePart(map, partName, file);
        }
        return map;
    }

    private void addFilePart(MultiValueMap<String, Object> map, String partName, MultipartFile file) {
        String safeFilename = sanitizePartFilename(file.getOriginalFilename());
        try {
            byte[] bytes = file.getBytes();
            ByteArrayResource resource = new ByteArrayResource(bytes) {
                @Override
                public String getFilename() {
                    return safeFilename;
                }
            };
            map.add(partName, resource);
        } catch (IOException ex) {
            throw new ForensicWorkerException("No se pudieron leer bytes en RAM del artefacto " + safeFilename, ex);
        }
    }

    private ParallelTriageResponse enrichParallelTriageResponse(ParallelTriageResponse r) {
        Map<String, Object> freshness = r.catalogFreshness() != null ? r.catalogFreshness() : buildFreshnessMap();
        String scope = (r.osScopeNotice() != null && !r.osScopeNotice().isBlank()) ? r.osScopeNotice()
                : DEFAULT_OS_SCOPE_NOTICE;
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

    private Map<String, Object> enrichOperationalBoundaryMetadata(Map<String, Object> rawResponse) {
        Map<String, Object> enriched = new LinkedHashMap<>(rawResponse);
        enriched.putIfAbsent("os_scope_notice", DEFAULT_OS_SCOPE_NOTICE);
        enriched.putIfAbsent("catalog_freshness", buildFreshnessMap());
        return enriched;
    }

    private Map<String, Object> buildFreshnessMap() {
        StixCatalogService.CatalogFreshnessDto dto = stixCatalogService != null
                ? stixCatalogService.getCatalogFreshness()
                : new StixCatalogService.CatalogFreshnessDto("2024-12-16", "2024-12-16", 0, "pr_reviewed_only", false);
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("catalog_cutoff_date", dto.catalogCutoffDate());
        map.put("latest_campaign_date", dto.latestCampaignDate());
        map.put("verified_bundles_count", dto.verifiedBundlesCount());
        map.put("update_policy", dto.updatePolicy());
        map.put("manifest_verified", dto.manifestVerified());
        return map;
    }

    private static String sanitizePartFilename(String raw) {
        if (raw == null || raw.isBlank()) {
            return "artifact.bin";
        }
        String norm = raw.replace('\\', '/');
        int idx = norm.lastIndexOf('/');
        String base = idx >= 0 ? norm.substring(idx + 1) : norm;
        base = base.replaceAll("[\\x00-\\x1f]", "").trim();
        return base.isBlank() ? "artifact.bin" : base;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> listMobileUsbDevices() {
        try {
            Map<String, Object> response = forensicWorkerRestClient.get()
                    .uri("/api/mobile/usb/devices")
                    .retrieve()
                    .body(MAP_TYPE);
            return response != null ? response : Map.of("status", "EMPTY", "devices", List.of());
        } catch (RestClientException ex) {
            throw translateWorkerException(ex, "detección USB móvil", false);
        }
    }

    @Transactional
    public Map<String, Object> startMobileUsbAudit(
            OmegaPrincipal principal,
            String platform,
            String deviceId,
            String backupPassword,
            boolean asyncMode
    ) {
        MobileUsbAuditWorkerRequest req = new MobileUsbAuditWorkerRequest(
                platform,
                deviceId,
                backupPassword,
                asyncMode
        );
        Map<String, Object> response = postJsonToWorkerMap("/api/mobile/usb/audit", req, "auditoría USB móvil", true);
        recordMobileUsbAuditIfCompleted(principal, response);
        return response;
    }

    @Transactional
    public Map<String, Object> getMobileUsbAuditJob(OmegaPrincipal principal, String jobId) {
        Map<String, Object> response = getMapFromWorker(
                "/api/mobile/usb/audit/{jobId}",
                jobId,
                "estado de auditoría USB móvil"
        );
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
                meta
        );
    }
}
