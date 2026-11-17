package com.omega.platform.web;

import com.omega.platform.multimodal.MultimodalThreatQueryService;
import com.omega.platform.multimodal.MultimodalThreatQueryService.MultimodalThreatResponse;
import com.omega.platform.rag.HybridRagQueryService;
import com.omega.platform.rag.HybridRagQueryService.RagQueryRequest;
import com.omega.platform.rag.HybridRagQueryService.RagQueryResponse;
import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/expedientes/{expedienteId}/query")
public class RagQueryController {

    private final HybridRagQueryService hybridRagQueryService;
    private final MultimodalThreatQueryService multimodalService;

    public RagQueryController(HybridRagQueryService hybridRagQueryService) {
        this(hybridRagQueryService, null);
    }

    @Autowired
    public RagQueryController(
            HybridRagQueryService hybridRagQueryService,
            @Autowired(required = false) MultimodalThreatQueryService multimodalService
    ) {
        this.hybridRagQueryService = hybridRagQueryService;
        this.multimodalService = multimodalService;
    }

    @PostMapping
    public RagQueryResponse query(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,
            @Valid @RequestBody RagQueryRequest request
    ) {
        return hybridRagQueryService.queryExpediente(principal, expedienteId, request);
    }

    @PostMapping(value = "/multimodal", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public MultimodalThreatResponse queryMultimodal(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,
            @RequestPart("image") MultipartFile image,
            @RequestParam(value = "question", required = false, defaultValue = "") String question
    ) throws IOException {
        if (multimodalService == null) {
            throw new IllegalStateException("Servicio multimodal no inicializado.");
        }
        return multimodalService.analyzePrivateExpediente(principal, expedienteId, image.getBytes(), question);
    }
}
