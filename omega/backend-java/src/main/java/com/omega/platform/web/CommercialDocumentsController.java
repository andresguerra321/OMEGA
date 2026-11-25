package com.omega.platform.web;

import com.omega.platform.service.CommercialDocuments;
import com.omega.platform.security.OmegaPrincipal;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class CommercialDocumentsController {
    private final CommercialDocuments documents;
    public CommercialDocumentsController(CommercialDocuments documents) { this.documents=documents; }
    @GetMapping("/public/commercial") public Map<String,Object> configuration() { return documents.configuration(); }
    @GetMapping("/commercial/acceptance") public Map<String,Object> acceptance(@AuthenticationPrincipal OmegaPrincipal actor) {
        return Map.of("accepted",documents.accepted(actor));
    }
    public record Acceptance(String version) {}
    @PostMapping("/commercial/acceptance") public Map<String,Object> accept(@AuthenticationPrincipal OmegaPrincipal actor,@RequestBody Acceptance request) {
        documents.accept(actor,request.version()); return Map.of("accepted",true);
    }
}
