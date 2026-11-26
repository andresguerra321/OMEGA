package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.LegalConflictService;
import com.omega.platform.service.LegalConflictService.ConflictCheckResponse;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/legal")
public class LegalConflictController {

    private final LegalConflictService conflictService;

    public LegalConflictController(LegalConflictService conflictService) {
        this.conflictService = conflictService;
    }

    @GetMapping("/conflicts")
    public ConflictCheckResponse checkConflicts(
            @AuthenticationPrincipal OmegaPrincipal actor,
            @RequestParam(name = "name") String name,
            @RequestParam(name = "excludeCaseId", required = false) UUID excludeCaseId
    ) {
        return conflictService.checkConflicts(actor, name, excludeCaseId);
    }
}
