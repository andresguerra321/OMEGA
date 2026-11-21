package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevMonitoringService;
import com.omega.platform.service.DevMonitoringService.MonitoringEvaluationDto;
import com.omega.platform.service.DevMonitoringService.MonitoringStatusDto;
import com.omega.platform.service.DevMonitoringService.UpdateMonitoringRequest;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/dev/projects/{projectId}/monitoring")
public class DevMonitoringController {

    private final DevMonitoringService devMonitoringService;

    public DevMonitoringController(DevMonitoringService devMonitoringService) {
        this.devMonitoringService = devMonitoringService;
    }

    @GetMapping
    public MonitoringStatusDto getMonitoringStatus(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId
    ) {
        requireAuth(principal);
        return devMonitoringService.getProjectMonitoring(principal, projectId);
    }

    @PutMapping
    public MonitoringStatusDto updateMonitoring(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId,
            @RequestBody UpdateMonitoringRequest request
    ) {
        requireAuth(principal);
        return devMonitoringService.updateProjectMonitoring(principal, projectId, request);
    }

    @PostMapping("/evaluate")
    public MonitoringEvaluationDto evaluateNow(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId
    ) {
        requireAuth(principal);
        return devMonitoringService.evaluateStoredInventory(principal, projectId);
    }

    private static void requireAuth(OmegaPrincipal principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Autenticación requerida");
        }
    }
}
