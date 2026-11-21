package com.omega.platform.web;

import com.omega.platform.ingest.DocumentIngestionService;
import com.omega.platform.ingest.DocumentIngestionService.IngestAcceptedResult;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.web.dto.ExpedienteDtos.DocumentMetadataResponse;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/expedientes/{expedienteId}/documents")
public class DocumentController {

    private final DocumentIngestionService documentIngestionService;
    private final com.omega.platform.service.LegalDocumentAiService legalAi;

    public DocumentController(DocumentIngestionService documentIngestionService,
            com.omega.platform.service.LegalDocumentAiService legalAi) {
        this.documentIngestionService = documentIngestionService;
        this.legalAi = legalAi;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public ResponseEntity<DocumentMetadataResponse> uploadPdf(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,
            @RequestPart("file") MultipartFile file
    ) {
        IngestAcceptedResult accepted = documentIngestionService.ingestPdf(principal, expedienteId, file);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(accepted.document());
    }

    @GetMapping
    public List<DocumentMetadataResponse> list(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId
    ) {
        return documentIngestionService.listDocuments(principal, expedienteId);
    }

    @PostMapping("/mark-reindex-required")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public List<DocumentMetadataResponse> markReindexRequired(
            @AuthenticationPrincipal OmegaPrincipal principal, @PathVariable UUID expedienteId) {
        return documentIngestionService.markReindexRequired(principal, expedienteId);
    }

    @PostMapping("/{documentId}/reindex")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public DocumentMetadataResponse reindex(@AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,@PathVariable UUID documentId) {
        return legalAi.reindex(principal,expedienteId,documentId);
    }

    @DeleteMapping("/{documentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public void delete(@AuthenticationPrincipal OmegaPrincipal principal, @PathVariable UUID expedienteId,
            @PathVariable UUID documentId) {
        documentIngestionService.deleteDocument(principal, expedienteId, documentId);
    }

    @GetMapping("/{documentId}")
    public DocumentMetadataResponse status(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID expedienteId,
            @PathVariable UUID documentId
    ) {
        return documentIngestionService.getDocumentStatus(principal, expedienteId, documentId);
    }
}
