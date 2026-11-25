package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AnalysisEvidenceService;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/expedientes/{caseId}/evaluations")
public class AnalysisEvidenceController {
    private final AnalysisEvidenceService service;
    public AnalysisEvidenceController(AnalysisEvidenceService service) { this.service=service; }
    @GetMapping public Map<String,Object> list(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID caseId) {
        return Map.of("items",service.list(actor,caseId),"canWrite",service.canWrite(actor,caseId));
    }
    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID caseId,@PathVariable UUID id) { service.delete(actor,caseId,id); }
}
