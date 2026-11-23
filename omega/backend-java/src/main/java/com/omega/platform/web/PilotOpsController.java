package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.security.SessionCookieHelper;
import com.omega.platform.service.PilotOpsService;
import com.omega.platform.service.PilotOpsService.InvitationCreatedResponse;
import com.omega.platform.service.PilotOpsService.InvitationSummaryView;
import com.omega.platform.service.PilotOpsService.PilotFunnelResponse;
import com.omega.platform.service.PilotOpsService.SupportTicketCreatedResponse;
import com.omega.platform.service.PilotOpsService.SupportTicketSummaryView;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Controlador REST para las capacidades de piloto (Fases 1 a 4):
 * - GET  /api/v1/pilot/funnel
 * - POST /api/v1/pilot/telemetry
 * - POST /api/v1/auth/invitations
 * - GET  /api/v1/auth/invitations
 * - DELETE /api/v1/auth/invitations/{id}
 * - POST /api/v1/auth/invitations/accept (público con rate limit)
 * - POST /api/v1/support/report
 * - GET  /api/v1/support/tickets
 * - GET  /api/v1/public/status (público)
 */
@RestController
@RequestMapping("/api/v1")
public class PilotOpsController {

    private final PilotOpsService pilotOpsService;
    private final SessionCookieHelper sessionCookieHelper;

    @Autowired
    public PilotOpsController(
            PilotOpsService pilotOpsService,
            @Autowired(required = false) SessionCookieHelper sessionCookieHelper
    ) {
        this.pilotOpsService = pilotOpsService;
        this.sessionCookieHelper = sessionCookieHelper;
    }

    // --- Fase 1 y 2: Embudo de activación y telemetría Zero-PII ---

    @GetMapping("/pilot/funnel")
    public PilotFunnelResponse getPilotFunnel(@AuthenticationPrincipal OmegaPrincipal principal) {
        return pilotOpsService.getPilotFunnel(principal);
    }

    public record TelemetryEventRequest(
            @NotBlank @Size(max = 64) String eventName,
            Map<String, Object> properties
    ) {}

    @PostMapping("/pilot/telemetry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> recordTelemetry(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody TelemetryEventRequest request
    ) {
        pilotOpsService.recordTelemetryEvent(principal, request.eventName(), request.properties());
        return Map.of("recorded", true);
    }

    // --- Fase 3.1: Invitaciones de equipo por correo ---

    public record CreateInvitationRequest(
            @NotBlank @Size(max = 255) String email,
            Role role
    ) {}

    @PostMapping("/auth/invitations")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    public InvitationCreatedResponse createInvitation(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody CreateInvitationRequest request
    ) {
        return pilotOpsService.createInvitation(principal, request.email(), request.role());
    }

    @GetMapping("/auth/invitations")
    @PreAuthorize("hasRole('ADMIN')")
    public List<InvitationSummaryView> listInvitations(@AuthenticationPrincipal OmegaPrincipal principal) {
        return pilotOpsService.listInvitations(principal);
    }

    @DeleteMapping("/auth/invitations/{invitationId}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> revokeInvitation(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID invitationId
    ) {
        pilotOpsService.revokeInvitation(principal, invitationId);
        return Map.of("revoked", true, "id", invitationId.toString());
    }

    public record AcceptInvitationRequest(
            @NotBlank @Size(max = 160) String token,
            @NotBlank @Size(min = 2, max = 200) String fullName,
            @NotBlank @Size(min = 12, max = 128) String password
    ) {}

    @PostMapping("/auth/invitations/accept")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthTokenResponse acceptInvitation(
            @Valid @RequestBody AcceptInvitationRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse
    ) {
        String ip = httpRequest != null ? httpRequest.getRemoteAddr() : "unknown";
        AuthTokenResponse tokenResponse = pilotOpsService.acceptInvitation(
                request.token(),
                request.fullName(),
                request.password(),
                ip
        );
        if (sessionCookieHelper != null && tokenResponse.accessToken() != null) {
            sessionCookieHelper.attachSessionCookie(httpRequest, httpResponse, tokenResponse.accessToken());
        }
        return tokenResponse;
    }

    // --- Fase 3.2: Canal de soporte y reporte de problemas con contexto saneado ---

    public record CreateSupportTicketRequest(
            @NotBlank @Size(max = 32) String category,
            @NotBlank @Size(min = 5, max = 2000) String summary,
            @Size(max = 120) String currentView,
            @Size(max = 64) String lastErrorCode
    ) {}

    @PostMapping("/support/report")
    @ResponseStatus(HttpStatus.CREATED)
    public SupportTicketCreatedResponse createSupportTicket(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody CreateSupportTicketRequest request
    ) {
        return pilotOpsService.createSupportTicket(
                principal,
                request.category(),
                request.summary(),
                request.currentView(),
                request.lastErrorCode()
        );
    }

    @GetMapping("/support/tickets")
    public List<SupportTicketSummaryView> listSupportTickets(@AuthenticationPrincipal OmegaPrincipal principal) {
        return pilotOpsService.listSupportTickets(principal);
    }

    // --- Fase 4: Estado público del sistema y transparencia de planes ---

    @GetMapping("/public/status")
    public Map<String, Object> getPublicStatus() {
        return pilotOpsService.getPublicStatusAndPlans();
    }
}
