package com.omega.platform.web;

import com.omega.platform.domain.*;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.LegalCaseService;
import com.omega.platform.service.LegalCaseService.*;
import com.omega.platform.service.LegalFirmSearchService;
import com.omega.platform.service.LegalFirmSearchService.FirmSearchHit;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/expedientes")
public class LegalCaseController {
    private final LegalCaseService service;
    private final LegalFirmSearchService firmSearch;

    public LegalCaseController(LegalCaseService service) {
        this(service, null);
    }

    @Autowired
    public LegalCaseController(LegalCaseService service, LegalFirmSearchService firmSearch) {
        this.service = service;
        this.firmSearch = firmSearch;
    }

    @GetMapping("/search")
    public PageView<FirmSearchHit> firmSearch(
            @AuthenticationPrincipal OmegaPrincipal actor,
            @RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        if (firmSearch == null) {
            return new PageView<>(java.util.List.of(), page, size, 0, 0);
        }
        return firmSearch.search(actor, q, page, size);
    }
    @PostMapping("/full") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    @org.springframework.security.access.prepost.PreAuthorize("hasAnyRole('ADMIN','ANALYST')")
    public CaseView create(@AuthenticationPrincipal OmegaPrincipal actor,@Valid @RequestBody UpdateCase request) {
        return service.create(actor,request);
    }
    @GetMapping("/page")
    public PageView<CaseView> list(@AuthenticationPrincipal OmegaPrincipal actor,
            @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="20") int size,
            @RequestParam(defaultValue="") String search, @RequestParam(required=false) ExpedienteStatus status,
            @RequestParam(required=false) ClassificationLevel classification, @RequestParam(defaultValue="updated") String order) {
        return service.list(actor,page,size,search,status,classification,order);
    }
    @GetMapping("/{id}/metadata")
    public CaseView metadata(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id) { return service.metadata(actor,id); }
    @PutMapping("/{id}/metadata")
    public CaseView update(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id,@Valid @RequestBody UpdateCase request) {
        return service.update(actor,id,request);
    }
    @GetMapping("/{id}/documents/page")
    public PageView<DocumentView> documents(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id,
            @RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) { return service.documents(actor,id,page,size); }
    @GetMapping("/{id}/documents/{documentId}/detail")
    public DocumentView document(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id,@PathVariable UUID documentId) {
        return service.document(actor,id,documentId);
    }
    @GetMapping("/{id}/documents/{documentId}/text")
    public TextPage text(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id,@PathVariable UUID documentId,
            @RequestParam(defaultValue="1") int pageNumber) { return service.text(actor,id,documentId,pageNumber); }
    @GetMapping("/{id}/activity/page")
    public PageView<Activity> activity(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id,
            @RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) { return service.activity(actor,id,page,size); }
}
