package com.omega.platform.integration.forensic;

import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.ingest.InvalidDocumentException;
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
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.multipart.MultipartFile;

/**
 * Transporte HTTP compartido hacia el worker forense interno (`omega/api`) y
 * helpers de multipart, traducción de errores fail-closed y metadatos de alcance.
 */
@Component
public class ForensicWorkerTransport {

    public static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE = new ParameterizedTypeReference<>() {
    };

    public static final String DEFAULT_OS_SCOPE_NOTICE =
            "OMEGA analiza artefactos en espacio de usuario contra el catálogo CTI vigente; \"0 coincidencias\" no certifica ausencia de exploits zero-click en kernel/BlastDoor/CoreGraphics.";

    private final RestClient forensicWorkerRestClient;
    private final StixCatalogService stixCatalogService;

    @Autowired
    public ForensicWorkerTransport(
            @Qualifier("forensicWorkerRestClient") RestClient forensicWorkerRestClient,
            @Autowired(required = false) StixCatalogService stixCatalogService) {
        this.forensicWorkerRestClient = forensicWorkerRestClient;
        this.stixCatalogService = stixCatalogService;
    }

    public RestClient workerClient() {
        return forensicWorkerRestClient;
    }

    public StixCatalogService stixCatalogService() {
        return stixCatalogService;
    }

    public <T> T postMultipartToWorker(
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

    public Map<String, Object> postMultipartToWorkerMap(
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

    public <T> T postJsonToWorker(
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

    public Map<String, Object> postJsonToWorkerMap(
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

    public <T> T getFromWorker(String uri, String pathVar, Class<T> responseType, String operationName) {
        try {
            T response = forensicWorkerRestClient.get()
                    .uri(uri, pathVar)
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

    public Map<String, Object> getMapFromWorker(String uri, String pathVar, String operationName) {
        try {
            Map<String, Object> response = forensicWorkerRestClient.get()
                    .uri(uri, pathVar)
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

    public MultiValueMap<String, Object> buildMultipartBody(String partName, List<MultipartFile> files) {
        MultiValueMap<String, Object> map = new LinkedMultiValueMap<>();
        for (MultipartFile file : files) {
            addFilePart(map, partName, file);
        }
        return map;
    }

    public void addFilePart(MultiValueMap<String, Object> map, String partName, MultipartFile file) {
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

    public Map<String, Object> enrichOperationalBoundaryMetadata(Map<String, Object> rawResponse) {
        Map<String, Object> enriched = new LinkedHashMap<>(rawResponse);
        enriched.putIfAbsent("os_scope_notice", DEFAULT_OS_SCOPE_NOTICE);
        enriched.putIfAbsent("catalog_freshness", buildFreshnessMap());
        return enriched;
    }

    public Map<String, Object> buildFreshnessMap() {
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

    public static RuntimeException translateWorkerException(
            RestClientException ex,
            String operationName,
            boolean treatUnauthorizedAsBadBackupPassword) {
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

    public static Map<String, Object> baseAuditMeta(UUID expedienteId) {
        Map<String, Object> meta = new LinkedHashMap<>();
        if (expedienteId != null) {
            meta.put("expedienteId", expedienteId.toString());
        }
        return meta;
    }

    public static String extractVerdictCode(Map<String, Object> response) {
        Object diagObj = response.get("diagnosis");
        if (diagObj instanceof Map<?, ?> diagMap) {
            Object code = diagMap.get("verdict_code");
            if (code != null) {
                return String.valueOf(code);
            }
        }
        return "UNKNOWN";
    }

    public static String sanitizePartFilename(String raw) {
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
