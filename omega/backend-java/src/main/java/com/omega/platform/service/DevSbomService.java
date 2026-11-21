package com.omega.platform.service;

import com.omega.platform.domain.DevDependencyEntity;
import com.omega.platform.domain.DevFindingEntity;
import com.omega.platform.domain.DevProjectEntity;
import com.omega.platform.domain.DevScanEntity;
import com.omega.platform.repository.DevDependencyRepository;
import com.omega.platform.repository.DevFindingRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.repository.DevScanRepository;
import com.omega.platform.security.OmegaPrincipal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Inventario de dependencias por proyecto y exportación de SBOM en formatos estándar CycloneDX 1.5 y SPDX 2.3 JSON.
 */
@Service
public class DevSbomService {

    private final DevProjectRepository projectRepository;
    private final DevScanRepository scanRepository;
    private final DevDependencyRepository dependencyRepository;
    private final DevFindingRepository findingRepository;
    private final AuditLogService auditLogService;

    public DevSbomService(
            DevProjectRepository projectRepository,
            DevScanRepository scanRepository,
            DevDependencyRepository dependencyRepository,
            DevFindingRepository findingRepository,
            AuditLogService auditLogService
    ) {
        this.projectRepository = projectRepository;
        this.scanRepository = scanRepository;
        this.dependencyRepository = dependencyRepository;
        this.findingRepository = findingRepository;
        this.auditLogService = auditLogService;
    }

    @Transactional(readOnly = true)
    public DependencyInventoryDto listProjectDependencies(
            OmegaPrincipal principal,
            UUID projectId,
            String ecosystemFilter,
            String searchFilter
    ) {
        UUID tenantId = principal.tenantId();
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));

        List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId);
        if (scans.isEmpty()) {
            return new DependencyInventoryDto(project.getId(), project.getName(), null, null, 0, 0, List.of());
        }
        DevScanEntity latestScan = scans.get(0);
        List<DevDependencyEntity> deps = dependencyRepository.findAllByTenantIdAndScanIdOrderByEcosystemAscPackageNameAsc(
                tenantId, latestScan.getId());
        List<DevFindingEntity> findings = findingRepository.findAllByTenantIdAndScanIdOrderByScorePointsDesc(
                tenantId, latestScan.getId());

        String cleanEco = ecosystemFilter == null ? "" : ecosystemFilter.trim().toLowerCase(Locale.ROOT);
        String cleanQuery = searchFilter == null ? "" : searchFilter.trim().toLowerCase(Locale.ROOT);

        List<DependencyItemDto> items = new ArrayList<>();
        int riskyCount = 0;
        for (DevDependencyEntity dep : deps) {
            if (!cleanEco.isEmpty() && !dep.getEcosystem().equalsIgnoreCase(cleanEco)) {
                continue;
            }
            if (!cleanQuery.isEmpty()
                    && !dep.getPackageName().toLowerCase(Locale.ROOT).contains(cleanQuery)
                    && !dep.getPurl().toLowerCase(Locale.ROOT).contains(cleanQuery)) {
                continue;
            }

            List<AssociatedSignalDto> associatedSignals = new ArrayList<>();
            String pkgLower = dep.getPackageName().toLowerCase(Locale.ROOT);
            for (DevFindingEntity f : findings) {
                String titleLower = f.getTitle() == null ? "" : f.getTitle().toLowerCase(Locale.ROOT);
                String expLower = f.getExplanation() == null ? "" : f.getExplanation().toLowerCase(Locale.ROOT);
                String locLower = f.getLocation() == null ? "" : f.getLocation().toLowerCase(Locale.ROOT);
                if (titleLower.contains(pkgLower) || expLower.contains(pkgLower) || locLower.contains(pkgLower)) {
                    associatedSignals.add(new AssociatedSignalDto(
                            f.getId(), f.getRuleId(), f.getSeverity(), f.getTitle(), f.getTriageStatus()
                    ));
                }
            }
            if (!associatedSignals.isEmpty()) {
                riskyCount++;
            }

            items.add(new DependencyItemDto(
                    dep.getId(),
                    dep.getEcosystem(),
                    dep.getPackageName(),
                    dep.getPackageVersion(),
                    dep.getPurl(),
                    dep.getManifestPath(),
                    dep.isDirectDependency(),
                    associatedSignals
            ));
        }

        return new DependencyInventoryDto(
                project.getId(),
                project.getName(),
                latestScan.getId(),
                latestScan.getCreatedAt(),
                items.size(),
                riskyCount,
                items
        );
    }

    @Transactional
    public Map<String, Object> exportProjectSbom(OmegaPrincipal principal, UUID projectId, String format) {
        UUID tenantId = principal.tenantId();
        DevProjectEntity project = projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));

        String normalizedFormat = format == null ? "cyclonedx" : format.trim().toLowerCase(Locale.ROOT);
        if (!normalizedFormat.equals("cyclonedx") && !normalizedFormat.equals("spdx")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Formato SBOM inválido. Usa cyclonedx o spdx.");
        }

        List<DevScanEntity> scans = scanRepository.findAllByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId);
        List<DevDependencyEntity> deps = scans.isEmpty()
                ? List.of()
                : dependencyRepository.findAllByTenantIdAndScanIdOrderByEcosystemAscPackageNameAsc(
                        tenantId, scans.get(0).getId());

        Map<String, Object> document = normalizedFormat.equals("cyclonedx")
                ? buildCycloneDx15(project, deps)
                : buildSpdx23(project, deps);

        auditLogService.record(
                tenantId,
                principal.userId(),
                "DEV_SBOM_EXPORTED",
                "DEV_PROJECT",
                project.getId().toString(),
                Map.of("format", normalizedFormat, "componentsCount", deps.size())
        );

        return document;
    }

    private Map<String, Object> buildCycloneDx15(DevProjectEntity project, List<DevDependencyEntity> deps) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("bomFormat", "CycloneDX");
        root.put("specVersion", "1.5");
        root.put("serialNumber", "urn:uuid:" + UUID.randomUUID());
        root.put("version", 1);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("timestamp", Instant.now().toString());
        metadata.put("tools", List.of(Map.of(
                "vendor", "OMEGA Security Platform",
                "name", "OMEGA Developer SBOM Exporter",
                "version", "2.0.0"
        )));
        Map<String, Object> rootComponent = new LinkedHashMap<>();
        rootComponent.put("type", "application");
        rootComponent.put("bom-ref", "pkg:generic/" + project.getSlug());
        rootComponent.put("name", project.getName());
        metadata.put("component", rootComponent);
        root.put("metadata", metadata);

        List<Map<String, Object>> components = new ArrayList<>(deps.size());
        List<String> directRefs = new ArrayList<>();
        for (DevDependencyEntity dep : deps) {
            Map<String, Object> comp = new LinkedHashMap<>();
            comp.put("type", "library");
            comp.put("bom-ref", dep.getPurl());
            comp.put("name", dep.getPackageName());
            comp.put("version", dep.getPackageVersion().isEmpty() ? "unspecified" : dep.getPackageVersion());
            comp.put("purl", dep.getPurl());
            comp.put("scope", dep.isDirectDependency() ? "required" : "optional");
            List<Map<String, String>> props = new ArrayList<>();
            props.add(Map.of("name", "omega:ecosystem", "value", dep.getEcosystem()));
            props.add(Map.of("name", "omega:direct", "value", String.valueOf(dep.isDirectDependency())));
            if (dep.getManifestPath() != null && !dep.getManifestPath().isBlank()) {
                props.add(Map.of("name", "omega:manifest", "value", dep.getManifestPath()));
            }
            comp.put("properties", props);
            components.add(comp);
            if (dep.isDirectDependency()) {
                directRefs.add(dep.getPurl());
            }
        }
        root.put("components", components);
        root.put("dependencies", List.of(Map.of(
                "ref", "pkg:generic/" + project.getSlug(),
                "dependsOn", directRefs
        )));
        return root;
    }

    private Map<String, Object> buildSpdx23(DevProjectEntity project, List<DevDependencyEntity> deps) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("spdxVersion", "SPDX-2.3");
        root.put("dataLicense", "CC0-1.0");
        root.put("SPDXID", "SPDXRef-DOCUMENT");
        root.put("name", project.getName() + "-sbom");
        root.put("documentNamespace", "https://omega.security/spdx/" + project.getId() + "/" + UUID.randomUUID());
        root.put("creationInfo", Map.of(
                "created", Instant.now().toString(),
                "creators", List.of("Tool: OMEGA-Developer-SBOM-2.0.0")
        ));

        List<Map<String, Object>> packages = new ArrayList<>(deps.size() + 1);
        String rootSpdxId = "SPDXRef-Project-" + sanitizeSpdxId(project.getSlug());
        Map<String, Object> rootPkg = new LinkedHashMap<>();
        rootPkg.put("SPDXID", rootSpdxId);
        rootPkg.put("name", project.getName());
        rootPkg.put("versionInfo", "HEAD");
        rootPkg.put("downloadLocation", project.getRepoUrl() != null ? project.getRepoUrl() : "NOASSERTION");
        rootPkg.put("filesAnalyzed", false);
        packages.add(rootPkg);

        List<Map<String, String>> relationships = new ArrayList<>();
        relationships.add(Map.of(
                "spdxElementId", "SPDXRef-DOCUMENT",
                "relationshipType", "DESCRIBES",
                "relatedSpdxElement", rootSpdxId
        ));

        int idx = 1;
        for (DevDependencyEntity dep : deps) {
            String spdxId = "SPDXRef-Package-" + idx++ + "-" + sanitizeSpdxId(dep.getPackageName());
            Map<String, Object> pkg = new LinkedHashMap<>();
            pkg.put("SPDXID", spdxId);
            pkg.put("name", dep.getPackageName());
            pkg.put("versionInfo", dep.getPackageVersion().isEmpty() ? "NOASSERTION" : dep.getPackageVersion());
            pkg.put("downloadLocation", "NOASSERTION");
            pkg.put("filesAnalyzed", false);
            pkg.put("externalRefs", List.of(Map.of(
                    "referenceCategory", "PACKAGE-MANAGER",
                    "referenceType", "purl",
                    "referenceLocator", dep.getPurl()
            )));
            packages.add(pkg);
            relationships.add(Map.of(
                    "spdxElementId", rootSpdxId,
                    "relationshipType", dep.isDirectDependency() ? "DEPENDS_ON" : "CONTAINS",
                    "relatedSpdxElement", spdxId
            ));
        }

        root.put("packages", packages);
        root.put("relationships", relationships);
        return root;
    }

    private static String sanitizeSpdxId(String raw) {
        if (raw == null || raw.isBlank()) return "pkg";
        String s = raw.replaceAll("[^A-Za-z0-9.-]", "-");
        return s.length() > 60 ? s.substring(0, 60) : s;
    }

    public record AssociatedSignalDto(
            UUID findingId,
            String ruleId,
            String severity,
            String title,
            String triageStatus
    ) {}

    public record DependencyItemDto(
            UUID id,
            String ecosystem,
            String name,
            String version,
            String purl,
            String manifestPath,
            boolean direct,
            List<AssociatedSignalDto> signals
    ) {}

    public record DependencyInventoryDto(
            UUID projectId,
            String projectName,
            UUID scanId,
            Instant scannedAt,
            int totalDependencies,
            int dependenciesWithSignals,
            List<DependencyItemDto> dependencies
    ) {}
}
