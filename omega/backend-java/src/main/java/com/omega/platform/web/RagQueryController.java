package com.omega.platform.web;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.multimodal.MultimodalThreatQueryService;
import com.omega.platform.multimodal.MultimodalThreatQueryService.MultimodalThreatResponse;
import com.omega.platform.rag.HybridRagQueryService;
import com.omega.platform.rag.HybridRagQueryService.RagQueryRequest;
import com.omega.platform.rag.HybridRagQueryService.RagQueryResponse;
import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Validated
@RestController
@RequestMapping("/api/v1/expedientes/{expedienteId}/query")
public class RagQueryController {

    private static final long DEFAULT_MAX_IMAGE_BYTES = 10L * 1024 * 1024;

    private final HybridRagQueryService hybridRagQueryService;
    private final MultimodalThreatQueryService multimodalService;
    private final long maxImageBytes;

    public RagQueryController(HybridRagQueryService hybridRagQueryService) {
        this(hybridRagQueryService, null, null);
    }

    public RagQueryController(
            HybridRagQueryService hybridRagQueryService,
            MultimodalThreatQueryService multimodalService
    ) {
        this(hybridRagQueryService, multimodalService, null);
    }

    @Autowired
    public RagQueryController(
            HybridRagQueryService hybridRagQueryService,
            @Autowired(required = false) MultimodalThreatQueryService multimodalService,
            @Autowired(required = false) OmegaProperties properties
    ) {
        this.hybridRagQueryService = hybridRagQueryService;
        this.multimodalService = multimodalService;
        this.maxImageBytes = properties != null && properties.ingest() != null && properties.ingest().maxImageBytes() > 0
                ? properties.ingest().maxImageBytes()
                : DEFAULT_MAX_IMAGE_BYTES;
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
            @RequestParam(value = "question", required = false, defaultValue = "") @Size(max = 2000) String question
    ) throws IOException {
        if (multimodalService == null) {
            throw new IllegalStateException("Servicio multimodal no inicializado.");
        }
        if (image == null || image.isEmpty()) {
            throw new InvalidDocumentException("La imagen está vacía o no se recibió contenido.");
        }
        if (image.getSize() > maxImageBytes) {
            throw new ResponseStatusException(
                    HttpStatus.PAYLOAD_TOO_LARGE,
                    "La imagen excede el tamaño máximo permitido (" + (maxImageBytes / (1024 * 1024)) + " MB)."
            );
        }
        return multimodalService.analyzePrivateExpediente(principal, expedienteId, image.getBytes(), question);
    }
}
