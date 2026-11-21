package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.ExpedienteService;
import com.omega.platform.cti.ForensicDossierExportService;
import com.omega.platform.cti.ForensicDossierExportService.DossierExportPayload;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
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
import org.springframework.web.bind.annotation.DeleteMapping;
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
    private final ForensicDossierExportService dossierExport;

    public ExpedienteController(ExpedienteService expedienteService, ForensicDossierExportService dossierExport) {
        this.expedienteService = expedienteService;
        this.dossierExport = dossierExport;
    }

    @GetMapping(value = "/{expedienteId}/export/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> exportPdf(@PathVariable UUID expedienteId) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"OMEGA-" + expedienteId + ".pdf\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store").header("X-Content-Type-Options", "nosniff")
                .body(dossierExport.exportAsPdf(expedienteId));
    }

    @GetMapping(value = "/{expedienteId}/export/json", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<DossierExportPayload> exportJson(@PathVariable UUID expedienteId) {
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"OMEGA-" + expedienteId + ".json\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store").header("X-Content-Type-Options", "nosniff")
                .body(dossierExport.exportAsJson(expedienteId));
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

    @DeleteMapping("/{expedienteId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public void delete(@AuthenticationPrincipal OmegaPrincipal principal, @PathVariable UUID expedienteId) {
        expedienteService.deleteExpediente(principal, expedienteId);
    }

    @PostMapping("/{expedienteId}/permissions")
    public PermissionResponse grantPermission(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,
            @Valid @RequestBody GrantPermissionRequest request
    ) {
        return expedienteService.grantPermission(principal, expedienteId, request);
    }

    @GetMapping("/{expedienteId}/permissions")
    public List<PermissionResponse> listPermissions(
            @AuthenticationPrincipal OmegaPrincipal principal, @PathVariable UUID expedienteId) {
        return expedienteService.listPermissions(principal, expedienteId);
    }

    @DeleteMapping("/{expedienteId}/permissions/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokePermission(
            @AuthenticationPrincipal OmegaPrincipal principal, @PathVariable UUID expedienteId, @PathVariable UUID userId) {
        expedienteService.revokePermission(principal, expedienteId, userId);
    }
}
