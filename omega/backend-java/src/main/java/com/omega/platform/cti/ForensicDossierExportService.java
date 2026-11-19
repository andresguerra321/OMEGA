package com.omega.platform.cti;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.AuditLogEntity;
import com.omega.platform.repository.AuditLogRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.TenantContext;
import com.omega.platform.service.AuditLogService;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.openpdf.text.Document;
import org.openpdf.text.Font;
import org.openpdf.text.FontFactory;
import org.openpdf.text.Paragraph;
import org.openpdf.text.Phrase;
import org.openpdf.text.pdf.PdfPCell;
import org.openpdf.text.pdf.PdfPTable;
import org.openpdf.text.pdf.PdfWriter;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ForensicDossierExportService {
    private final ExpedienteAuthorizationService authorization;
    private final DocumentRepository documents;
    private final AuditLogRepository logs;
    private final AuditLogService audit;
    private final ObjectMapper mapper;

    public ForensicDossierExportService(ExpedienteAuthorizationService authorization, DocumentRepository documents,
            AuditLogRepository logs, AuditLogService audit, ObjectMapper mapper) {
        this.authorization = authorization;
        this.documents = documents;
        this.logs = logs;
        this.audit = audit;
        this.mapper = mapper;
    }

    @Transactional
    public DossierExportPayload exportAsJson(UUID expedienteId) { return collect(expedienteId, "JSON"); }

    @Transactional
    public byte[] exportAsPdf(UUID expedienteId) {
        DossierExportPayload payload = collect(expedienteId, "PDF");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        Document pdf = new Document(org.openpdf.text.PageSize.A4, 40, 40, 42, 42);
        PdfWriter.getInstance(pdf, output);
        pdf.addTitle("OMEGA · Informe verificable de seguridad");
        pdf.addCreator("OMEGA · Exportación local");
        try {
            pdf.open();
            pdf.add(new Paragraph("OMEGA · Informe verificable de seguridad", font(18, true)));
            pdf.add(new Paragraph(payload.caseMetadata().title() + " · " + payload.exportedAtUtc(), font(10, false)));
            section(pdf, "1. Resumen Ejecutivo para el Usuario");
            pdf.add(new Paragraph("Riesgo registrado: " + payload.riskLevel() + ". " + payload.executiveSummary(), font(11, false)));
            pdf.add(new Paragraph("Expediente: " + expedienteId + " · Clasificación: " + payload.caseMetadata().classification(), font(10, false)));
            section(pdf, "2. Inventario de Evidencia y Hashes SHA-256");
            PdfPTable inventory = table("Documento / estado", "SHA-256 / clasificación");
            for (EvidenceItem item : payload.evidence()) {
                row(inventory, item.originalFilename() + "\n" + item.status(), item.sha256Hash() + "\n" + item.classification());
            }
            if (payload.evidence().isEmpty()) row(inventory, "Sin documentos registrados", "No se inventa evidencia");
            pdf.add(inventory);
            section(pdf, "3. Indicadores y Hallazgos Técnicos Correlacionados");
            if (payload.findings().isEmpty()) pdf.add(new Paragraph("No hay hallazgos persistidos y asociados a este expediente. Los resultados efímeros no registrados no pueden reconstruirse.", font(10, false)));
            for (FindingItem finding : payload.findings()) {
                pdf.add(new Paragraph(finding.action() + " · " + finding.createdAtUtc(), font(10, true)));
                pdf.add(new Paragraph(finding.explanation(), font(10, false)));
                pdf.add(new Paragraph(finding.technicalEvidence().toString(), font(9, false)));
            }
            section(pdf, "4. Certificación de Cadena de Custodia (audit_logs)");
            var chain = payload.chainOfCustody();
            pdf.add(new Paragraph(chain.status() + " · " + chain.detail(), font(11, true)));
            pdf.add(new Paragraph("Algoritmo: SHA-256\nGénesis: " + chain.genesisHash() + "\nHash raíz: " + chain.rootHash()
                    + "\nHash final: " + chain.finalHash() + "\nEnlaces verificados: " + chain.verifiedCount() + " / " + chain.totalEntries(), font(9, false)));
            PdfPTable sequence = table("Secuencia / evento UTC", "Previous hash / current hash");
            for (AuditEntry entry : chain.entries()) {
                row(sequence, entry.chainSeq() + " · " + (entry.proofOnly() ? "Compromiso de otro recurso (detalles reservados)" : entry.action())
                        + "\n" + entry.createdAtUtc(), entry.previousHash() + "\n" + entry.currentHash());
            }
            pdf.add(sequence);
            for (String limitation : payload.limitations()) pdf.add(new Paragraph(limitation, font(9, false)));
        } finally {
            pdf.close();
        }
        return output.toByteArray();
    }

    private DossierExportPayload collect(UUID expedienteId, String format) {
        var scope = TenantContext.get().orElseThrow(() -> new AccessDeniedException("Se requiere una sesión con TenantScope."));
        var principal = new OmegaPrincipal(scope.userId(), scope.tenantId(), "", scope.role(), true);
        var expediente = authorization.requireReadAccess(principal, expedienteId);
        var evidence = documents.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(scope.tenantId(), expedienteId).stream()
                .map(doc -> new EvidenceItem(doc.getId(), doc.getOriginalFilename(), doc.getSha256Hash(), doc.getStatus().name(),
                        expediente.getClassification().name(), doc.getTotalPages(), doc.getEmbeddingModel(), doc.getCreatedAt())).toList();
        Instant exportedAt = Instant.now();
        // record() holds the tenant advisory lock until this snapshot and its export transaction complete.
        audit.record(scope.tenantId(), scope.userId(), "EXPORT_FORENSIC_DOSSIER", "EXPEDIENTE", expedienteId.toString(),
                Map.of("format", format, "exportedAtUtc", exportedAt.toString(), "documentCount", evidence.size()));
        List<AuditLogEntity> sequence = logs.findAllByTenantIdOrderByChainSeqAsc(scope.tenantId());
        var verification = audit.verifyEntries(scope.tenantId(), sequence);
        Set<String> documentIds = evidence.stream().map(e -> String.valueOf(e.documentId())).collect(Collectors.toSet());
        List<AuditEntry> exportedEntries = new ArrayList<>();
        List<FindingItem> findings = new ArrayList<>();
        for (AuditLogEntity entry : sequence) {
            JsonNode metadata = readMetadata(entry.getMetadataJson());
            boolean relevant = ("EXPEDIENTE".equals(entry.getResourceType()) && expedienteId.toString().equals(entry.getResourceId()))
                    || ("DOCUMENT".equals(entry.getResourceType()) && documentIds.contains(entry.getResourceId()))
                    || expedienteId.toString().equals(metadata.path("expedienteId").asText());
            exportedEntries.add(new AuditEntry(entry.getChainSeq(), entry.getId(), entry.getTenantId(),
                    relevant ? entry.getActorUserId() : null, relevant ? entry.getAction() : null,
                    relevant ? entry.getResourceType() : null, relevant ? entry.getResourceId() : null,
                    relevant ? entry.getMetadataJson() : null, entry.getPreviousHash(), entry.getCurrentHash(), entry.getCreatedAt(), !relevant));
            if (relevant && (entry.getAction().contains("FORENSIC") && !entry.getAction().startsWith("EXPORT_")
                    || entry.getAction().startsWith("CONTAINMENT_"))) {
                findings.add(new FindingItem(entry.getId(), entry.getAction(), entry.getCreatedAt(), explanation(entry.getAction(), metadata), metadata));
            }
        }
        String risk = findings.stream().map(f -> f.technicalEvidence().path("riskLevel").asText("UNKNOWN"))
                .max(java.util.Comparator.comparingInt(ForensicDossierExportService::riskRank)).orElse("UNKNOWN");
        if (findings.stream().anyMatch(f -> f.technicalEvidence().path("totalMatches").asInt() > 0) && riskRank(risk) < 3) risk = "HIGH";
        String summary = evidence.size() + " documento(s) y " + findings.size() + " evento(s) forense(s) registrados. "
                + (riskRank(risk) >= 3 ? "Existen señales que requieren revisión especializada. " : "Los datos registrados no bastan para certificar ausencia de compromiso. ")
                + (verification.valid() ? "La cadena almacenada coincide con sus hashes al exportar." : "Se detectó una inconsistencia en la cadena: no debe tratarse como evidencia íntegra.");
        var chain = new ChainOfCustody(verification.valid() ? "CHAIN_VALID" : "CHAIN_COMPROMISED", "SHA-256",
                AuditLogService.GENESIS_HASH, sequence.isEmpty() ? AuditLogService.GENESIS_HASH : sequence.getFirst().getCurrentHash(),
                sequence.isEmpty() ? AuditLogService.GENESIS_HASH : sequence.getLast().getCurrentHash(), verification.verifiedCount(),
                sequence.size(), verification.brokenEntryId(), verification.detail(), List.copyOf(exportedEntries));
        return new DossierExportPayload("omega-dossier-v1", exportedAt,
                new CaseMetadata(expedienteId, scope.tenantId(), expediente.getTitle(), expediente.getClassification().name(), expediente.getCreatedAt()),
                risk, summary, evidence, List.copyOf(findings), chain, List.of(
                "Informe automatizado de OMEGA: no acredita firma de un perito ni certificación legal o sello de tiempo de una autoridad externa.",
                "CHAIN_VALID verifica la consistencia del snapshot almacenado; no demuestra autenticidad del archivo original ni detecta una reescritura completa de la cadena o eliminación de su cola sin un anclaje externo previo.",
                "Se verifica toda la cadena del tenant en orden chain_seq. Los registros de otros recursos se incluyen solo como compromisos hash, sin metadatos privados; no se pueden recalcular externamente sin acceso autorizado al registro original.",
                "Los SHA-256 de documentos son los registrados al ingresar; el PDF original no se conserva en el servidor bajo política Zero-Retention y no se ha vuelto a medir durante esta exportación. ADVERTENCIA LEGAL: el hash SHA-256 certifica integridad criptográfica, pero NO reemplaza la custodia ni la presentación del documento PDF original conservado localmente en el equipo del analista."));
    }

    private JsonNode readMetadata(String raw) {
        try { JsonNode value = mapper.readTree(raw); return value != null && value.isObject() ? value : mapper.createObjectNode().put("unreadableMetadata", true); }
        catch (Exception ex) { return mapper.createObjectNode().put("unreadableMetadata", true); }
    }

    private static int riskRank(String risk) {
        return switch (risk) { case "CRITICAL" -> 4; case "HIGH" -> 3; case "MEDIUM" -> 2; case "LOW" -> 1; default -> 0; };
    }

    private static String explanation(String action, JsonNode metadata) {
        if (action.startsWith("CONTAINMENT_")) return "Acción de protección registrada. Estado informado: " + metadata.path("result").asText("No consta resultado final") + ".";
        if (metadata.path("totalMatches").asInt() > 0) return "El análisis registró coincidencias con indicadores; requieren correlación técnica y revisión especializada.";
        return "Se ejecutó una comprobación forense. El detalle disponible está limitado a los campos persistidos en auditoría; cero coincidencias no acredita un equipo limpio.";
    }

    private static Font font(int size, boolean bold) { return FontFactory.getFont(FontFactory.HELVETICA, size, bold ? Font.BOLD : Font.NORMAL); }
    private static void section(Document pdf, String title) { Paragraph heading = new Paragraph(title, font(13, true)); heading.setSpacingBefore(18); heading.setSpacingAfter(8); pdf.add(heading); }
    private static PdfPTable table(String first, String second) {
        PdfPTable table = new PdfPTable(2); table.setWidthPercentage(100); table.setHeaderRows(1);
        table.setWidths(new float[]{32, 68});
        for (String heading : List.of(first, second)) { PdfPCell cell = new PdfPCell(new Phrase(heading, font(10, true))); cell.setPadding(7); cell.setBackgroundColor(new Color(235, 238, 242)); table.addCell(cell); }
        return table;
    }
    private static void row(PdfPTable table, String first, String second) {
        PdfPCell label = new PdfPCell(new Phrase(first, font(9, false))); label.setPadding(6); table.addCell(label);
        PdfPCell hash = new PdfPCell(new Phrase(second, FontFactory.getFont(FontFactory.COURIER, 8.5f))); hash.setPadding(6); table.addCell(hash);
    }

    public record DossierExportPayload(String schemaVersion, Instant exportedAtUtc, CaseMetadata caseMetadata, String riskLevel,
            String executiveSummary, List<EvidenceItem> evidence, List<FindingItem> findings, ChainOfCustody chainOfCustody, List<String> limitations) {}
    public record CaseMetadata(UUID expedienteId, UUID tenantId, String title, String classification, Instant createdAtUtc) {}
    public record EvidenceItem(UUID documentId, String originalFilename, String sha256Hash, String status, String classification,
            int totalPages, String embeddingModel, Instant createdAtUtc) {}
    public record FindingItem(UUID auditEntryId, String action, Instant createdAtUtc, String explanation, JsonNode technicalEvidence) {}
    public record AuditEntry(Long chainSeq, UUID id, UUID tenantId, UUID actorUserId, String action, String resourceType,
            String resourceId, String metadataJson, String previousHash, String currentHash, Instant createdAtUtc, boolean proofOnly) {}
    public record ChainOfCustody(String status, String algorithm, String genesisHash, String rootHash, String finalHash,
            int verifiedCount, int totalEntries, UUID brokenEntryId, String detail, List<AuditEntry> entries) {}
}
