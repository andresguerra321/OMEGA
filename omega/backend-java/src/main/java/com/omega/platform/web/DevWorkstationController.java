package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevWorkstationService;
import com.omega.platform.service.DevWorkstationService.WorkstationAuditRequest;
import com.omega.platform.service.DevWorkstationService.WorkstationAuditResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/dev/workstation")
public class DevWorkstationController {

    private final DevWorkstationService devWorkstationService;

    public DevWorkstationController(DevWorkstationService devWorkstationService) {
        this.devWorkstationService = devWorkstationService;
    }

    @PostMapping("/audit")
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.DEV_AUDIT)
    public WorkstationAuditResponse runAudit(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestBody WorkstationAuditRequest request
    ) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Autenticación requerida");
        }
        return devWorkstationService.runReadOnlyPostureAudit(principal, request);
    }
}
