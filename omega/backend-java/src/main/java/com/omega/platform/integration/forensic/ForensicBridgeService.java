package com.omega.platform.integration.forensic;

import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkCheckRequest;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.ParallelTriageResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraRuleResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraScanResponse;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.ResourceNotFoundException;
import java.io.IOException;
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
 * Puente autenticado y auditado entre Spring Boot y el microservicio forense interno `omega/api`.
 * Ejecuta validación anti-Zip-Slip / anti-Bomba antes de delegar volcados al worker en RAM.
 */
@Service
public class ForensicBridgeService {

    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE =
            new ParameterizedTypeReference<>() {};

    private static final String DEFAULT_OS_SCOPE_NOTICE =
            "OMEGA analiza artefactos en espacio de usuario contra el catálogo CTI vigente; \"0 coincidencias\" no certifica ausencia de exploits zero-click en kernel/BlastDoor/CoreGraphics.";

    private final RestClient forensicWorkerRestClient;
    private final ArchiveSecurityValidator archiveSecurityValidator;
    private final ExpedienteAuthorizationService authorizationService;
    private final AuditLogService auditLogService;
    private final StixCatalogService stixCatalogService;

    public ForensicBridgeService(
            @Qualifier("forensicWorkerRestClient") RestClient forensicWorkerRestClient,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService
    ) {
        this(forensicWorkerRestClient, archiveSecurityValidator, authorizationService, auditLogService, null);
    }

    @Autowired
    public ForensicBridgeService(
            @Qualifier("forensicWorkerRestClient") RestClient forensicWorkerRestClient,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService,
            StixCatalogService stixCatalogService
    ) {
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
            List<MultipartFile> files
    ) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(files);

        MultiValueMap<String, Object> body = buildMultipartBody("files", files);
        ParallelTriageResponse rawResponse = postMultipartToWorker(
                "/api/triage/parallel",
                body,
                ParallelTriageResponse.class,
                "triage paralelo"
        );
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
                meta
        );
        return response;
    }

    @Transactional
    public LinkVerifyResponse verifyLink(OmegaPrincipal principal, UUID expedienteId, String rawUrl) {
        if (expedienteId != null) {
            authorizationService.requireReadAccess(principal, expedienteId);
        }

        LinkVerifyResponse response = postJsonToWorker(
                "/api/link/verify",
                new LinkCheckRequest(rawUrl),
                LinkVerifyResponse.class,
                "verificación de enlace"
        );

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
                meta
        );
        return response;
    }

    @Transactional
    public YaraScanResponse scanArtifactsYara(
            OmegaPrincipal principal,
            UUID expedienteId,
            List<MultipartFile> files
    ) {
        if (expedienteId != null) {
            authorizationService.requireReadAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(files);

        MultiValueMap<String, Object> body = buildMultipartBody("files", files);
        YaraScanResponse response = postMultipartToWorker(
                "/api/yara",
                body,
                YaraScanResponse.class,
                "escaneo YARA"
        );

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
                meta
        );
        return response;
    }

    @Transactional(readOnly = true)
    public YaraRuleResponse exportCampaignYaraRule(String campaignId) {
        return getFromWorker(
                "/api/yara/{campaignId}",
                campaignId,
                YaraRuleResponse.class,
                "regla YARA de campaña"
        );
    }

    @Transactional
    public Map<String, Object> verifyIocFile(
            OmegaPrincipal principal,
            UUID expedienteId,
            MultipartFile file
    ) {
        if (expedienteId != null) {
            authorizationService.requireReadAccess(principal, expedienteId);
        }
        archiveSecurityValidator.validateUploads(List.of(file));

        MultiValueMap<String, Object> body = buildMultipartBody("file", List.of(file));
        Map<String, Object> response = postMultipartToWorkerMap(
                "/api/ioc/verify/file",
                body,
                "verificación IOC de archivo",
                false
        );

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
                meta
        );
        return response;
    }

    @Transactional
    public Map<String, Object> verifyIocText(
            OmegaPrincipal principal,
            UUID expedienteId,
            String indicatorsText
    ) {
        if (expedienteId != null) {
            authorizationService.requireReadAccess(principal, expedienteId);
        }

        Map<String, Object> response = postJsonToWorkerMap(
                "/api/ioc/verify/text",
                Map.of("indicators_text", indicatorsText),
                "verificación IOC textual",
                false
        );

        Map<String, Object> meta = baseAuditMeta(expedienteId);
        meta.put("analyzedIndicators", response.getOrDefault("analyzed_indicators", 0));
        meta.put("totalMatches", response.getOrDefault("total_matches", 0));

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOC_TEXT_VERIFIED",
                expedienteId != null ? "EXPEDIENTE" : "FORENSIC_IOC",
                expedienteId != null ? expedienteId.toString() : "ram-ephemeral",
                meta
        );
        return response;
    }

    @Transactional
    public Map<String, Object> runLiveDeviceTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            Map<String, Object> payload
    ) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }

        Map<String, Object> response = postJsonToWorkerMap(
                "/api/triage/device-live",
                payload,
                "triage móvil en vivo",
                true
        );

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
                meta
        );
        return response;
    }

    @Transactional
    public Map<String, Object> runPcLiveTriage(
            OmegaPrincipal principal,
            UUID expedienteId,
            Map<String, Object> payload
    ) {
        if (expedienteId != null) {
            authorizationService.requireWriteAccess(principal, expedienteId);
        }

        Map<String, Object> response = postJsonToWorkerMap(
                "/api/triage/pc-live",
                payload,
                "auditoría PC en vivo",
                false
        );

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
                meta
        );
        return response;
    }

    @Transactional
    public Map<String, Object> resolveIosManifestTargets(
            OmegaPrincipal principal,
            MultipartFile manifest
    ) {
        archiveSecurityValidator.validateUploads(List.of(manifest));

        MultiValueMap<String, Object> body = buildMultipartBody("manifest", List.of(manifest));
        Map<String, Object> response = postMultipartToWorkerMap(
                "/api/triage/ios-manifest-targets",
                body,
                "resolución de Manifest.db iOS",
                false
        );

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOS_MANIFEST_PARSED",
                "FORENSIC_IOS_BACKUP",
                "ram-ephemeral",
                Map.of("targetsCount", response.getOrDefault("targets_count", 0))
        );
        return response;
    }

    @Transactional
    public Map<String, Object> decryptIosManifestTargets(
            OmegaPrincipal principal,
            MultipartFile manifestPlist,
            MultipartFile manifestDb,
            String password
    ) {
        archiveSecurityValidator.validateUploads(List.of(manifestPlist, manifestDb));

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        addFilePart(body, "manifest_plist", manifestPlist);
        addFilePart(body, "manifest_db", manifestDb);
        body.add("password", password);

        Map<String, Object> response = postMultipartToWorkerMap(
                "/api/triage/ios-manifest-decrypt",
                body,
                "descifrado de respaldo iOS",
                true
        );

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "FORENSIC_IOS_MANIFEST_DECRYPTED",
                "FORENSIC_IOS_BACKUP",
                "ram-ephemeral",
                Map.of("targetsCount", response.getOrDefault("targets_count", 0))
        );
        return response;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> exportCampaignMvtScript(String campaignId) {
        return getMapFromWorker(
                "/api/campaigns/{campaignId}/mvt-script",
                campaignId,
                "script MVT de campaña"
        );
    }

    private <T> T postMultipartToWorker(
            String uri,
            MultiValueMap<String, Object> body,
            Class<T> responseType,
            String operationName
    ) {
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
            boolean treatUnauthorizedAsBadBackupPassword
    ) {
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
            String operationName
    ) {
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
            boolean treatUnauthorizedAsBadBackupPassword
    ) {
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
            boolean treatUnauthorizedAsBadBackupPassword
    ) {
        // Evita reenviar HTTP 401 de contraseña iOS incorrecta como 401 al SPA (cerraría el JWT del analista),
        // preservando 502 fail-closed si el rechazo viene por X-Internal-Service-Token inválido.
        if (treatUnauthorizedAsBadBackupPassword && ex instanceof HttpClientErrorException.Unauthorized unauth) {
            String body = unauth.getResponseBodyAsString();
            if (body.contains("Contraseña incorrecta") || body.contains("INVALID_BACKUP_PASSWORD")) {
                return new InvalidDocumentException("Contraseña incorrecta para la copia de seguridad encriptada de iOS.", ex);
            }
        }
        if (ex instanceof HttpClientErrorException.BadRequest badReq) {
            return new InvalidDocumentException("Solicitud rechazada en " + operationName + ": " + badReq.getStatusText(), ex);
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
        String scope = (r.osScopeNotice() != null && !r.osScopeNotice().isBlank()) ? r.osScopeNotice() : DEFAULT_OS_SCOPE_NOTICE;
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
                mitigations
        );
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
}
