package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevProjectService;
import com.omega.platform.service.DevProjectService.ProjectDetailDto;
import com.omega.platform.service.DevProjectService.ProjectSummaryDto;
import com.omega.platform.service.DevProjectService.ScanComparisonDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/dev/projects")
public class DevProjectController {

    private final DevProjectService projectService;

    public DevProjectController(DevProjectService projectService) {
        this.projectService = projectService;
    }

    @GetMapping
    public List<ProjectSummaryDto> listProjects(@AuthenticationPrincipal OmegaPrincipal principal) {
        return projectService.listProjects(principal);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ProjectSummaryDto createProject(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody CreateProjectRequest request
    ) {
        return projectService.createProject(
                principal, request.name(), request.repoUrl(), request.defaultBranch(), request.sourceType());
    }

    @GetMapping("/{projectId}")
    public ProjectDetailDto getProject(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID projectId
    ) {
        return projectService.getProjectDetail(principal, projectId);
    }

    @GetMapping("/{projectId}/compare")
    public ScanComparisonDto compareScans(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID projectId,
            @RequestParam UUID baseScanId,
            @RequestParam UUID headScanId
    ) {
        return projectService.compareScans(principal, projectId, baseScanId, headScanId);
    }

    @DeleteMapping("/{projectId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> deleteProject(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID projectId
    ) {
        projectService.deleteProject(principal, projectId);
        return Map.of("deleted", true, "projectId", projectId.toString());
    }

    public record CreateProjectRequest(
            @NotBlank @Size(min = 2, max = 160) String name,
            @Size(max = 500) String repoUrl,
            @Size(max = 120) String defaultBranch,
            @Size(max = 24) String sourceType
    ) {}
}
