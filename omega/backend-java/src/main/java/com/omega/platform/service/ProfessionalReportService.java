package com.omega.platform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.billing.CreditService;
import com.omega.platform.cti.ForensicDossierExportService;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.security.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ProfessionalReportService {
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private AnalysisEvidenceService evaluations;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private LegalObservationReviewService observationReviews;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final DevReportService development;
    private final ForensicDossierExportService dossier;
    private final LegalTimelineService timeline;
    private final DocumentRepository documents;
    private final com.omega.platform.repository.DocumentChunkRepository chunks;
    private final DevProjectRepository projects;
    private final ExpedienteAuthorizationService authorization;
    private final CreditService credits;
    private final AuditLogService audit;

    public ProfessionalReportService(JdbcTemplate jdbc, ObjectMapper mapper, DevReportService development,
            ForensicDossierExportService dossier, LegalTimelineService timeline, DocumentRepository documents,
            DevProjectRepository projects, ExpedienteAuthorizationService authorization, CreditService credits, AuditLogService audit,
            com.omega.platform.repository.DocumentChunkRepository chunks) {
        this.jdbc=jdbc; this.mapper=mapper; this.development=development; this.dossier=dossier; this.timeline=timeline;
        this.documents=documents; this.projects=projects; this.authorization=authorization; this.credits=credits; this.audit=audit; this.chunks=chunks;
    }

    @Transactional
    public Map<String,Object> create(OmegaPrincipal actor, String profile, UUID caseId, UUID projectId) {
        if (!Set.of("GENERAL","DEVELOPER","LEGAL").contains(profile == null ? "" : profile))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Selecciona un perfil válido.");
        credits.requireWorkspaceAccess(actor.tenantId());
        if (!"GENERAL".equals(profile)) credits.requirePaid(actor.tenantId());
        if (("DEVELOPER".equals(profile) && caseId != null) || (!"DEVELOPER".equals(profile) && (caseId == null || projectId != null)))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Selecciona el alcance del informe.");
        UUID id=UUID.randomUUID();
        Instant now=Instant.now();
        String title;
        Object analysis;
        List<ReportPdf.Section> sections = new ArrayList<>();
        byte[] pdf;
        if ("DEVELOPER".equals(profile)) {
            var data=development.exportJsonReport(actor,projectId);
            if(data.projects().stream().noneMatch(p -> p.scansCount()>0))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Evalúa al menos un proyecto antes de generar el informe.");
            title="Informe de desarrollo";
            analysis=data;
            pdf=DevReportService.renderPdf(data,id.toString());
        } else {
            var caseData=authorization.requireReadAccess(actor,caseId);
            var evidence=documents.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(actor.tenantId(),caseId);
            var technical=dossier.exportAsJson(caseId);
            var savedEvaluations="GENERAL".equals(profile) && evaluations!=null ? evaluations.list(actor,caseId) : List.<Map<String,Object>>of();
            if(evidence.isEmpty() && technical.findings().isEmpty() && savedEvaluations.isEmpty())
                throw new ResponseStatusException(HttpStatus.CONFLICT,"El expediente todavía no tiene evidencia o resultados registrados para un informe.");
            title="LEGAL".equals(profile) ? "Informe documental del expediente" : "Informe de exposición y protección";
            var events="LEGAL".equals(profile) ? timeline.list(actor,caseId,null,null,false) : List.<LegalTimelineService.TimelineEventView>of();
            var observationChunks=new ArrayList<com.omega.platform.domain.DocumentChunkEntity>();
            if("LEGAL".equals(profile)) for(var document:evidence)
                if(document.getStatus().name().equals("INDEXED")) observationChunks.addAll(chunks.findAllByTenantIdAndDocumentIdOrderByChunkOrderAsc(actor.tenantId(),document.getId()));
            var observations=LegalReportObservations.extract(observationChunks);
            var passageReviews="LEGAL".equals(profile) && observationReviews!=null ? observationReviews.list(actor,caseId) : Map.<String,Object>of("items",List.of(),"total",0);
            long reviewed=events.stream().filter(e -> Set.of("CONFIRMED","CORRECTED").contains(e.reviewStatus())).count();
            long indexed=evidence.stream().filter(d -> d.getStatus().name().equals("INDEXED")).count();
            sections.add(new ReportPdf.Section("1. Resumen ejecutivo",List.of(
                    "Expediente: " + caseData.getTitle() + " · Referencia: " + (caseData.getCaseReference()==null || caseData.getCaseReference().isBlank()?"No consta":caseData.getCaseReference()),
                    "Documentos registrados: " + evidence.size() + "; indexados: " + indexed + "; pendientes o no disponibles: " + (evidence.size()-indexed) + ".",
                    "LEGAL".equals(profile) ? "Cronología: " + events.size() + " eventos con cita; " + reviewed + " marcados como revisados por un usuario. No consta revisión profesional del informe completo."
                        : savedEvaluations.isEmpty() ? technical.executiveSummary()
                        : "Se consolidan " + savedEvaluations.size() + " evaluaciones guardadas. Revise sus observaciones, recomendaciones y límites por separado; los resultados no certifican ausencia de amenazas.")));
            sections.add(new ReportPdf.Section("2. Alcance y fuentes", evidence.stream().map(d ->
                    "Documento " + d.getId() + " · Estado: " + d.getStatus() + " · Páginas: " + d.getTotalPages()
                    + " · OCR: " + d.isOcrApplied() + "\nSHA-256 registrado al ingreso: " + d.getSha256Hash()
                    + "\nIncorporado: " + d.getCreatedAt() + " · Incidencia: " + (d.getFailureCode()==null?"Sin incidencia registrada":d.getFailureCode())).toList()));
            if("LEGAL".equals(profile)) {
                sections.add(new ReportPdf.Section("3. Cronología documental con referencias",events.isEmpty()
                    ? List.of("No hay cronología persistida. Ejecute la extracción y revise los eventos antes de utilizar conclusiones temporales.")
                    : events.stream().map(e -> e.eventDate() + " · " + e.summary() + "\nFuente: documento " + e.documentId()
                        + ", página " + e.pageNumber() + ", fragmento " + e.chunkId() + "\nRevisión: " + e.reviewStatus()
                        + " · Confianza de extracción: " + e.confidence() + " · " + e.confidenceReason()).toList()));
                var passages=new ArrayList<String>();
                passages.add("Fragmentos examinados: " + observations.chunksReviewed() + "; candidatos: " + observations.candidatesFound()
                    + "; incluidos: " + observations.observations().size() + ". "
                    + (observations.truncated()?"Cobertura parcial: se alcanzó el límite de 200 pasajes.":"La búsqueda es literal y depende del texto indexado; no acredita cobertura jurídica completa."));
                for(var passage:observations.observations()) passages.add(
                    ("POSIBLE_OBLIGACION".equals(passage.category())?"Posible obligación":"Mención monetaria") + "\nCita: " + passage.excerpt()
                    + "\nFuente: documento " + passage.documentId() + ", página " + passage.pageNumber() + ", fragmento " + passage.chunkId()
                    + "\nDetección automática; consulte el registro de revisión antes de atribuirle una conclusión.");
                if(observations.observations().isEmpty()) passages.add("No se detectaron pasajes con las reglas literales actuales. Esto no demuestra ausencia de obligaciones o valores.");
                sections.add(new ReportPdf.Section("4. Pasajes documentales y cobertura",passages));
                var reviews=new ArrayList<String>();
                var registered=mapper.valueToTree(passageReviews);
                reviews.add("Registros de revisión incluidos: " + registered.path("items").size() + " de " + registered.path("total").asLong()
                    + ". La revisión confirma el criterio registrado por un usuario; no determina exigibilidad ni acredita revisión profesional del informe completo.");
                if(registered.path("total").asLong()>registered.path("items").size()) reviews.add("Cobertura parcial: se muestran hasta 500 registros. Consulte el expediente para revisar el conjunto completo.");
                for(var review:registered.path("items")) reviews.add(
                    "Pasaje " + review.path("id").asText() + " · " + review.path("category").asText()
                    + "\nCita conservada: " + review.path("excerpt").asText()
                    + "\nFuente: documento " + review.path("document_id").asText() + ", página " + review.path("page_number").asInt() + ", fragmento " + review.path("chunk_id").asText()
                    + "\nEstado: " + review.path("review_status").asText() + " · Revisión: " + review.path("revision").asInt()
                    + "\nCriterio: " + (review.path("review_note").asText("").isBlank()?"Sin criterio registrado":review.path("review_note").asText())
                    + "\nRevisado por: " + review.path("reviewed_by").asText("No consta") + " · Fecha: " + review.path("reviewed_at").asText("No consta"));
                sections.add(new ReportPdf.Section("5. Registro de revisión de pasajes",reviews));
                sections.add(new ReportPdf.Section("6. Revisión pendiente y próximos pasos",List.of(
                    "Contrastar cada evento extraído con el documento original y marcarlo como confirmado o corregido.",
                    "Revisar los documentos no indexados antes de evaluar la cobertura del expediente.",
                    "No se han evaluado automáticamente obligaciones, vencimientos procesales ni contradicciones en este informe. Deben revisarse con sus pasajes de soporte; no se deducen de la mera presencia de una fecha.",
                    "Las fechas encontradas en documentos no constituyen por sí mismas plazos judiciales calculados.")));
            } else {
                if(!savedEvaluations.isEmpty()) {
                    var details=new ArrayList<String>();
                    details.add("Se incluyen las " + savedEvaluations.size() + " evaluaciones guardadas más recientes de este espacio (máximo 100). Las observaciones son datos derivados saneados; no contienen archivos originales.");
                    for(var evaluation:savedEvaluations) {
                        var data=mapper.valueToTree(evaluation.get("result"));
                        details.add("Referencia: " + evaluation.get("id") + " · " + evaluation.get("created_at") + " · " + evaluation.get("operation")
                            + "\n" + evaluationSummary(data.path("observations"))
                            + (data.path("truncated").asBoolean()?"\nCobertura parcial: se alcanzó un límite de conservación del detalle.":"")
                            + "\nObservaciones conservadas:\n" + data.path("observations").toPrettyString());
                    }
                    sections.add(new ReportPdf.Section("Resultados de las evaluaciones guardadas",details));
                }
                sections.add(new ReportPdf.Section("3. Observaciones y evidencia registrada",technical.findings().isEmpty()
                    ? List.of("No hay hallazgos técnicos persistidos. La ausencia de registros no demuestra ausencia de compromiso.")
                    : technical.findings().stream().map(f -> f.action() + " · " + f.createdAtUtc() + "\n" + f.explanation()
                        + "\nReferencia de auditoría: " + f.auditEntryId() + "\nDatos registrados: " + f.technicalEvidence()).toList()));
                sections.add(new ReportPdf.Section("4. Plan de acción y verificación",List.of(
                    "Priorizar la revisión especializada de las señales de riesgo alto o crítico. Conservar la evidencia original antes de modificar un dispositivo.",
                    "Revisar los eventos de contención y su resultado antes de darlos por resueltos.",
                    "Después de actuar, realizar una nueva evaluación y comparar sus resultados. Una acción registrada no demuestra por sí sola que el riesgo haya desaparecido.")));
            }
            sections.add(new ReportPdf.Section("Integridad y limitaciones",List.of(
                    "Cadena de auditoría: " + technical.chainOfCustody().status() + ". " + technical.chainOfCustody().detail(),
                    "Los hashes de documentos fueron registrados al ingreso; no se ha vuelto a medir el archivo original al exportar.",
                    "Informe automatizado; no constituye dictamen pericial, firma electrónica, asesoría jurídica ni garantía de ausencia de amenazas.",
                    "Las fuentes son los documentos y resultados persistidos de este expediente. Los resultados efímeros no registrados no pueden reconstruirse.")));
            analysis=new LinkedHashMap<>(Map.of("case",technical.caseMetadata(),"documents",technical.evidence(),"timeline",events,
                    "documentaryObservations",observations,"technicalFindings",technical.findings(),"chainStatus",technical.chainOfCustody().status(),"sections",sections));
            pdf=ReportPdf.render("OMEGA · " + title,id + " · omega-report-v1 · " + now,sections);
            @SuppressWarnings("unchecked") var analysisFields=(Map<String,Object>)analysis;
            if("GENERAL".equals(profile)) analysisFields.put("savedEvaluations",savedEvaluations);
            if("LEGAL".equals(profile)) analysisFields.put("reviewedDocumentaryObservations",passageReviews);
        }
        try {
            var source=mapper.valueToTree(analysis);
            if(source instanceof com.fasterxml.jackson.databind.node.ObjectNode object) object.remove("generatedAt");
            String sourceHash=sha(canonical(source).getBytes(StandardCharsets.UTF_8));
            String json=mapper.writeValueAsString(Map.of("reportId",id,"schemaVersion","omega-report-v1","profile",profile,
                    "generatedAt",now,"reviewStatus","AUTOMATED","analysis",analysis));
            int inserted=jdbc.update("""
                INSERT INTO omega_rag.report_snapshots(id,tenant_id,actor_user_id,profile,expediente_id,project_id,title,schema_version,payload_json,pdf_bytes,json_sha256,pdf_sha256,source_sha256)
                VALUES (?,?,?,?,?,?,?,'omega-report-v1',?,?,?,?,?) ON CONFLICT(tenant_id,actor_user_id,profile,source_sha256) DO NOTHING
                """,id,actor.tenantId(),actor.userId(),profile,caseId,projectId,title,json,pdf,sha(json.getBytes(StandardCharsets.UTF_8)),sha(pdf),sourceHash);
            if(inserted==0) return jdbc.queryForMap("SELECT id,title,profile,created_at,0 AS \"creditsCharged\" FROM omega_rag.report_snapshots WHERE tenant_id=? AND actor_user_id=? AND profile=? AND source_sha256=?",actor.tenantId(),actor.userId(),profile,sourceHash);
            jdbc.update("""
                INSERT INTO omega_rag.transactional_mail(tenant_id,actor_user_id,event_key,subject,body) VALUES (?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING
                """,actor.tenantId(),actor.userId(),"report:"+id,"OMEGA · Tu informe está disponible",
                    "Tu informe ya está disponible en Cuenta → Informes.\n\nInforme: " + id + "\nFecha: " + now
                    + "\n\nInicia sesión para consultarlo. Este correo no incluye documentos ni contenido del expediente.");
            audit.record(actor.tenantId(),actor.userId(),"PROFESSIONAL_REPORT_CREATED","REPORT",id.toString(),Map.of("profile",profile,"schemaVersion","omega-report-v1"));
            return Map.of("id",id,"title",title,"profile",profile,"created_at",now,"creditsCharged",0);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) { throw new IllegalStateException("No se pudo guardar el informe",ex); }
    }

    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(OmegaPrincipal actor) {
        // Case permissions are rechecked on every listing and download, including revoked delegations.
        return jdbc.queryForList("SELECT id,title,profile,expediente_id,project_id,actor_user_id,created_at,json_sha256,pdf_sha256 FROM omega_rag.report_snapshots WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",actor.tenantId())
            .stream().filter(r -> canRead(actor,r)).toList();
    }

    @Transactional(readOnly=true)
    public byte[] download(OmegaPrincipal actor,UUID id,String format) {
        if(!Set.of("pdf","json").contains(format)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Formato inválido.");
        var rows=jdbc.queryForList("SELECT * FROM omega_rag.report_snapshots WHERE tenant_id=? AND id=?",actor.tenantId(),id);
        if(rows.isEmpty() || !canRead(actor,rows.getFirst())) throw new ResourceNotFoundException("Informe no disponible");
        var row=rows.getFirst();
        return "pdf".equals(format) ? (byte[])row.get("pdf_bytes") : row.get("payload_json").toString().getBytes(StandardCharsets.UTF_8);
    }
    private boolean canRead(OmegaPrincipal actor,Map<String,Object> row) {
        try {
            if(row.get("expediente_id")!=null) authorization.requireReadAccess(actor,(UUID)row.get("expediente_id"));
            else if(!actor.userId().equals(row.get("actor_user_id")) && actor.role()!=Role.ADMIN) return false;
            if(row.get("project_id")!=null && projects.findByIdAndTenantId((UUID)row.get("project_id"),actor.tenantId()).isEmpty()) return false;
            return true;
        } catch(org.springframework.security.access.AccessDeniedException | ResourceNotFoundException ex) { return false; }
    }
    @Transactional
    public void delete(OmegaPrincipal actor,UUID id) {
        var rows=jdbc.queryForList("SELECT * FROM omega_rag.report_snapshots WHERE tenant_id=? AND id=?",actor.tenantId(),id);
        if(rows.isEmpty() || !canRead(actor,rows.getFirst())) throw new ResourceNotFoundException("Informe no disponible");
        var row=rows.getFirst();
        if(!actor.userId().equals(row.get("actor_user_id")) && actor.role()!=Role.ADMIN)
            throw new org.springframework.security.access.AccessDeniedException("Solo quien generó el informe o un administrador puede eliminarlo.");
        jdbc.update("DELETE FROM omega_rag.report_snapshots WHERE tenant_id=? AND id=?",actor.tenantId(),id);
        audit.record(actor.tenantId(),actor.userId(),"PROFESSIONAL_REPORT_DELETED","REPORT",id.toString(),Map.of());
    }
    private String canonical(com.fasterxml.jackson.databind.JsonNode value) throws com.fasterxml.jackson.core.JsonProcessingException {
        if(value.isObject()) {
            var fields=new TreeMap<String,String>();
            for(var iterator=value.fields();iterator.hasNext();) { var entry=iterator.next(); fields.put(entry.getKey(),canonical(entry.getValue())); }
            var parts=new ArrayList<String>();
            for(var entry:fields.entrySet()) parts.add(mapper.writeValueAsString(entry.getKey())+":"+entry.getValue());
            return "{"+String.join(",",parts)+"}";
        }
        if(value.isArray()) { var parts=new ArrayList<String>(); for(var item:value) parts.add(canonical(item)); return "["+String.join(",",parts)+"]"; }
        return value.toString();
    }
    private static String sha(byte[] data) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
        catch(java.security.NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    private static String evaluationSummary(com.fasterxml.jackson.databind.JsonNode result) {
        var diagnosis=result.path("diagnosis");
        String verdict=diagnosis.path("verdict_label").asText(result.path("verdict").asText("No consta un veredicto"));
        String confidence=diagnosis.path("confidence").asText("No consta");
        var actions=diagnosis.path("recommended_actions");
        return "Resultado registrado: " + verdict + "\nConfianza informada: " + confidence
            + "\nInterpretación del analizador: " + diagnosis.path("rationale").asText("Consulte las observaciones conservadas")
            + "\nAcciones recomendadas: " + (actions.isArray()?actions:result.path("recommendation").asText("Revisar el alcance y la evidencia antes de actuar."))
            + "\nUn resultado sin coincidencias no demuestra ausencia de compromiso. Comparar registros no prueba que se haya corregido un riesgo.";
    }
}
