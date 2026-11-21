package com.omega.platform.web;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.multimodal.MultimodalThreatQueryService;
import com.omega.platform.multimodal.MultimodalThreatQueryService.MultimodalThreatResponse;
import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Validated
@RestController
@RequestMapping("/api/v1/public/query")
public class PublicMultimodalController {

    private static final long DEFAULT_MAX_IMAGE_BYTES = 10L * 1024 * 1024;

    private final MultimodalThreatQueryService multimodalService;
    private final long maxImageBytes;

    public PublicMultimodalController(MultimodalThreatQueryService multimodalService) {
        this(multimodalService, null);
    }

    @Autowired
    public PublicMultimodalController(
            MultimodalThreatQueryService multimodalService,
            @Autowired(required = false) OmegaProperties properties
    ) {
        this.multimodalService = multimodalService;
        this.maxImageBytes = properties != null && properties.ingest() != null && properties.ingest().maxImageBytes() > 0
                ? properties.ingest().maxImageBytes()
                : DEFAULT_MAX_IMAGE_BYTES;
    }

    @PostMapping(value = "/multimodal", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public MultimodalThreatResponse queryPublicMultimodal(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestPart("image") MultipartFile image,
            @RequestParam(value = "question", required = false, defaultValue = "") @Size(max = 2000) String question
    ) throws IOException {
        if (image == null || image.isEmpty()) {
            throw new InvalidDocumentException("La imagen está vacía o no se recibió contenido.");
        }
        // B-08: Validar tamaño antes de cargar bytes al heap
        if (image.getSize() > maxImageBytes) {
            throw new ResponseStatusException(
                    HttpStatus.PAYLOAD_TOO_LARGE,
                    "La imagen excede el tamaño máximo permitido (" + (maxImageBytes / (1024 * 1024)) + " MB)."
            );
        }
        return multimodalService.analyzePublicTriage(principal, image.getBytes(), question);
    }
}
