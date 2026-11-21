package com.omega.platform.service;

import com.omega.platform.domain.*;
import com.omega.platform.repository.*;
import com.omega.platform.security.*;
import com.omega.platform.ingest.DocumentIngestionService;
import com.omega.platform.web.dto.ExpedienteDtos.DocumentMetadataResponse;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LegalCaseService {
    private final ExpedienteRepository cases;
    private final DocumentRepository documents;
    private final DocumentChunkRepository chunks;
    private final ExpedientePermissionRepository permissions;
    private final AuditLogRepository logs;
    private final AuditLogService audit;
    private final ExpedienteAuthorizationService authorization;
    public LegalCaseService(ExpedienteRepository cases, DocumentRepository documents, DocumentChunkRepository chunks,
            ExpedientePermissionRepository permissions, AuditLogRepository logs, AuditLogService audit,
            ExpedienteAuthorizationService authorization) {
        this.cases=cases; this.documents=documents; this.chunks=chunks; this.permissions=permissions;
        this.logs=logs; this.audit=audit; this.authorization=authorization;
    }

    public record CaseView(UUID id, UUID ownerUserId, String title, ClassificationLevel classification,
            String description, String reference, ExpedienteStatus status, Instant createdAt, Instant updatedAt,
            boolean canWrite, boolean canManagePermissions) {}
    public record UpdateCase(@NotBlank @Size(min=3,max=255) String title, @NotNull ClassificationLevel classification,
            @Size(max=10000) String description, @Size(max=160) String reference, @NotNull ExpedienteStatus status) {}
    public record PageView<T>(List<T> content, int page, int size, long totalElements, int totalPages) {
        static <T> PageView<T> of(Page<T> value) {
            return new PageView<>(value.getContent(), value.getNumber(), value.getSize(), value.getTotalElements(), value.getTotalPages());
        }
    }
    public record DocumentView(DocumentMetadataResponse metadata, String format, String failureCode, String reason) {}
    public record Fragment(UUID id, int order, String text, String section) {}
    public record TextPage(UUID documentId, int pageNumber, List<Fragment> fragments) {}
    public record Activity(UUID id, Long sequence, UUID actorUserId, String action, String resourceType,
            String resourceId, String metadataJson, String hash, Instant createdAt) {}

    @Transactional(readOnly=true)
    public PageView<CaseView> list(OmegaPrincipal actor, int page, int size, String search,
            ExpedienteStatus status, ClassificationLevel classification, String order) {
        String field = switch (order) { case "title" -> "title"; case "created" -> "createdAt"; default -> "updatedAt"; };
        Sort sort = Sort.by(field.equals("title") ? Sort.Direction.ASC : Sort.Direction.DESC, field).and(Sort.by("id"));
        return PageView.of(cases.searchAccessible(actor.tenantId(), actor.userId(), actor.role()==Role.ADMIN,
                search == null ? "" : search.strip(), status, classification, page(page,size,sort)).map(value -> view(actor,value)));
    }

    @Transactional
    public CaseView metadata(OmegaPrincipal actor, UUID id) {
        var value=authorization.requireReadAccess(actor,id);
        audit.record(actor.tenantId(),actor.userId(),"EXPEDIENTE_VIEWED","EXPEDIENTE",id.toString(),Map.of());
        return view(actor,value);
    }

    @Transactional
    public CaseView update(OmegaPrincipal actor, UUID id, UpdateCase request) {
        var value=authorization.requireWriteAccess(actor,id);
        value.setTitle(request.title().strip()); value.setClassification(request.classification());
        value.setDescription(request.description()==null ? "" : request.description().strip());
        value.setCaseReference(request.reference()==null ? "" : request.reference().strip()); value.setStatus(request.status());
        cases.saveAndFlush(value);
        audit.record(actor.tenantId(),actor.userId(),"EXPEDIENTE_UPDATED","EXPEDIENTE",id.toString(),Map.of("status",value.getStatus().name()));
        return view(actor,value);
    }

    private CaseView view(OmegaPrincipal actor, ExpedienteEntity value) {
        boolean manages=actor.role()==Role.ADMIN || value.getOwnerUserId().equals(actor.userId());
        boolean writes=manages || permissions.findByTenantIdAndExpedienteIdAndUserId(actor.tenantId(),value.getId(),actor.userId())
                .map(grant -> grant.getPermission()==ExpedientePermissionLevel.WRITE).orElse(false);
        return new CaseView(value.getId(),value.getOwnerUserId(),value.getTitle(),value.getClassification(),value.getDescription(),
                value.getCaseReference(),value.getStatus(),value.getCreatedAt(),value.getUpdatedAt(),writes,manages);
    }

    @Transactional(readOnly=true)
    public PageView<DocumentView> documents(OmegaPrincipal actor, UUID id, int page, int size) {
        authorization.requireReadAccess(actor,id);
        return PageView.of(documents.findAllByTenantIdAndExpedienteId(actor.tenantId(),id,
                page(page,size,Sort.by(Sort.Direction.DESC,"createdAt").and(Sort.by("id")))).map(this::documentView));
    }

    @Transactional
    public DocumentView document(OmegaPrincipal actor, UUID id, UUID documentId) {
        var document=requireDocument(actor,id,documentId);
        audit.record(actor.tenantId(),actor.userId(),"DOCUMENT_VIEWED","EXPEDIENTE",id.toString(),Map.of("documentId",documentId.toString()));
        return documentView(document);
    }

    private DocumentView documentView(DocumentEntity value) {
        String reason=value.getFailureCode()==null ? "" : switch(value.getFailureCode()) {
            case "UNSAFE_PDF" -> "El PDF contiene elementos activos que no podemos aceptar.";
            case "TEXT_UNAVAILABLE" -> "No se pudo extraer texto. Revisa que el OCR esté disponible y el documento sea legible.";
            case "TEMP_DELETE_FAILED" -> "No se pudo completar la limpieza temporal. Contacta al administrador.";
            default -> "No se pudo procesar el documento. Revisa el formato y vuelve a intentarlo.";
        };
        return new DocumentView(DocumentIngestionService.toMetadataResponse(value),value.getDocumentFormat(),value.getFailureCode(),reason);
    }

    @Transactional
    public TextPage text(OmegaPrincipal actor, UUID id, UUID documentId, int pageNumber) {
        var document=requireDocument(actor,id,documentId);
        if(pageNumber<1 || pageNumber>document.getTotalPages()) throw new ResourceNotFoundException("Página no disponible");
        var fragments=chunks.findAllByTenantIdAndDocumentIdAndPageNumberOrderByChunkOrderAsc(actor.tenantId(),documentId,pageNumber)
                .stream().map(value -> new Fragment(value.getId(),value.getChunkOrder(),value.getContent(),value.getSectionTitle())).toList();
        audit.record(actor.tenantId(),actor.userId(),"DOCUMENT_TEXT_VIEWED","EXPEDIENTE",id.toString(),
                Map.of("documentId",documentId.toString(),"pageNumber",pageNumber));
        return new TextPage(documentId,pageNumber,fragments);
    }

    @Transactional(readOnly=true)
    public PageView<Activity> activity(OmegaPrincipal actor, UUID id, int page, int size) {
        authorization.requireReadAccess(actor,id);
        return PageView.of(logs.findCaseActivity(actor.tenantId(),id.toString(),page(page,size,Sort.unsorted())).map(value ->
                new Activity(value.getId(),value.getChainSeq(),value.getActorUserId(),value.getAction(),value.getResourceType(),
                        value.getResourceId(),audit.metadataForDisclosure(value.getMetadataJson()),value.getCurrentHash(),value.getCreatedAt())));
    }

    private DocumentEntity requireDocument(OmegaPrincipal actor, UUID id, UUID documentId) {
        authorization.requireReadAccess(actor,id);
        return documents.findByIdAndTenantId(documentId,actor.tenantId()).filter(value -> value.getExpedienteId().equals(id))
                .orElseThrow(() -> new ResourceNotFoundException("Documento no encontrado"));
    }
    private static PageRequest page(int page,int size,Sort sort) { return PageRequest.of(Math.max(0,page),Math.max(1,Math.min(100,size)),sort); }
}
