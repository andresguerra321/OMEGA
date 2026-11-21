package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevPolicyService;
import com.omega.platform.service.DevPolicyService.PolicyDto;
import com.omega.platform.service.DevPolicyService.UpsertPolicyRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/dev")
public class DevPolicyController {

    private final DevPolicyService devPolicyService;

    public DevPolicyController(DevPolicyService devPolicyService) {
        this.devPolicyService = devPolicyService;
    }

    @GetMapping("/policies")
    public PolicyDto getTenantPolicy(@AuthenticationPrincipal OmegaPrincipal principal) {
        requireAuth(principal);
        return devPolicyService.getTenantPolicy(principal);
    }

    @PutMapping("/policies")
    public PolicyDto updateTenantPolicy(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestBody UpsertPolicyRequest request
    ) {
        requireAuth(principal);
        return devPolicyService.upsertTenantPolicy(principal, request);
    }

    @GetMapping("/projects/{projectId}/policy")
    public PolicyDto getProjectPolicy(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId
    ) {
        requireAuth(principal);
        return devPolicyService.getProjectPolicy(principal, projectId);
    }

    @PutMapping("/projects/{projectId}/policy")
    public PolicyDto updateProjectPolicy(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId,
            @RequestBody UpsertPolicyRequest request
    ) {
        requireAuth(principal);
        return devPolicyService.upsertProjectPolicy(principal, projectId, request);
    }

    @DeleteMapping("/projects/{projectId}/policy")
    public Map<String, Object> removeProjectPolicyOverride(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId
    ) {
        requireAuth(principal);
        devPolicyService.deleteProjectPolicyOverride(principal, projectId);
        return Map.of("removed", true, "projectId", projectId);
    }

    private static void requireAuth(OmegaPrincipal principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Autenticación requerida");
        }
    }
}
