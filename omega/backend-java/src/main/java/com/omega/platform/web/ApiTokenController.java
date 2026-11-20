package com.omega.platform.web;

import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.service.ApiTokenService;
import com.omega.platform.service.ApiTokenService.ApiTokenView;
import com.omega.platform.service.ApiTokenService.CreatedApiToken;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Gestión de tokens de API revocables de alcance limitado (REPO_SCAN) por tenant.
 */
@RestController
@RequestMapping("/api/v1/api-tokens")
public class ApiTokenController {

    private final ApiTokenService apiTokenService;

    public ApiTokenController(ApiTokenService apiTokenService) {
        this.apiTokenService = apiTokenService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public CreatedApiToken createToken(@Valid @RequestBody CreateApiTokenRequest request) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        return apiTokenService.createToken(
                scope.tenantId(),
                scope.userId(),
                request.name(),
                request.expiresInDays(),
                request.maxUses()
        );
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public List<ApiTokenView> listTokens() {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        return apiTokenService.listTokens(scope.tenantId());
    }

    @DeleteMapping("/{tokenId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ApiTokenView revokeToken(@PathVariable UUID tokenId) {
        TenantScope scope = TenantContext.get()
                .orElseThrow(() -> new AccessDeniedException("Se requiere contexto de tenant autenticado"));
        return apiTokenService.revokeToken(scope.tenantId(), scope.userId(), scope.role(), tokenId);
    }

    public record CreateApiTokenRequest(
            @NotBlank(message = "El nombre del token es obligatorio")
            @Size(min = 1, max = 120, message = "El nombre no puede superar 120 caracteres")
            String name,
            @Min(value = 1, message = "La expiración mínima es 1 día")
            @Max(value = 365, message = "La expiración máxima es 365 días")
            Integer expiresInDays,
            @Min(value = 1, message = "El límite mínimo de usos es 1")
            Integer maxUses
    ) {
    }
}
