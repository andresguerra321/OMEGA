package com.omega.platform.web;

import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.service.GitHubAppIntegrationService;
import com.omega.platform.service.GitHubAppIntegrationService.InstallationView;
import com.omega.platform.service.GitHubAppIntegrationService.LinkStateResponse;
import com.omega.platform.service.GitHubBrowserOAuth;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
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
    private final GitHubBrowserOAuth browserOAuth;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.repository.TenantRepository tenantRepository;

    public GitHubIntegrationController(GitHubAppIntegrationService integrationService, GitHubBrowserOAuth browserOAuth) {
        this.integrationService = integrationService;
        this.browserOAuth = browserOAuth;
    }

    private void requireAdminOrIndividualOwner(TenantScope scope) {
        if (scope.role() == com.omega.platform.security.Role.ADMIN) {
            return;
        }
        boolean isIndividualOwner = tenantRepository != null
                && tenantRepository.findByIdAndActiveTrue(scope.tenantId())
                        .map(t -> "INDIVIDUAL".equalsIgnoreCase(t.getAccountType())
                                && scope.userId().equals(t.getOwnerUserId()))
                        .orElse(false);
        if (!isIndividualOwner) {
            throw new AccessDeniedException("Solo un administrador puede gestionar la integración de GitHub App.");
        }
    }

    @PostMapping("/connect")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ConnectRedirect connect() {
        TenantScope scope = browserLinkScope();
        var state = integrationService.createLinkState(scope.tenantId(), scope.userId());
        return new ConnectRedirect(browserOAuth.installationUrl(state.state()), state.state());
    }

    @PostMapping("/connect/authorize")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ConnectRedirect authorize(@Valid @RequestBody ConnectInstallation request) {
        TenantScope scope = browserLinkScope();
        integrationService.verifyPendingLink(scope.tenantId(), scope.userId(), request.state());
        return new ConnectRedirect(browserOAuth.authorizationUrl(request.state(), request.installationId()), request.state());
    }

    @PostMapping("/connect/complete")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public InstallationView complete(@Valid @RequestBody ConnectAuthorization request) {
        TenantScope scope = browserLinkScope();
        integrationService.verifyPendingLink(scope.tenantId(), scope.userId(), request.state());
        String token = browserOAuth.exchangeCode(request.state(), request.installationId(), request.code());
        return integrationService.completeBrowserLink(scope.tenantId(), scope.userId(), request.state(), request.installationId(), token);
    }

    private TenantScope browserLinkScope() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        requireAdminOrIndividualOwner(scope);
        browserOAuth.requireConfigured();
        return scope;
    }

    public record ConnectRedirect(URI url, String state) {}
    public record ConnectInstallation(@NotBlank @Size(max = 128) String state, @Positive long installationId) {}
    public record ConnectAuthorization(@NotBlank @Size(max = 128) String state, @Positive long installationId,
                                       @NotBlank @Size(max = 512) String code) {}

    @PostMapping("/state")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public LinkStateResponse createLinkState() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        requireAdminOrIndividualOwner(scope);
        return integrationService.createLinkState(scope.tenantId(), scope.userId());
    }

    @PostMapping("/link")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public InstallationView linkInstallation(@Valid @RequestBody LinkInstallationRequest request) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        requireAdminOrIndividualOwner(scope);
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
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ResponseEntity<InstallationView> getStatus() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        requireAdminOrIndividualOwner(scope);
        return integrationService.getInstallationStatus(scope.tenantId())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @DeleteMapping("/link")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> unlinkInstallation() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        requireAdminOrIndividualOwner(scope);
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
        boolean newlyAccepted = integrationService.acceptWebhookAsync(rawBody, signature, deliveryId, eventType);
        if (!newlyAccepted) {
            return ResponseEntity.ok(Map.of("accepted", true, "duplicate", true));
        }
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("accepted", true, "duplicate", false));
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
