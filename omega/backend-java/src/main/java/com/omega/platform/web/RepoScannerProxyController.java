package com.omega.platform.web;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.security.ApiTokenAuthenticationFilter;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.service.ApiTokenService;
import com.omega.platform.service.DevProjectService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RequestParam;
import jakarta.servlet.http.HttpServletRequest;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

    private static final int MAX_REMOTE_ARCHIVE_BYTES = 25 * 1024 * 1024;
    private static final Pattern GITHUB_REPO_PATTERN = Pattern.compile(
            "^(?:https?://(?:www\\.)?github\\.com/)?([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100}?)(?:\\.git)?(?:/tree/([A-Za-z0-9_./-]{1,120}))?/?$"
    );
    private static final Pattern SAFE_BRANCH_PATTERN = Pattern.compile("^[A-Za-z0-9_./-]{1,120}$");
    private static final Pattern SAFE_SCAN_ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");

    private final RestClient forensicWorkerRestClient;
    private final TenantRepository tenantRepository;
    private final ApiTokenService apiTokenService;
    private final HttpClient githubHttpClient = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @Autowired(required = false)
    private DevProjectService devProjectService;

    @Autowired(required = false)
    private com.omega.platform.repository.DevScanRepository devScanRepository;

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
            @RequestParam(value = "projectId", required = false) UUID projectId,
            @RequestParam(value = "projectName", required = false) String projectName,
            @RequestParam(value = "source", required = false) String source,
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

        Map<String, Object> scanResult = forwardArchiveToScanner(tenant.getId(), filename, bytes);
        if (devProjectService != null && scanResult != null) {
            String effectiveName = (projectName != null && !projectName.isBlank())
                    ? projectName
                    : filename.replaceAll("\\.(tar\\.gz|tgz|zip)$", "");
            devProjectService.recordScanResult(
                    tenant.getId(), scope.userId(), projectId, effectiveName, null, null,
                    (source != null && !source.isBlank()) ? source : "UI", scanResult
            ).ifPresent(saved -> {
                scanResult.put("persisted_scan_id", saved.getId().toString());
                scanResult.put("project_id", saved.getProjectId().toString());
            });
        }
        return scanResult;
    }

    @PostMapping(value = "/scan-url", consumes = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST') or hasAuthority('SCOPE_REPO_SCAN')")
    public Map<String, Object> scanRepositoryByUrl(
            @RequestBody ScanRepositoryUrlRequest payload,
            HttpServletRequest request
    ) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(scope.tenantId())
                .orElseThrow(() -> new AccessDeniedException("Tenant inactivo o inexistente"));

        String rawUrl = payload != null && payload.repoUrl() != null ? payload.repoUrl().trim() : "";
        Matcher matcher = GITHUB_REPO_PATTERN.matcher(rawUrl);
        if (!matcher.matches()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Ingresa un enlace válido de GitHub (ej. https://github.com/usuario/repositorio)"
            );
        }
        String owner = matcher.group(1);
        String repo = matcher.group(2);
        if ("..".equals(owner) || "..".equals(repo) || owner.contains("..") || repo.contains("..")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El enlace del repositorio no es válido");
        }

        String branch = payload != null && payload.branch() != null && !payload.branch().isBlank()
                ? payload.branch().trim()
                : (matcher.group(3) != null ? matcher.group(3).trim() : "");
        if (!branch.isEmpty() && (!SAFE_BRANCH_PATTERN.matcher(branch).matches() || branch.contains(".."))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre de la rama no es válido");
        }

        if (apiTokenService != null) {
            Object attr = request.getAttribute(ApiTokenAuthenticationFilter.API_TOKEN_ID_ATTR);
            UUID apiTokenId = attr instanceof UUID uuid ? uuid : null;
            apiTokenService.consumeScanQuotaAndTokenUse(tenant.getId(), apiTokenId);
        }

        String tarballUrl = "https://api.github.com/repos/" + owner + "/" + repo + "/tarball"
                + (branch.isEmpty() ? "" : "/" + URLEncoder.encode(branch, StandardCharsets.UTF_8).replace("+", "%20"));

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(tarballUrl))
                .timeout(Duration.ofSeconds(25))
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "OMEGA-RepoScanner/1.0")
                .GET();

        String githubToken = payload != null && payload.githubToken() != null ? payload.githubToken().trim() : "";
        if (!githubToken.isEmpty()) {
            if (githubToken.contains("\r") || githubToken.contains("\n")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El token de GitHub tiene un formato inválido");
            }
            reqBuilder.header("Authorization", "Bearer " + githubToken);
        }

        byte[] archiveBytes = downloadBoundedArchive(reqBuilder.build());
        String filename = owner + "-" + repo + ".tar.gz";
        Map<String, Object> scanResult = forwardArchiveToScanner(tenant.getId(), filename, archiveBytes);
        if (devProjectService != null && scanResult != null) {
            String canonicalUrl = "https://github.com/" + owner + "/" + repo;
            String effectiveName = (payload.projectName() != null && !payload.projectName().isBlank())
                    ? payload.projectName()
                    : owner + "/" + repo;
            devProjectService.recordScanResult(
                    tenant.getId(), scope.userId(), payload.projectId(), effectiveName, canonicalUrl, branch,
                    "URL", scanResult
            ).ifPresent(saved -> {
                scanResult.put("persisted_scan_id", saved.getId().toString());
                scanResult.put("project_id", saved.getProjectId().toString());
            });
        }
        return scanResult;
    }

    private byte[] downloadBoundedArchive(HttpRequest httpRequest) {
        try {
            HttpResponse<InputStream> resp = githubHttpClient.send(
                    httpRequest,
                    HttpResponse.BodyHandlers.ofInputStream()
            );
            int status = resp.statusCode();
            if (status == 404) {
                throw new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "No se encontró el repositorio o es privado. Si es privado, autoriza el acceso con un token de GitHub."
                );
            }
            if (status == 401 || status == 403) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "GitHub rechazó el acceso al repositorio. Verifica que el token tenga permiso de lectura sobre el repo."
                );
            }
            if (status < 200 || status >= 300) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "GitHub devolvió un error al descargar el repositorio (HTTP " + status + ")."
                );
            }

            try (InputStream in = resp.body(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[16384];
                int total = 0;
                int read;
                while ((read = in.read(buf)) != -1) {
                    total += read;
                    if (total > MAX_REMOTE_ARCHIVE_BYTES) {
                        throw new ResponseStatusException(
                                HttpStatus.PAYLOAD_TOO_LARGE,
                                "El repositorio supera el límite de 25 MiB para análisis remoto."
                        );
                    }
                    out.write(buf, 0, read);
                }
                if (total == 0) {
                    throw new ResponseStatusException(
                            HttpStatus.BAD_GATEWAY,
                            "GitHub devolvió un archivo vacío para el repositorio."
                    );
                }
                return out.toByteArray();
            }
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Se interrumpió la descarga desde GitHub.");
        } catch (IOException ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "No se pudo conectar con GitHub para descargar el repositorio."
            );
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> forwardArchiveToScanner(UUID tenantId, String filename, byte[] bytes) {
        var body = new LinkedMultiValueMap<String, Object>();
        HttpHeaders partHeaders = new HttpHeaders();
        partHeaders.setContentDisposition(ContentDisposition.formData().name("file").filename(filename).build());
        partHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        body.add("file", new HttpEntity<>(new ByteArrayResource(bytes) {
            @Override
            public String getFilename() {
                return filename;
            }
        }, partHeaders));

        try {
            return forensicWorkerRestClient.post()
                    .uri("/api/repo/scan")
                    .header("X-Tenant-Id", tenantId.toString())
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(body)
                    .retrieve()
                    .body(Map.class);
        } catch (RestClientResponseException ex) {
            throw new ResponseStatusException(
                    HttpStatus.valueOf(ex.getStatusCode().value()),
                    "El motor de análisis de repositorios rechazó la solicitud");
        }
    }

    public record ScanRepositoryUrlRequest(
            String repoUrl,
            String branch,
            String githubToken,
            UUID projectId,
            String projectName
    ) {}

    @GetMapping("/scan/{scanId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST', 'CLIENT') or hasAuthority('SCOPE_REPO_SCAN')")
    @SuppressWarnings("unchecked")
    public Map<String, Object> getScanStatus(@PathVariable String scanId) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        if (scanId == null || !SAFE_SCAN_ID_PATTERN.matcher(scanId).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Identificador de escaneo inválido");
        }
        // B-04: Verificar propiedad del tenant en DevScanRepository cuando el scanId es un UUID persistido
        if (devScanRepository != null) {
            try {
                UUID parsedId = UUID.fromString(scanId);
                if (devScanRepository.findById(parsedId).isPresent()
                        && devScanRepository.findByIdAndTenantId(parsedId, scope.tenantId()).isEmpty()) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Escaneo no encontrado en el espacio actual");
                }
            } catch (IllegalArgumentException ignored) {
                // scanId efímero no-UUID del worker; el aislamiento se propaga mediante X-Tenant-Id
            }
        }
        try {
            var uriSpec = forensicWorkerRestClient.get().uri("/api/repo/scan/{scanId}", scanId);
            var headerSpec = uriSpec.header("X-Tenant-Id", scope.tenantId().toString());
            return (headerSpec != null ? headerSpec : uriSpec)
                    .retrieve()
                    .body(Map.class);
        } catch (RestClientResponseException ex) {
            throw new ResponseStatusException(
                    HttpStatus.valueOf(ex.getStatusCode().value()),
                    "No se pudo consultar el estado del escaneo");
        }
    }
}
