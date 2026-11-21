package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.DevSupplyChainIntelService;
import com.omega.platform.service.DevSupplyChainIntelService.SupplyChainAssistantResponse;
import com.omega.platform.service.DevSupplyChainIntelService.SupplyChainCatalogResponse;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/dev/supply-chain")
public class DevSupplyChainIntelController {

    private final DevSupplyChainIntelService supplyChainIntelService;

    public DevSupplyChainIntelController(DevSupplyChainIntelService supplyChainIntelService) {
        this.supplyChainIntelService = supplyChainIntelService;
    }

    @GetMapping("/advisories")
    public SupplyChainCatalogResponse listAdvisories(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(name = "ecosystem", required = false) String ecosystem,
            @RequestParam(name = "q", required = false) String search,
            @RequestParam(name = "projectId", required = false) UUID projectId
    ) {
        requireAuth(principal);
        return supplyChainIntelService.listAdvisories(principal, ecosystem, search, projectId);
    }

    @PostMapping("/query")
    public SupplyChainAssistantResponse querySupplyChainCorpus(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestBody Map<String, Object> body
    ) {
        requireAuth(principal);
        String question = body != null && body.get("question") != null
                ? String.valueOf(body.get("question"))
                : "";
        return supplyChainIntelService.askSupplyChainCorpus(principal, question);
    }

    private static void requireAuth(OmegaPrincipal principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Autenticación requerida");
        }
    }
}
