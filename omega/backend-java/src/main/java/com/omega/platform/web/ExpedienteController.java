package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.ExpedienteService;
import com.omega.platform.web.dto.ExpedienteDtos.CreateExpedienteRequest;
import com.omega.platform.web.dto.ExpedienteDtos.ExpedienteDetailResponse;
import com.omega.platform.web.dto.ExpedienteDtos.ExpedienteSummaryResponse;
import com.omega.platform.web.dto.ExpedienteDtos.GrantPermissionRequest;
import com.omega.platform.web.dto.ExpedienteDtos.PermissionResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/expedientes")
public class ExpedienteController {

    private final ExpedienteService expedienteService;

    public ExpedienteController(ExpedienteService expedienteService) {
        this.expedienteService = expedienteService;
    }

    @GetMapping
    public List<ExpedienteSummaryResponse> list(@AuthenticationPrincipal OmegaPrincipal principal) {
        return expedienteService.listAccessibleExpedientes(principal);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ExpedienteSummaryResponse create(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody CreateExpedienteRequest request
    ) {
        return expedienteService.createExpediente(principal, request);
    }

    @GetMapping("/{expedienteId}")
    public ExpedienteDetailResponse detail(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId
    ) {
        return expedienteService.getExpedienteDetail(principal, expedienteId);
    }

    @PostMapping("/{expedienteId}/permissions")
    public PermissionResponse grantPermission(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,
            @Valid @RequestBody GrantPermissionRequest request
    ) {
        return expedienteService.grantPermission(principal, expedienteId, request);
    }
}
