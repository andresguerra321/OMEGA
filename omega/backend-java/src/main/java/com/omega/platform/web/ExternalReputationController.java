package com.omega.platform.web;

import com.omega.platform.cti.ExternalReputationService;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/cti")
public class ExternalReputationController {

    private final ExternalReputationService reputationService;

    public ExternalReputationController(ExternalReputationService reputationService) {
        this.reputationService = reputationService;
    }

    @GetMapping("/reputation")
    public Map<String, Object> lookupReputation(@RequestParam("indicator") String indicator) {
        return reputationService.lookupIndicator(indicator);
    }
}
