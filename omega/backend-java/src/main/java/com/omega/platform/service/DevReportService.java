package com.omega.platform.service;

import com.omega.platform.domain.DevFindingEntity;
import com.omega.platform.domain.DevProjectEntity;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.domain.DevSuppressionEntity;
import com.omega.platform.repository.DevDependencyRepository;
import com.omega.platform.repository.DevFindingRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DevScanRepository;
import com.omega.platform.repository.DevSuppressionRepository;
import com.omega.platform.security.OmegaPrincipal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Generación y exportación (JSON / PDF) de reportes ejecutivos y técnicos de seguridad de proyectos DEVELOPER.
 * Zero-Retention: excluye cualquier evidencia o valor sensible; audita toda exportación en audit_logs.
 */
@Service
public class DevReportService {

    private final DevProjectRepository projectRepository;
    private final DevScanRepository scanRepository;
    private final DevFindingRepository findingRepository;
    private final DevDependencyRepository dependencyRepository;
    private final DevSuppressionRepository suppressionRepository;
    private final DevPolicyService policyService;
    private final AuditLogService auditLogService;

    public DevReportService(
            DevProjectRepository projectRepository,
            DevScanRepository scanRepository,
            DevFindingRepository findingRepository,
            DevDependencyRepository dependencyRepository,
            DevSuppressionRepository suppressionRepository,
            DevPolicyService policyService,
            AuditLogService auditLogService
    ) {
        this.projectRepository = projectRepository;
        this.scanRepository = scanRepository;
        this.findingRepository = findingRepository;
        this.dependencyRepository = dependencyRepository;
        this.suppressionRepository = suppressionRepository;
        this.policyService = policyService;
        this.auditLogService = auditLogService;
    }

    @Transactional
    public ExecutiveReportDto exportJsonReport(OmegaPrincipal principal, UUID projectId) {
        ExecutiveReportDto report = buildReportData(principal, projectId);
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_REPORT_EXPORTED",
                projectId != null ? "DEV_PROJECT" : "TENANT",
                projectId != null ? projectId.toString() : principal.tenantId().toString(),
                Map.of(
                        "format", "json",
                        "projectsIncluded", report.projectsCount(),
                        "totalOpenFindings", report.triageCounts().getOrDefault("NEW", 0)
                )
        );
        return report;
    }

    @Transactional
    public byte[] exportPdfReport(OmegaPrincipal principal, UUID projectId) {
        ExecutiveReportDto report = buildReportData(principal, projectId);
        byte[] pdfBytes = renderPdf(report);
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_REPORT_EXPORTED",
                projectId != null ? "DEV_PROJECT" : "TENANT",
                projectId != null ? projectId.toString() : principal.tenantId().toString(),
                Map.of(
                        "format", "pdf",
                        "projectsIncluded", report.projectsCount(),
                        "bytes", pdfBytes.length
                )
        );
        return pdfBytes;
    }

    private ExecutiveReportDto buildReportData(OmegaPrincipal principal, UUID projectId) {
        UUID tenantId = principal.tenantId();
        List<DevProjectEntity> projects;
        if (projectId != null) {
            DevProjectEntity single = projectRepository.findByIdAndTenantId(projectId, tenantId)
                    .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
            projects = List.of(single);
        } else {
            projects = projectRepository.findAllByTenantIdOrderByUpdatedAtDesc(tenantId);
        }

        Map<String, Integer> severityCounts = new LinkedHashMap<>(Map.of(
                "CRITICAL", 0, "HIGH", 0, "MEDIUM", 0, "LOW", 0, "INFO", 0
        ));
        Map<String, Integer> triageCounts = new LinkedHashMap<>(Map.of(
                "NEW", 0, "CONFIRMED", 0, "ACCEPTED", 0, "FALSE_POSITIVE", 0, "RESOLVED", 0
        ));

        List<ProjectReportItemDto> projectItems = new ArrayList<>();
        List<FindingReportItemDto> sanitizedFindings = new ArrayList<>();
        List<SuppressionReportItemDto> activeSuppressionsOut = new ArrayList<>();
        List<DevScanComparison.Comparison> comparisons = new ArrayList<>();

        double sumEffective = 0.0;
        int scoredProjects = 0;
        Instant now = Instant.now();

        for (DevProjectEntity p : projects) {
            List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, p.getId());
            DevScanEntity latest = scans.isEmpty() ? null : scans.get(0);
            DevScanEntity prev = scans.size() > 1 ? scans.get(1) : null;
            Double delta = (latest != null && prev != null) ? latest.getEffectiveScore() - prev.getEffectiveScore() : null;

            if (latest != null) {
                sumEffective += latest.getEffectiveScore();
                scoredProjects++;
                List<DevFindingEntity> findings = findingRepository.findAllByTenantIdAndScanIdOrderByScorePointsDesc(
                        tenantId, latest.getId());
                comparisons.add(DevScanComparison.compare(p.getId(),latest.getId(),prev==null?null:prev.getId(),findings,
                        prev==null?List.of():findingRepository.findAllByTenantIdAndScanIdOrderByScorePointsDesc(tenantId,prev.getId())));
                for (DevFindingEntity f : findings) {
                    severityCounts.computeIfPresent(f.getSeverity(), (k, v) -> v + 1);
                    triageCounts.computeIfPresent(f.getTriageStatus(), (k, v) -> v + 1);
                    {
                        sanitizedFindings.add(new FindingReportItemDto(
                                p.getName(),
                                f.getRuleId(),
                                f.getSeverity(),
                                DevProjectService.sanitizeText(f.getTitle(), 255),
                                DevProjectService.sanitizeText(f.getLocation(), 300),
                                f.getTriageStatus(),
                                f.getScorePoints(),
                                f.getId(), latest.getId(),
                                DevProjectService.sanitizeText(f.getExplanation(), 1200),
                                "Revisar la evidencia del detector y confirmar en el contexto del proyecto.",
                                String.join(" ",DevRemediationGuide.forFinding(f.getRuleId(),f.getLocation()).steps()),
                                DevRemediationGuide.forFinding(f.getRuleId(),f.getLocation()).verification()
                        ));
                    }
                }
            }

            List<DevSuppressionEntity> sups = suppressionRepository
                    .findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, p.getId())
                    .stream()
                    .filter(s -> s.isActiveAt(now))
                    .toList();
            for (DevSuppressionEntity s : sups) {
                activeSuppressionsOut.add(new SuppressionReportItemDto(
                        p.getName(),
                        s.getRuleId(),
                        DevProjectService.sanitizeText(s.getReason(), 240),
                        s.getExpiresAt()
                ));
            }

            DevPolicyService.PolicyDto pol = policyService.getEffectivePolicyForProject(tenantId, p.getId());
            projectItems.add(new ProjectReportItemDto(
                    p.getId(),
                    p.getName(),
                    p.getSlug(),
                    scans.size(),
                    latest != null ? latest.getScore() : 0.0,
                    latest != null ? latest.getEffectiveScore() : 0.0,
                    delta,
                    latest != null ? latest.getFindingsCount() : 0,
                    latest != null ? latest.getDependenciesCount() : 0,
                    latest != null ? latest.getPolicyStatus() : "NOT_EVALUATED",
                    pol.failOnSeverity(),
                    pol.actionOnViolation(),
                    latest != null ? latest.getId() : null, latest != null ? latest.getCreatedAt() : null,
                    latest != null ? latest.getCommitSha() : null, latest != null ? latest.getBranch() : null,
                    latest != null ? latest.getRulesVersion() : null, latest != null ? latest.getLimitsJson() : "{}"
            ));
        }

        double avgScore = scoredProjects > 0 ? Math.round((sumEffective / scoredProjects) * 10.0) / 10.0 : 0.0;

        return new ExecutiveReportDto(
                projectId != null ? "PROJECT" : "ORGANIZATION",
                Instant.now(),
                projects.size(),
                avgScore,
                severityCounts,
                triageCounts,
                projectItems,
                sanitizedFindings,
                activeSuppressionsOut,
                "Informe automatizado con metadatos y textos saneados, sin archivos originales ni valores de secretos. No certifica ausencia de vulnerabilidades.",
                comparisons
        );
    }

    public static byte[] renderPdf(ExecutiveReportDto report) { return renderPdf(report,"Exportación directa"); }
    public static byte[] renderPdf(ExecutiveReportDto report,String reportId) {
        var sections = new ArrayList<ReportPdf.Section>();
        sections.add(new ReportPdf.Section("1. Resumen ejecutivo", List.of(
                "Proyectos incluidos: " + report.projectsCount() + ". Hallazgos registrados: " + report.findings().size()
                        + ". Proyectos sin evaluación: " + report.projects().stream().filter(p -> p.scansCount() == 0).count() + ".",
                "Severidad: " + report.severityCounts() + ". Triaje: " + report.triageCounts(),
                "Atender primero los hallazgos críticos y altos abiertos. La severidad expresa prioridad; no acredita explotación confirmada.")));
        sections.add(new ReportPdf.Section("2. Alcance, versiones y cobertura", report.projects().stream().map(p ->
                p.name() + " · " + p.projectId() + "\nEvaluación: " + p.scanId() + " · Fecha: " + p.scannedAt()
                + "\nCommit: " + p.commitSha() + " · Rama: " + p.branch() + " · Reglas: " + p.rulesVersion()
                + "\nLímites registrados por el analizador: " + p.limitsJson()
                + "\nDependencias: " + p.dependenciesCount() + " · Política: " + p.policyStatus()
                + " · Puntaje efectivo: " + (p.scansCount() == 0 ? "No evaluado" : p.effectiveScore() + "/100")
                + " · Cambio frente a la evaluación anterior: " + p.scoreDelta()).toList()));
        var findings = new ArrayList<String>();
        for (var f : report.findings()) findings.add("[" + f.severity() + "] " + f.title()
                + "\nReferencia: " + f.findingId() + " · Evaluación: " + f.scanId()
                + "\nProyecto: " + f.projectName() + " · Regla: " + f.ruleId() + " · Ubicación: " + f.location()
                + "\nEstado: " + f.triageStatus() + "\nObservación registrada: " + f.explanation()
                + "\nConfianza: " + f.confidence() + "\nAcciones:\n- " + String.join("\n- ",f.remediation().steps()) + "\nVerificación: " + f.verification());
        if (findings.isEmpty()) findings.add("No hay hallazgos registrados en las evaluaciones incluidas. Revise los proyectos no evaluados y los límites de cobertura.");
        sections.add(new ReportPdf.Section("3. Hallazgos, acciones y verificación", findings));
        sections.add(new ReportPdf.Section("4. Riesgos aceptados y supresiones", report.activeSuppressions().isEmpty()
                ? List.of("Sin supresiones activas.") : report.activeSuppressions().stream().map(s ->
                s.projectName() + " · " + s.ruleId() + " · Expira: " + s.expiresAt() + " · Motivo: " + s.reason()).toList()));
        sections.add(new ReportPdf.Section("Comparación con la evaluación anterior",report.comparisons().isEmpty()
            ? List.of("Sin comparaciones disponibles.") : report.comparisons().stream().map(c ->
                "Proyecto: " + c.projectId() + " · Actual: " + c.latestScanId() + " · Anterior: " + c.previousScanId()
                + "\nNuevos: " + c.added() + " · Persistentes: " + c.persisting() + " · No detectados en la última: " + c.notSeen()
                + "\n" + c.limitation()).toList()));
        sections.add(new ReportPdf.Section("5. Método y limitaciones", List.of(report.zeroRetentionNotice(),
                "Se utiliza la última evaluación persistida de cada proyecto. No se ejecuta un nuevo análisis al descargar.",
                "La cobertura depende del analizador y de sus límites registrados. No equivale a pentest, revisión completa de código ni garantía de seguridad.",
                "Las recomendaciones son orientaciones de revisión; compruebe su aplicabilidad antes de cambiar una dependencia o una configuración.")));
        return ReportPdf.render("OMEGA · Informe de desarrollo", reportId + " · Formato omega-dev-v2 · " + report.generatedAt() + " · " + report.scope(), sections);
    }

    public record ProjectReportItemDto(
            UUID projectId,
            String name,
            String slug,
            int scansCount,
            double rawScore,
            double effectiveScore,
            Double scoreDelta,
            int findingsCount,
            int dependenciesCount,
            String policyStatus,
            String failOnSeverity,
            String actionOnViolation,
            UUID scanId, Instant scannedAt, String commitSha, String branch, String rulesVersion, String limitsJson
    ) {}

    public record FindingReportItemDto(
            String projectName,
            String ruleId,
            String severity,
            String title,
            String location,
            String triageStatus,
            double scorePoints,
            UUID findingId, UUID scanId, String explanation, String confidence, String recommendation, String verification,
            DevRemediationGuide.Guide remediation
    ) {
        public FindingReportItemDto(String projectName,String ruleId,String severity,String title,String location,String triageStatus,double scorePoints,
                UUID findingId,UUID scanId,String explanation,String confidence,String recommendation,String verification) {
            this(projectName,ruleId,severity,title,location,triageStatus,scorePoints,findingId,scanId,explanation,confidence,recommendation,verification,
                DevRemediationGuide.forFinding(ruleId,location));
        }
    }

    public record SuppressionReportItemDto(
            String projectName,
            String ruleId,
            String reason,
            Instant expiresAt
    ) {}

    public record ExecutiveReportDto(
            String scope,
            Instant generatedAt,
            int projectsCount,
            double averageEffectiveScore,
            Map<String, Integer> severityCounts,
            Map<String, Integer> triageCounts,
            List<ProjectReportItemDto> projects,
            List<FindingReportItemDto> findings,
            List<SuppressionReportItemDto> activeSuppressions,
            String zeroRetentionNotice,
            List<DevScanComparison.Comparison> comparisons
    ) {
        public ExecutiveReportDto(String scope,Instant generatedAt,int projectsCount,double averageEffectiveScore,Map<String,Integer> severityCounts,
                Map<String,Integer> triageCounts,List<ProjectReportItemDto> projects,List<FindingReportItemDto> findings,List<SuppressionReportItemDto> activeSuppressions,String zeroRetentionNotice) {
            this(scope,generatedAt,projectsCount,averageEffectiveScore,severityCounts,triageCounts,projects,findings,activeSuppressions,zeroRetentionNotice,List.of());
        }
    }
}
