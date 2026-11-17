package com.omega.platform.web;

import com.omega.platform.multimodal.MultimodalThreatQueryService;
import com.omega.platform.multimodal.MultimodalThreatQueryService.MultimodalThreatResponse;
import com.omega.platform.security.OmegaPrincipal;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/public/query")
public class PublicMultimodalController {

    private final MultimodalThreatQueryService multimodalService;

    public PublicMultimodalController(MultimodalThreatQueryService multimodalService) {
        this.multimodalService = multimodalService;
    }

    @PostMapping(value = "/multimodal", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public MultimodalThreatResponse queryPublicMultimodal(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestPart("image") MultipartFile image,
            @RequestParam(value = "question", required = false, defaultValue = "") String question
    ) throws IOException {
        return multimodalService.analyzePublicTriage(principal, image.getBytes(), question);
    }
}
