package com.omega.platform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.*;
import com.omega.platform.ingest.*;
import com.omega.platform.rag.*;
import com.omega.platform.repository.*;
import com.omega.platform.security.*;
import com.omega.platform.web.dto.ExpedienteDtos.DocumentMetadataResponse;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LegalDocumentAiService {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.AccountAccessService accountAccess;
    private boolean manages(OmegaPrincipal actor) {
        return accountAccess != null ? accountAccess.canManage(actor.tenantId(), actor.userId(), actor.role()) : actor.role()==Role.ADMIN;
    }

    private final OmegaProperties properties;
    private final EmbeddingProvider embeddings;
    private final RagAnswerGenerator answers;
    private final TenantRepository tenants;
    private final DocumentRepository documents;
    private final DocumentChunkRepository chunks;
    private final ExpedienteAuthorizationService authorization;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final AuditLogService audit;
    public LegalDocumentAiService(OmegaProperties properties,EmbeddingProvider embeddings,RagAnswerGenerator answers,
            TenantRepository tenants,DocumentRepository documents,DocumentChunkRepository chunks,
            ExpedienteAuthorizationService authorization,JdbcTemplate jdbc,ObjectMapper mapper,AuditLogService audit) {
        this.properties=properties; this.embeddings=embeddings; this.answers=answers; this.tenants=tenants;
        this.documents=documents; this.chunks=chunks; this.authorization=authorization; this.jdbc=jdbc; this.mapper=mapper; this.audit=audit;
    }
    public record Target(String provider,String model,String destination) {}
    public record Disclosure(Target indexing,List<Target> responses) {}
    public record Policy(String fingerprint,Disclosure disclosure,boolean accepted,boolean canAccept) {}

    @Transactional(readOnly=true)
    public Policy policy(OmegaPrincipal actor) {
        requireLegal(actor);
        Disclosure disclosure=disclosure();
        String endpoints=String.join("\n",String.valueOf(properties.rag().openAiBaseUrl()),String.valueOf(properties.rag().groqBaseUrl()),
                String.valueOf(properties.rag().customChatBaseUrl()),String.valueOf(properties.rag().omniRouteBaseUrl()));
        if(properties.ai().ollama()!=null) endpoints += "\n"+properties.ai().ollama().baseUrl();
        String fingerprint=hash(json(disclosure)+"\n"+embeddings.dimensions()+"\n"+hash(endpoints));
        var accepted=jdbc.queryForList("SELECT policy_hash FROM omega_rag.legal_document_ai_consents WHERE tenant_id = ?",String.class,actor.tenantId());
        return new Policy(fingerprint,disclosure,!accepted.isEmpty() && accepted.getFirst().equals(fingerprint),manages(actor));
    }

    @Transactional
    public void accept(OmegaPrincipal actor,String fingerprint) {
        Policy current=policy(actor);
        if(!manages(actor)) throw new org.springframework.security.access.AccessDeniedException("Solo un administrador puede aceptar esta política");
        tenants.findByIdAndActiveTrue(actor.tenantId())
                .filter(com.omega.platform.security.WorkspaceMfaPolicyService::isOrganizationalLegalWorkspace)
                .ifPresent(ignored -> {
                    if (!com.omega.platform.security.WorkspaceMfaPolicyService.isRecentMfa(actor.mfaAt(), java.time.Instant.now())) {
                        throw new org.springframework.web.server.ResponseStatusException(
                                org.springframework.http.HttpStatus.FORBIDDEN,
                                "MFA_STEP_UP_REQUIRED: Aceptar la política de IA documental en un espacio LEGAL organizacional requiere verificación 2FA reciente (máximo 15 minutos)."
                        );
                    }
                });
        if(!current.fingerprint().equals(fingerprint)) throw new ConflictException("La configuración cambió. Revisa la política actual antes de aceptar.");
        if(current.accepted()) return;
        jdbc.update("""
                INSERT INTO omega_rag.legal_document_ai_consents(tenant_id,policy_hash,disclosure_json,accepted_by)
                VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET policy_hash=EXCLUDED.policy_hash,
                disclosure_json=EXCLUDED.disclosure_json,accepted_by=EXCLUDED.accepted_by,accepted_at=NOW()
                """,actor.tenantId(),fingerprint,json(current.disclosure()),actor.userId());
        audit.record(actor.tenantId(),actor.userId(),"DOCUMENT_AI_POLICY_ACCEPTED","TENANT",actor.tenantId().toString(),
                Map.of("policyHash",fingerprint));
    }

    public void requireConsent(OmegaPrincipal actor) {
        if(isLegal(actor) && !policy(actor).accepted())
            throw new ConflictException("Un administrador debe revisar y aceptar la política de IA documental en Expedientes antes de cargar o consultar documentos.");
    }

    public void requireIndexedImageForLegal(OmegaPrincipal actor) {
        if(isLegal(actor)) throw new ConflictException("Carga la imagen como documento del expediente antes de consultarla con citas.");
    }

    private void requireLegal(OmegaPrincipal actor) {
        if(!TenantContext.requireTenantId().equals(actor.tenantId())) throw new org.springframework.security.access.AccessDeniedException("Contexto de tenant inválido");
        if(!isLegal(actor)) throw new ResourceNotFoundException("Configuración no disponible");
    }
    private boolean isLegal(OmegaPrincipal actor) {
        return tenants.findByIdAndActiveTrue(actor.tenantId()).map(tenant -> tenant.getProfile()==TenantProfile.LEGAL).orElse(false);
    }
    private Disclosure disclosure() {
        var rag=properties.rag(); List<Target> responses=new ArrayList<>(); Target indexing;
        if("ollama".equals(properties.ai().provider())) {
            indexing=new Target("OLLAMA",embeddings.modelName(),ollamaDestination(properties.ai().ollama().baseUrl()));
            responses.add(new Target("OLLAMA",answers.resolveActiveGeneratorModel(),ollamaDestination(properties.ai().ollama().baseUrl())));
        } else {
            indexing=rag.openAiApiKey()==null || rag.openAiApiKey().isBlank()
                    ? new Target("LOCAL_TEXT",AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL,"LOCAL")
                    : new Target("OPENAI",embeddings.modelName(),destination(rag.openAiBaseUrl()));
            if(rag.customChatBaseUrl()!=null && !rag.customChatBaseUrl().isBlank())
                responses.add(new Target("CUSTOM",defaultModel(rag.customChatModel(),"llama3.2"),destination(rag.customChatBaseUrl())));
            if(rag.omniRouteBaseUrl()!=null && !rag.omniRouteBaseUrl().isBlank())
                responses.add(new Target("OMNIROUTE",defaultModel(rag.omniRouteModel(),"auto"),destination(rag.omniRouteBaseUrl())));
            if(rag.openAiApiKey()!=null && !rag.openAiApiKey().isBlank()) responses.add(new Target("OPENAI",rag.chatModel(),destination(rag.openAiBaseUrl())));
            if(rag.groqApiKey()!=null && !rag.groqApiKey().isBlank()) responses.add(new Target("GROQ",defaultModel(rag.groqModel(),"openai/gpt-oss-120b"),destination(rag.groqBaseUrl())));
        }
        if(responses.isEmpty()) responses.add(new Target("EXTRACTIVE","omega-extractive-fallback","LOCAL"));
        return new Disclosure(indexing,List.copyOf(responses));
    }
    private static String destination(String url) {
        try {
            URI uri=URI.create(url); String host=uri.getHost();
            if(host==null) return "UNCONFIGURED";
            return uri.getScheme()+"://"+host+(uri.getPort()<0 ? "" : ":"+uri.getPort());
        } catch(Exception ex) { return "UNCONFIGURED"; }
    }
    private static String defaultModel(String model,String fallback) { return model==null || model.isBlank() ? fallback : model; }
    private static String ollamaDestination(String url) {
        try {
            if(Set.of("localhost","127.0.0.1","::1","[::1]","host.docker.internal","ollama").contains(URI.create(url).getHost())) return "LOCAL";
        } catch(Exception ex) { return "UNCONFIGURED"; }
        return destination(url);
    }
    private String json(Object value) {
        try { return mapper.writeValueAsString(value); } catch(Exception ex) { throw new IllegalStateException("AI_POLICY_SERIALIZATION_FAILED"); }
    }
    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch(Exception ex) { throw new IllegalStateException("AI_POLICY_HASH_FAILED"); }
    }

    @Transactional
    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.LEGAL_INDEX)
    public DocumentMetadataResponse reindex(OmegaPrincipal actor,UUID caseId,UUID documentId) {
        authorization.requireWriteAccess(actor,caseId); requireConsent(actor);
        var document=documents.findScopedForUpdate(documentId,actor.tenantId()).filter(value -> value.getExpedienteId().equals(caseId))
                .orElseThrow(() -> new ResourceNotFoundException("Documento no encontrado"));
        var saved=chunks.findAllByTenantIdAndDocumentIdOrderByChunkOrderAsc(actor.tenantId(),documentId);
        if(saved.isEmpty()) throw new ConflictException("Este documento no conserva fragmentos de texto para reindexar.");
        if(embeddings.dimensions()!=1536) throw new ConflictException("El modelo requiere una dimensión incompatible con el índice actual.");
        List<float[]> vectors; String model=embeddings.modelName();
        try { vectors=embeddings.embedBatch(saved.stream().map(DocumentChunkEntity::getContent).toList()); }
        catch(EmbeddingException ex) {
            model=AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL;
            vectors=saved.stream().map(value -> new float[embeddings.dimensions()]).toList();
        } catch(Exception ex) { throw new ConflictException("El indexador no responde. Revisa el modelo de indexación e intenta de nuevo."); }
        if(vectors.size()!=saved.size()) throw new ConflictException("El indexador devolvió un resultado incompleto.");
        for(int i=0;i<saved.size();i++) {
            float[] vector=vectors.get(i);
            if(vector==null || vector.length!=embeddings.dimensions()) throw new ConflictException("El índice y el modelo no tienen dimensiones compatibles.");
            for(float element:vector) if(!Float.isFinite(element)) throw new ConflictException("El indexador devolvió un vector inválido.");
            saved.get(i).setEmbedding(vector); saved.get(i).setEmbeddingModel(model);
        }
        chunks.saveAllAndFlush(saved); document.setEmbeddingModel(model); document.setStatus(DocumentStatus.INDEXED); document.setFailureCode(null);
        documents.saveAndFlush(document);
        audit.record(actor.tenantId(),actor.userId(),"DOCUMENT_REINDEXED","EXPEDIENTE",caseId.toString(),
                Map.of("documentId",documentId.toString(),"sha256Hash",document.getSha256Hash(),"modelHash",hash(model),"chunkCount",saved.size()));
        return DocumentIngestionService.toMetadataResponse(document);
    }
}
