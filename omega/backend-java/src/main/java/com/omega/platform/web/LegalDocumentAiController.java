package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.LegalDocumentAiService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/legal/document-ai")
public class LegalDocumentAiController {
    private final LegalDocumentAiService service;
    public LegalDocumentAiController(LegalDocumentAiService service) { this.service=service; }
    public record Acceptance(@Pattern(regexp="[0-9a-f]{64}") String fingerprint) {}
    @GetMapping("/policy")
    public LegalDocumentAiService.Policy policy(@AuthenticationPrincipal OmegaPrincipal actor) { return service.policy(actor); }
    @PostMapping("/consent") @ResponseStatus(HttpStatus.NO_CONTENT) @PreAuthorize("hasRole('ADMIN')")
    public void accept(@AuthenticationPrincipal OmegaPrincipal actor,@Valid @RequestBody Acceptance request) { service.accept(actor,request.fingerprint()); }
}
