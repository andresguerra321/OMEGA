package com.omega.platform.service;

import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.repository.*;
import com.omega.platform.security.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class LegalObservationReviewService {
    private final JdbcTemplate jdbc;
    private final DocumentRepository documents;
    private final DocumentChunkRepository chunks;
    private final ExpedienteAuthorizationService authorization;
    private final LegalDocumentAiService ai;
    private final AuditLogService audit;
    public LegalObservationReviewService(JdbcTemplate jdbc,DocumentRepository documents,DocumentChunkRepository chunks,
            ExpedienteAuthorizationService authorization,LegalDocumentAiService ai,AuditLogService audit) {
        this.jdbc=jdbc;this.documents=documents;this.chunks=chunks;this.authorization=authorization;this.ai=ai;this.audit=audit;
    }
    @Transactional(readOnly=true)
    public Map<String,Object> list(OmegaPrincipal actor,UUID caseId) {
        authorization.requireReadAccess(actor,caseId);
        return Map.of("items",jdbc.queryForList("SELECT * FROM omega_rag.legal_document_observations WHERE tenant_id=? AND expediente_id=? ORDER BY created_at,page_number,id LIMIT 500",actor.tenantId(),caseId),
            "total",jdbc.queryForObject("SELECT count(*) FROM omega_rag.legal_document_observations WHERE tenant_id=? AND expediente_id=?",Long.class,actor.tenantId(),caseId));
    }
    @Transactional
    public Map<String,Object> extract(OmegaPrincipal actor,UUID caseId) {
        authorization.requireWriteAccess(actor,caseId);ai.requireConsent(actor);
        var source=new ArrayList<com.omega.platform.domain.DocumentChunkEntity>();
        for(var document:documents.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(actor.tenantId(),caseId))
            if(document.getStatus()==DocumentStatus.INDEXED) source.addAll(chunks.findAllByTenantIdAndDocumentIdOrderByChunkOrderAsc(actor.tenantId(),document.getId()));
        var detected=LegalReportObservations.extract(source);
        int created=0;
        for(var item:detected.observations()) {
            String hash=hash(item.excerpt());
            created+=jdbc.update("""
                INSERT INTO omega_rag.legal_document_observations(id,tenant_id,expediente_id,document_id,chunk_id,page_number,category,passage_hash,excerpt)
                VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,expediente_id,chunk_id,category,passage_hash) DO NOTHING
                """,UUID.randomUUID(),actor.tenantId(),caseId,item.documentId(),item.chunkId(),item.pageNumber(),item.category(),hash,item.excerpt());
        }
        audit.record(actor.tenantId(),actor.userId(),"LEGAL_OBSERVATIONS_EXTRACTED","EXPEDIENTE",caseId.toString(),Map.of("createdCount",created,"candidateCount",detected.candidatesFound()));
        return Map.of("created",created,"chunksReviewed",detected.chunksReviewed(),"candidatesFound",detected.candidatesFound(),"included",detected.observations().size(),"truncated",detected.truncated());
    }
    @Transactional
    public void review(OmegaPrincipal actor,UUID caseId,UUID id,String status,String note,int expectedRevision) {
        authorization.requireWriteAccess(actor,caseId);
        if(!Set.of("PENDING_REVIEW","CONFIRMED","REJECTED").contains(status==null?"":status))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Estado de revisión inválido.");
        String clean=DevProjectService.sanitizeText(note,1000);
        if(!"PENDING_REVIEW".equals(status) && clean.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Explica el criterio de revisión antes de confirmar o descartar el pasaje.");
        int changed=jdbc.update("""
            UPDATE omega_rag.legal_document_observations SET review_status=?,review_note=?,reviewed_by=?,reviewed_at=now(),revision=revision+1
            WHERE tenant_id=? AND expediente_id=? AND id=? AND revision=?
            """,status,clean,actor.userId(),actor.tenantId(),caseId,id,expectedRevision);
        if(changed==0) {
            Long exists=jdbc.queryForObject("SELECT count(*) FROM omega_rag.legal_document_observations WHERE tenant_id=? AND expediente_id=? AND id=?",Long.class,actor.tenantId(),caseId,id);
            if(exists==null || exists==0) throw new ResourceNotFoundException("Observación no encontrada.");
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Esta observación cambió. Actualiza la lista antes de revisarla.");
        }
        audit.record(actor.tenantId(),actor.userId(),"LEGAL_OBSERVATION_REVIEWED","EXPEDIENTE",caseId.toString(),Map.of("observationId",id.toString(),"status",status));
    }
    private static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch(Exception ex) { throw new IllegalStateException(ex); }
    }
}
