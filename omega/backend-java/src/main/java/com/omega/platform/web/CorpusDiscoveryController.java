package com.omega.platform.web;

import com.omega.platform.cti.CorpusDiscoveryService;
import com.omega.platform.security.OmegaPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/cti/discovery")
public class CorpusDiscoveryController {

    private final CorpusDiscoveryService discoveryService;

    public CorpusDiscoveryController(CorpusDiscoveryService discoveryService) {
        this.discoveryService = discoveryService;
    }

    @GetMapping
    public List<Map<String, Object>> listQueue(@RequestParam(value = "status", defaultValue = "PENDING") String status) {
        return discoveryService.listQueue(status);
    }

    @PostMapping("/scan")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> triggerScan() {
        int discovered = discoveryService.scanAllFeeds();
        return Map.of("ok", true, "discovered", discovered);
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> approve(
            @PathVariable("id") UUID id,
            @AuthenticationPrincipal OmegaPrincipal principal
    ) {
        return discoveryService.approveCandidate(id, principal);
    }

    @PostMapping("/{id}/reject")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> reject(
            @PathVariable("id") UUID id,
            @AuthenticationPrincipal OmegaPrincipal principal
    ) {
        return discoveryService.rejectCandidate(id, principal);
    }
}
