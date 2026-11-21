package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.LegalTimelineService;
import com.omega.platform.service.LegalTimelineService.ExtractResult;
import com.omega.platform.service.LegalTimelineService.ReviewRequest;
import com.omega.platform.service.LegalTimelineService.TimelineEventView;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/expedientes/{expedienteId}/timeline")
public class LegalTimelineController {

    private final LegalTimelineService timelineService;

    public LegalTimelineController(LegalTimelineService timelineService) {
        this.timelineService = timelineService;
    }

    @GetMapping
    public List<TimelineEventView> list(
            @AuthenticationPrincipal OmegaPrincipal actor,
            @PathVariable UUID expedienteId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID documentId,
            @RequestParam(defaultValue = "false") boolean includeHidden
    ) {
        return timelineService.list(actor, expedienteId, status, documentId, includeHidden);
    }

    @PostMapping("/extract")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ExtractResult extract(
            @AuthenticationPrincipal OmegaPrincipal actor,
            @PathVariable UUID expedienteId
    ) {
        return timelineService.extractFromIndexedDocuments(actor, expedienteId);
    }

    @PatchMapping("/{eventId}")
    public TimelineEventView review(
            @AuthenticationPrincipal OmegaPrincipal actor,
            @PathVariable UUID expedienteId,
            @PathVariable UUID eventId,
            @Valid @RequestBody ReviewRequest request
    ) {
        return timelineService.reviewEvent(actor, expedienteId, eventId, request);
    }
}
