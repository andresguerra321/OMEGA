package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.LegalObservationReviewService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/expedientes/{caseId}/observations")
public class LegalObservationsController {
    private final LegalObservationReviewService service;
    public LegalObservationsController(LegalObservationReviewService service) { this.service=service; }
    public record Review(@NotBlank String status,@Size(max=1000) String note,@Min(0) int revision) {}
    @GetMapping public Map<String,Object> list(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID caseId) { return service.list(actor,caseId); }
    @PostMapping("/extract") public Map<String,Object> extract(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID caseId) { return service.extract(actor,caseId); }
    @PatchMapping("/{id}") public Map<String,Object> review(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID caseId,@PathVariable UUID id,@Valid @RequestBody Review request) {
        service.review(actor,caseId,id,request.status(),request.note(),request.revision());return Map.of("saved",true);
    }
}
