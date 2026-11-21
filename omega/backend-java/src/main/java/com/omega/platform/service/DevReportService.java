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
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
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
                        "totalOpenFindings", report.triageCounts().getOrDefault("OPEN", 0)
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
                "CRITICAL", 0, "HIGH", 0, "MEDIUM", 0, "LOW", 0
        ));
        Map<String, Integer> triageCounts = new LinkedHashMap<>(Map.of(
                "OPEN", 0, "IN_REVIEW", 0, "ACCEPTED", 0, "FALSE_POSITIVE", 0, "FIXED", 0
        ));

        List<ProjectReportItemDto> projectItems = new ArrayList<>();
        List<FindingReportItemDto> sanitizedFindings = new ArrayList<>();
        List<SuppressionReportItemDto> activeSuppressionsOut = new ArrayList<>();

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
                for (DevFindingEntity f : findings) {
                    severityCounts.computeIfPresent(f.getSeverity(), (k, v) -> v + 1);
                    triageCounts.computeIfPresent(f.getTriageStatus(), (k, v) -> v + 1);
                    if (sanitizedFindings.size() < 200) {
                        sanitizedFindings.add(new FindingReportItemDto(
                                p.getName(),
                                f.getRuleId(),
                                f.getSeverity(),
                                DevProjectService.sanitizeText(f.getTitle(), 200),
                                DevProjectService.sanitizeText(f.getLocation(), 200),
                                f.getTriageStatus(),
                                f.getScorePoints()
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
                    latest != null ? latest.getPolicyStatus() : "PASS",
                    pol.failOnSeverity(),
                    pol.actionOnViolation()
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
                "Reporte ejecutivo OMEGA Zero-Retention: contiene únicamente metadatos saneados, sin fragmentos de código ni secretos."
        );
    }

    private byte[] renderPdf(ExecutiveReportDto report) {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDPage page = new PDPage(PDRectangle.A4);
            doc.addPage(page);
            PDType1Font fontBold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            PDType1Font fontRegular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);

            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                float y = 790f;
                y = writeLine(cs, fontBold, 14, 48, y, "OMEGA DEVELOPER SECURITY - REPORTE EJECUTIVO Y TECNICO");
                y = writeLine(cs, fontRegular, 9, 48, y - 4, "Alcance: " + report.scope() + " | Generado: " + report.generatedAt());
                y = writeLine(cs, fontRegular, 9, 48, y - 2, "Proyectos evaluados: " + report.projectsCount()
                        + " | Puntaje efectivo promedio: " + report.averageEffectiveScore() + "/100");

                y -= 10;
                y = writeLine(cs, fontBold, 11, 48, y, "1. Resumen de Hallazgos por Severidad y Triaje");
                y = writeLine(cs, fontRegular, 9, 48, y, "Severidad -> CRITICAL: " + report.severityCounts().getOrDefault("CRITICAL", 0)
                        + " | HIGH: " + report.severityCounts().getOrDefault("HIGH", 0)
                        + " | MEDIUM: " + report.severityCounts().getOrDefault("MEDIUM", 0)
                        + " | LOW: " + report.severityCounts().getOrDefault("LOW", 0));
                y = writeLine(cs, fontRegular, 9, 48, y, "Triaje -> OPEN: " + report.triageCounts().getOrDefault("OPEN", 0)
                        + " | IN_REVIEW: " + report.triageCounts().getOrDefault("IN_REVIEW", 0)
                        + " | ACCEPTED: " + report.triageCounts().getOrDefault("ACCEPTED", 0)
                        + " | FALSE_POSITIVE: " + report.triageCounts().getOrDefault("FALSE_POSITIVE", 0)
                        + " | FIXED: " + report.triageCounts().getOrDefault("FIXED", 0));

                y -= 10;
                y = writeLine(cs, fontBold, 11, 48, y, "2. Estado de Proyectos y Politicas");
                for (ProjectReportItemDto p : report.projects()) {
                    if (y < 120) break;
                    String line = String.format(
                            "- %s (%s): Efectivo %.1f/100 (Bruto %.1f) | Hallazgos: %d | Deps: %d | Politica: %s (%s)",
                            toAsciiSafe(p.name()), p.slug(), p.effectiveScore(), p.rawScore(),
                            p.findingsCount(), p.dependenciesCount(), p.policyStatus(), p.failOnSeverity()
                    );
                    y = writeLine(cs, fontRegular, 9, 48, y, line);
                }

                y -= 10;
                y = writeLine(cs, fontBold, 11, 48, y, "3. Hallazgos Prioritarios (Saneados - Zero Retention)");
                if (report.findings().isEmpty()) {
                    y = writeLine(cs, fontRegular, 9, 48, y, "- Sin hallazgos registrados en el ultimo escaneo.");
                } else {
                    for (int i = 0; i < Math.min(report.findings().size(), 15); i++) {
                        if (y < 90) break;
                        FindingReportItemDto f = report.findings().get(i);
                        String line = String.format(
                                "- [%s] %s (%s) en %s | Estado: %s",
                                f.severity(), f.ruleId(), toAsciiSafe(f.projectName()),
                                toAsciiSafe(f.location() == null ? "root" : f.location()), f.triageStatus()
                        );
                        y = writeLine(cs, fontRegular, 8, 48, y, line);
                    }
                }

                y -= 10;
                y = writeLine(cs, fontBold, 11, 48, y, "4. Riesgos Aceptados y Supresiones con Expiracion");
                if (report.activeSuppressions().isEmpty()) {
                    y = writeLine(cs, fontRegular, 9, 48, y, "- Sin supresiones activas.");
                } else {
                    for (int i = 0; i < Math.min(report.activeSuppressions().size(), 8); i++) {
                        if (y < 60) break;
                        SuppressionReportItemDto s = report.activeSuppressions().get(i);
                        String line = String.format(
                                "- %s | Regla %s | Expira: %s | Motivo: %s",
                                toAsciiSafe(s.projectName()), s.ruleId(), s.expiresAt(), toAsciiSafe(s.reason())
                        );
                        y = writeLine(cs, fontRegular, 8, 48, y, line);
                    }
                }

                writeLine(cs, fontRegular, 8, 48, 36, toAsciiSafe(report.zeroRetentionNotice()));
            }
            doc.save(out);
            return out.toByteArray();
        } catch (IOException ex) {
            throw new IllegalStateException("No se pudo generar el reporte PDF de desarrollo", ex);
        }
    }

    private static float writeLine(
            PDPageContentStream cs,
            PDType1Font font,
            float fontSize,
            float x,
            float y,
            String text
    ) throws IOException {
        String safe = toAsciiSafe(text);
        if (safe.length() > 110) {
            safe = safe.substring(0, 107) + "...";
        }
        cs.beginText();
        cs.setFont(font, fontSize);
        cs.newLineAtOffset(x, y);
        cs.showText(safe);
        cs.endText();
        return y - (fontSize + 5f);
    }

    private static String toAsciiSafe(String input) {
        if (input == null) return "";
        return input
                .replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u')
                .replace('Á', 'A').replace('É', 'E').replace('Í', 'I').replace('Ó', 'O').replace('Ú', 'U')
                .replace('ñ', 'n').replace('Ñ', 'N')
                .replaceAll("[^\\x20-\\x7E]", " ");
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
            String actionOnViolation
    ) {}

    public record FindingReportItemDto(
            String projectName,
            String ruleId,
            String severity,
            String title,
            String location,
            String triageStatus,
            double scorePoints
    ) {}

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
            String zeroRetentionNotice
    ) {}
}
