package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevSbomService;
import com.omega.platform.service.DevSbomService.DependencyInventoryDto;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/dev/projects/{projectId}")
public class DevSbomController {

    private final DevSbomService devSbomService;

    public DevSbomController(DevSbomService devSbomService) {
        this.devSbomService = devSbomService;
    }

    @GetMapping("/dependencies")
    public DependencyInventoryDto listDependencies(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId,
            @RequestParam(name = "ecosystem", required = false) String ecosystem,
            @RequestParam(name = "q", required = false) String search
    ) {
        requireAuth(principal);
        return devSbomService.listProjectDependencies(principal, projectId, ecosystem, search);
    }

    @GetMapping("/sbom")
    public Map<String, Object> exportSbom(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable("projectId") UUID projectId,
            @RequestParam(name = "format", defaultValue = "cyclonedx") String format
    ) {
        requireAuth(principal);
        return devSbomService.exportProjectSbom(principal, projectId, format);
    }

    private static void requireAuth(OmegaPrincipal principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Autenticación requerida");
        }
    }
}
