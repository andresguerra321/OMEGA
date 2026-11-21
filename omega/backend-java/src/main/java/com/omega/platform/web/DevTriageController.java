package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevTriageService;
import com.omega.platform.service.DevTriageService.CommentViewDto;
import com.omega.platform.service.DevTriageService.FindingViewDto;
import com.omega.platform.service.DevTriageService.SuppressionViewDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/dev")
public class DevTriageController {

    private final DevTriageService triageService;

    public DevTriageController(DevTriageService triageService) {
        this.triageService = triageService;
    }

    @GetMapping("/findings")
    public List<FindingViewDto> listFindings(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(required = false) UUID projectId,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String ruleId,
            @RequestParam(required = false) String triageStatus
    ) {
        return triageService.listFindings(principal, projectId, severity, ruleId, triageStatus);
    }

    @PatchMapping("/findings/{findingId}/triage")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public FindingViewDto updateTriage(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID findingId,
            @Valid @RequestBody UpdateTriageRequest request
    ) {
        return triageService.updateTriageStatus(principal, findingId, request.status(), request.comment());
    }

    @GetMapping("/findings/{findingId}/comments")
    public List<CommentViewDto> listComments(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID findingId
    ) {
        return triageService.listComments(principal, findingId);
    }

    @PostMapping("/findings/{findingId}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public CommentViewDto addComment(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID findingId,
            @Valid @RequestBody AddCommentRequest request
    ) {
        return triageService.addComment(principal, findingId, request.body());
    }

    @GetMapping("/projects/{projectId}/suppressions")
    public List<SuppressionViewDto> listSuppressions(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID projectId
    ) {
        return triageService.listSuppressions(principal, projectId);
    }

    @PostMapping("/projects/{projectId}/suppressions")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public SuppressionViewDto createSuppression(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID projectId,
            @Valid @RequestBody CreateSuppressionRequest request
    ) {
        return triageService.createSuppression(
                principal, projectId, request.ruleId(), request.fingerprint(),
                request.reason(), request.expiresInDays());
    }

    @DeleteMapping("/suppressions/{suppressionId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public SuppressionViewDto revokeSuppression(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID suppressionId
    ) {
        return triageService.revokeSuppression(principal, suppressionId);
    }

    public record UpdateTriageRequest(
            @NotBlank String status,
            @Size(max = 1000) String comment
    ) {}

    public record AddCommentRequest(
            @NotBlank @Size(min = 1, max = 1000) String body
    ) {}

    public record CreateSuppressionRequest(
            @NotBlank @Size(max = 80) String ruleId,
            @Size(max = 64) String fingerprint,
            @NotBlank @Size(min = 3, max = 400) String reason,
            @NotNull Integer expiresInDays
    ) {}
}
