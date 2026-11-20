package com.omega.platform.web;

import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.service.GitHubAppIntegrationService;
import com.omega.platform.service.GitHubAppIntegrationService.InstallationView;
import com.omega.platform.service.GitHubAppIntegrationService.LinkStateResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Integración GitHub App (solo lectura; requiere modo CLOUD_MANAGED con URL pública para webhooks).
 */
@RestController
@RequestMapping("/api/v1/integrations/github")
public class GitHubIntegrationController {

    private final GitHubAppIntegrationService integrationService;

    public GitHubIntegrationController(GitHubAppIntegrationService integrationService) {
        this.integrationService = integrationService;
    }

    @PostMapping("/state")
    @PreAuthorize("hasRole('ADMIN')")
    public LinkStateResponse createLinkState() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        return integrationService.createLinkState(scope.tenantId(), scope.userId());
    }

    @PostMapping("/link")
    @PreAuthorize("hasRole('ADMIN')")
    public InstallationView linkInstallation(@Valid @RequestBody LinkInstallationRequest request) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        return integrationService.completeInstallationLink(
                scope.tenantId(),
                scope.userId(),
                request.state(),
                request.installationId(),
                request.userAccessToken(),
                request.accountLogin()
        );
    }

    @GetMapping("/status")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<InstallationView> getStatus() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        return integrationService.getInstallationStatus(scope.tenantId())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @DeleteMapping("/link")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> unlinkInstallation() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        integrationService.unlinkInstallation(scope.tenantId(), scope.userId());
        return Map.of("unlinked", true);
    }

    @PostMapping("/webhook")
    public ResponseEntity<Map<String, Object>> receiveWebhook(
            HttpServletRequest request,
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestHeader(value = "X-GitHub-Delivery", required = false) String deliveryId,
            @RequestHeader(value = "X-GitHub-Event", required = false) String eventType
    ) {
        byte[] rawBody = readBoundedBody(request, GitHubAppIntegrationService.MAX_WEBHOOK_BYTES);
        integrationService.acceptWebhookAsync(rawBody, signature, deliveryId, eventType);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("accepted", true));
    }

    private static byte[] readBoundedBody(HttpServletRequest request, int maxBytes) {
        try (InputStream is = request.getInputStream()) {
            byte[] chunk = is.readNBytes(maxBytes + 1);
            if (chunk.length > maxBytes) {
                throw new ResponseStatusException(
                        HttpStatus.PAYLOAD_TOO_LARGE,
                        "El payload del webhook supera el límite de 1 MiB");
            }
            return chunk;
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No se pudo leer el cuerpo del webhook");
        }
    }

    public record LinkInstallationRequest(
            @NotBlank(message = "El parámetro state es obligatorio")
            String state,
            @Positive(message = "installationId inválido")
            long installationId,
            @NotBlank(message = "Se requiere el token de usuario de GitHub para verificar autorización")
            String userAccessToken,
            String accountLogin
    ) {
    }
}
