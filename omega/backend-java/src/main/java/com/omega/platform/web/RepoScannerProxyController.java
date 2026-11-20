package com.omega.platform.web;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.ApiTokenAuthenticationFilter;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.service.ApiTokenService;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/**
 * Proxy autenticado hacia el worker FastAPI (/api/repo/scan) para análisis estático de repositorios.
 */
@RestController
@RequestMapping("/api/v1/repo")
public class RepoScannerProxyController {

    private final RestClient forensicWorkerRestClient;
    private final TenantRepository tenantRepository;
    private final ApiTokenService apiTokenService;

    public RepoScannerProxyController(
            @Qualifier("forensicWorkerRestClient") RestClient forensicWorkerRestClient,
            TenantRepository tenantRepository,
            ObjectProvider<ApiTokenService> apiTokenServiceProvider
    ) {
        this.forensicWorkerRestClient = forensicWorkerRestClient;
        this.tenantRepository = tenantRepository;
        this.apiTokenService = apiTokenServiceProvider.getIfAvailable();
    }

    @PostMapping(value = "/scan", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST') or hasAuthority('SCOPE_REPO_SCAN')")
    @SuppressWarnings("unchecked")
    public Map<String, Object> scanRepository(
            @RequestPart("file") MultipartFile file,
            HttpServletRequest request
    ) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(scope.tenantId())
                .orElseThrow(() -> new AccessDeniedException("Tenant inactivo o inexistente"));

        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Debes adjuntar un archivo .tar.gz, .tgz o .zip");
        }
        if (apiTokenService != null) {
            Object attr = request.getAttribute(ApiTokenAuthenticationFilter.API_TOKEN_ID_ATTR);
            UUID apiTokenId = attr instanceof UUID uuid ? uuid : null;
            apiTokenService.consumeScanQuotaAndTokenUse(tenant.getId(), apiTokenId);
        }

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No se pudo leer el archivo adjunto");
        }

        String filename = file.getOriginalFilename() != null && !file.getOriginalFilename().isBlank()
                ? file.getOriginalFilename()
                : "repo.tar.gz";

        MultipartBodyBuilder bodyBuilder = new MultipartBodyBuilder();
        HttpHeaders partHeaders = new HttpHeaders();
        partHeaders.setContentDisposition(ContentDisposition.formData().name("file").filename(filename).build());
        partHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        bodyBuilder.part("file", new HttpEntity<>(new ByteArrayResource(bytes) {
            @Override
            public String getFilename() {
                return filename;
            }
        }, partHeaders));

        try {
            return forensicWorkerRestClient.post()
                    .uri("/api/repo/scan")
                    .header("X-Tenant-Id", tenant.getId().toString())
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(bodyBuilder.build())
                    .retrieve()
                    .body(Map.class);
        } catch (RestClientResponseException ex) {
            throw new ResponseStatusException(
                    HttpStatus.valueOf(ex.getStatusCode().value()),
                    "El motor de análisis de repositorios rechazó la solicitud");
        }
    }

    @GetMapping("/scan/{scanId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST', 'CLIENT') or hasAuthority('SCOPE_REPO_SCAN')")
    @SuppressWarnings("unchecked")
    public Map<String, Object> getScanStatus(@PathVariable String scanId) {
        TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        try {
            return forensicWorkerRestClient.get()
                    .uri("/api/repo/scan/{scanId}", scanId)
                    .retrieve()
                    .body(Map.class);
        } catch (RestClientResponseException ex) {
            throw new ResponseStatusException(
                    HttpStatus.valueOf(ex.getStatusCode().value()),
                    "No se pudo consultar el estado del escaneo");
        }
    }
}
