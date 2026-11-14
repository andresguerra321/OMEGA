package com.omega.platform.web;

import com.omega.platform.rag.HybridRagQueryService;
import com.omega.platform.rag.HybridRagQueryService.RagQueryRequest;
import com.omega.platform.rag.HybridRagQueryService.RagQueryResponse;
import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/expedientes/{expedienteId}/query")
public class RagQueryController {

    private final HybridRagQueryService hybridRagQueryService;

    public RagQueryController(HybridRagQueryService hybridRagQueryService) {
        this.hybridRagQueryService = hybridRagQueryService;
    }

    @PostMapping
    public RagQueryResponse query(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,
            @Valid @RequestBody RagQueryRequest request
    ) {
        return hybridRagQueryService.queryExpediente(principal, expedienteId, request);
    }
}
