package com.omega.platform.integration.forensic;

import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkCheckRequest;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.ParallelTriageResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraRuleResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.YaraScanResponse;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.multipart.MultipartFile;

/**
 * Puente autenticado y auditado entre Spring Boot y el microservicio forense interno `omega/api`.
 * Ejecuta validación anti-Zip-Slip / anti-Bomba antes de delegar volcados al worker en RAM.
 */
@Service
public class ForensicBridgeService {

    private final RestClient forensicWorkerRestClient;
    private final ArchiveSecurityValidator archiveSecurityValidator;
    private final ExpedienteAuthorizationService authorizationService;
    private final AuditLogService auditLogService;

    public ForensicBridgeService(
            @Qualifier("forensicWorkerRestClient") RestClient forensicWorkerRestClient,
            ArchiveSecurityValidator archiveSecurityValidator,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService
    ) {
        this.forensicWorkerRestClient = forensicWorkerRestClient;
        this.archiveSecurityValidator = archiveSecurityValidator;
        this.authorizationService = authorizationService;
        this.auditLogService = auditLogService;
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

        MultiValueMap<String, Object> body = buildMultipartBody(files);
        ParallelTriageResponse response;
        try {
            response = forensicWorkerRestClient.post()
                    .uri("/api/triage/parallel")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(body)
                    .retrieve()
                    .body(ParallelTriageResponse.class);
        } catch (RestClientException ex) {
            throw new ForensicWorkerException("Error comunicando con el worker forense para triage paralelo", ex);
        }

        if (response == null) {
            throw new ForensicWorkerException("Respuesta vacía del worker forense en triage paralelo", null);
        }

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

        LinkVerifyResponse response;
        try {
            response = forensicWorkerRestClient.post()
                    .uri("/api/link/verify")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new LinkCheckRequest(rawUrl))
                    .retrieve()
                    .body(LinkVerifyResponse.class);
        } catch (RestClientException ex) {
            throw new ForensicWorkerException("Error comunicando con el worker forense al verificar enlace", ex);
        }

        if (response == null) {
            throw new ForensicWorkerException("Respuesta vacía del worker forense en verificación de enlace", null);
        }

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

        MultiValueMap<String, Object> body = buildMultipartBody(files);
        YaraScanResponse response;
        try {
            response = forensicWorkerRestClient.post()
                    .uri("/api/yara")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(body)
                    .retrieve()
                    .body(YaraScanResponse.class);
        } catch (RestClientException ex) {
            throw new ForensicWorkerException("Error ejecutando escaneo YARA en worker forense", ex);
        }

        if (response == null) {
            throw new ForensicWorkerException("Respuesta vacía del worker forense en escaneo YARA", null);
        }

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
        try {
            return forensicWorkerRestClient.get()
                    .uri("/api/yara/{campaignId}", campaignId)
                    .retrieve()
                    .body(YaraRuleResponse.class);
        } catch (RestClientException ex) {
            throw new ForensicWorkerException("Error consultando regla YARA de campaña en worker forense", ex);
        }
    }

    private MultiValueMap<String, Object> buildMultipartBody(List<MultipartFile> files) {
        MultiValueMap<String, Object> map = new LinkedMultiValueMap<>();
        for (MultipartFile file : files) {
            String safeFilename = sanitizePartFilename(file.getOriginalFilename());
            try {
                byte[] bytes = file.getBytes();
                ByteArrayResource resource = new ByteArrayResource(bytes) {
                    @Override
                    public String getFilename() {
                        return safeFilename;
                    }
                };
                map.add("files", resource);
            } catch (IOException ex) {
                throw new ForensicWorkerException("No se pudieron leer bytes en RAM del artefacto " + safeFilename, ex);
            }
        }
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
