package com.omega.platform.service;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import com.omega.platform.domain.*;
import com.omega.platform.repository.ExpedienteRepository;
import com.omega.platform.security.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Stores only selected derived observations, never uploaded files, command lines or raw device snapshots. */
@Service
public class AnalysisEvidenceService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ExpedienteRepository cases;
    private final ExpedienteAuthorizationService authorization;
    private final AuditLogService audit;
    private static final Set<String> FIELDS=Set.of(
        "diagnosis","verdictcode","verdictlabel","verdict","risklevel","recommendation","recommendedactions","rationale","confidence",
        "islikelyfalsepositive","pipelinemode","totalfiles","totalindicatorsanalyzed","totalmatches","filesscanned","hitscount",
        "analyzedindicators","matches","ctimatches","findings","findingscount","hardeningchecks","manifestfindings","behavioralanomalies","crashanomalies",
        "persistencefindings","processfindings","yarahits","hits","yaraengine","engine","available","complete","limitations","warnings",
        "catalogfreshness","agehours","version","loaded","status","rule","ruleid","rulename","campaign","campaignid","spywarefamily",
        "ioctype","iocvalue","context","severity","userfriendlytitle","userfriendlyexplanation","recommendedaction","source","sourcereport",
        "sourceurl","sha256","hash","total","checked","checkid","check","description","result","passed","supported","count",
        "heuristics","domainagedays","freshtlscertificate","cloakingdetected","evasionriskscore","evasionreasons","osscopenotice");

    public AnalysisEvidenceService(JdbcTemplate jdbc,ObjectMapper mapper,ExpedienteRepository cases,ExpedienteAuthorizationService authorization,AuditLogService audit) {
        this.jdbc=jdbc;this.mapper=mapper;this.cases=cases;this.authorization=authorization;this.audit=audit;
    }
    @Transactional
    public UUID record(OmegaPrincipal actor,UUID caseId,String operation,Object result) {
        return record(actor,caseId,operation,result,null);
    }
    @Transactional
    public UUID record(OmegaPrincipal actor,UUID caseId,String operation,Object result,String sourceJob) {
        if(sourceJob!=null && !sourceJob.isBlank()) {
            String hash;
            try { hash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest((operation+":"+sourceJob).getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
            catch(Exception ex) { throw new IllegalStateException(ex); }
            if(jdbc.update("INSERT INTO omega_rag.recorded_analysis_jobs(tenant_id,actor_user_id,source_hash) VALUES (?,?,?) ON CONFLICT DO NOTHING",actor.tenantId(),actor.userId(),hash)==0) return null;
        }
        UUID target=caseId==null?personalCase(actor):caseId;
        authorization.requireWriteAccess(actor,target);
        var sanitized=sanitize(mapper.valueToTree(result));
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO omega_rag.analysis_evaluations(id,tenant_id,expediente_id,actor_user_id,operation,result_json) VALUES (?,?,?,?,?,?)",
            id,actor.tenantId(),target,actor.userId(),operation,sanitized.toString());
        audit.record(actor.tenantId(),actor.userId(),"ANALYSIS_EVIDENCE_SAVED","EXPEDIENTE",target.toString(),Map.of("evaluationId",id.toString(),"method",operation));
        return id;
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(OmegaPrincipal actor,UUID caseId) {
        authorization.requireReadAccess(actor,caseId);
        return jdbc.queryForList("SELECT id,expediente_id,operation,result_json,created_at FROM omega_rag.analysis_evaluations WHERE tenant_id=? AND expediente_id=? ORDER BY created_at DESC,id DESC LIMIT 100",actor.tenantId(),caseId)
            .stream().map(row -> { var value=new LinkedHashMap<>(row);value.put("result",read(row.get("result_json").toString()));value.remove("result_json");return (Map<String,Object>)value; }).toList();
    }
    @Transactional
    public void delete(OmegaPrincipal actor,UUID caseId,UUID id) {
        authorization.requireWriteAccess(actor,caseId);
        if(jdbc.update("DELETE FROM omega_rag.analysis_evaluations WHERE tenant_id=? AND expediente_id=? AND id=?",actor.tenantId(),caseId,id)==0)
            throw new ResourceNotFoundException("Evaluación no encontrada");
        audit.record(actor.tenantId(),actor.userId(),"ANALYSIS_EVIDENCE_DELETED","EXPEDIENTE",caseId.toString(),Map.of("evaluationId",id.toString()));
    }
    public boolean canWrite(OmegaPrincipal actor,UUID caseId) {
        try { authorization.requireWriteAccess(actor,caseId);return true; }
        catch(org.springframework.security.access.AccessDeniedException ex) { return false; }
    }
    private UUID personalCase(OmegaPrincipal actor) {
        var ids=jdbc.queryForList("SELECT expediente_id FROM omega_rag.personal_analysis_workspaces WHERE tenant_id=? AND user_id=?",UUID.class,actor.tenantId(),actor.userId());
        if(!ids.isEmpty()) return ids.getFirst();
        var candidate=cases.saveAndFlush(new ExpedienteEntity(actor.tenantId(),actor.userId(),"Análisis personales",ClassificationLevel.CONFIDENTIAL));
        int created=jdbc.update("INSERT INTO omega_rag.personal_analysis_workspaces(tenant_id,user_id,expediente_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",actor.tenantId(),actor.userId(),candidate.getId());
        if(created==0) { cases.delete(candidate);cases.flush(); }
        return jdbc.queryForObject("SELECT expediente_id FROM omega_rag.personal_analysis_workspaces WHERE tenant_id=? AND user_id=?",UUID.class,actor.tenantId(),actor.userId());
    }
    public static ObjectNode sanitize(JsonNode result) {
        var flags=new boolean[1];
        var safe=JsonNodeFactory.instance.objectNode();
        safe.put("schemaVersion","omega-evaluation-v1");
        safe.put("method","Observaciones seleccionadas del analizador; no incluye archivos originales, procesos completos ni comandos.");
        safe.set("observations",select(result,0,flags));
        if(safe.toString().length()>256000) {
            var summary=JsonNodeFactory.instance.objectNode();
            safe.path("observations").fields().forEachRemaining(entry -> { if(entry.getValue().isValueNode()) summary.set(entry.getKey(),entry.getValue()); });
            safe.set("observations",summary); flags[0]=true;
        }
        safe.put("truncated",flags[0]);
        return safe;
    }
    private static JsonNode select(JsonNode node,int depth,boolean[] truncated) {
        if(depth>8) { truncated[0]=true;return TextNode.valueOf("Detalle omitido por límite de profundidad"); }
        if(node==null || node.isNull()) return NullNode.instance;
        if(node.isObject()) {
            var out=JsonNodeFactory.instance.objectNode();
            node.fields().forEachRemaining(entry -> {
                String key=entry.getKey().replaceAll("[^a-zA-Z]","").toLowerCase(Locale.ROOT);
                if(FIELDS.contains(key)) out.set(entry.getKey(),select(entry.getValue(),depth+1,truncated));
            });
            return out;
        }
        if(node.isArray()) {
            var out=JsonNodeFactory.instance.arrayNode();int count=0;
            for(var child:node) { if(count++>=250) { truncated[0]=true;break; } out.add(select(child,depth+1,truncated)); }
            return out;
        }
        if(node.isTextual()) {
            String raw=node.asText();
            if(raw.length()>1200) truncated[0]=true;
            return TextNode.valueOf(DevProjectService.sanitizeText(raw,1200).replaceAll("https?://[^\\s]+", "[enlace omitido; consulte la fuente original]"));
        }
        return node.deepCopy();
    }
    private JsonNode read(String json) {
        try { return mapper.readTree(json); } catch(Exception ex) { throw new IllegalStateException("No se pudo leer la evaluación guardada",ex); }
    }
}
