package com.omega.platform.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DevDependencyEntity;
import com.omega.platform.domain.DevFindingEntity;
import com.omega.platform.domain.DevPolicyEntity;
import com.omega.platform.repository.DevPolicyRepository;
import com.omega.platform.repository.DevProjectRepository;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Políticas de seguridad de repositorios por tenant y override por proyecto.
 * Permite configurar severidad de fallo, acción en violación y listas de paquetes permitidos/bloqueados.
 */
@Service
public class DevPolicyService {

    private static final Set<String> VALID_SEVERITIES = Set.of("CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE");
    private static final Set<String> VALID_ACTIONS = Set.of("MARK_ONLY", "FAIL_PIPELINE", "COMMENT_PR");

    private final DevPolicyRepository policyRepository;
    private final DevProjectRepository projectRepository;
    private final AuditLogService auditLogService;
    private final ObjectMapper objectMapper;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.repository.TenantRepository tenantRepository;

    public DevPolicyService(
            DevPolicyRepository policyRepository,
            DevProjectRepository projectRepository,
            AuditLogService auditLogService,
            ObjectMapper objectMapper
    ) {
        this.policyRepository = policyRepository;
        this.projectRepository = projectRepository;
        this.auditLogService = auditLogService;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public PolicyDto getTenantPolicy(OmegaPrincipal principal) {
        return getEffectivePolicyForProject(principal.tenantId(), null);
    }

    @Transactional(readOnly = true)
    public PolicyDto getProjectPolicy(OmegaPrincipal principal, UUID projectId) {
        projectRepository.findByIdAndTenantId(projectId, principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        return getEffectivePolicyForProject(principal.tenantId(), projectId);
    }

    @Transactional(readOnly = true)
    public PolicyDto getEffectivePolicyForProject(UUID tenantId, UUID projectId) {
        if (projectId != null) {
            Optional<DevPolicyEntity> projectOverride = policyRepository.findByTenantIdAndProjectId(tenantId, projectId);
            if (projectOverride.isPresent()) {
                return toDto(projectOverride.get(), true);
            }
        }
        Optional<DevPolicyEntity> tenantDefault = policyRepository.findByTenantIdAndProjectIdIsNull(tenantId);
        if (tenantDefault.isPresent()) {
            return toDto(tenantDefault.get(), false);
        }
        return new PolicyDto(
                null,
                projectId,
                false,
                "HIGH",
                "FAIL_PIPELINE",
                List.of(),
                List.of(),
                null
        );
    }

    @Transactional
    public PolicyDto upsertTenantPolicy(OmegaPrincipal principal, UpsertPolicyRequest request) {
        requireAdmin(principal);
        UUID tenantId = principal.tenantId();
        String sev = normalizeSeverity(request.failOnSeverity());
        String action = normalizeAction(request.actionOnViolation());
        List<String> allowed = sanitizePackageList(request.allowedPackages());
        List<String> blocked = sanitizePackageList(request.blockedPackages());

        DevPolicyEntity entity = policyRepository.findByTenantIdAndProjectIdIsNull(tenantId)
                .map(existing -> {
                    existing.setFailOnSeverity(sev);
                    existing.setActionOnViolation(action);
                    existing.setAllowedPackagesJson(writeJsonList(allowed));
                    existing.setBlockedPackagesJson(writeJsonList(blocked));
                    existing.touch(principal.userId());
                    return existing;
                })
                .orElseGet(() -> new DevPolicyEntity(
                        tenantId,
                        null,
                        sev,
                        action,
                        writeJsonList(allowed),
                        writeJsonList(blocked),
                        principal.userId()
                ));

        DevPolicyEntity saved = policyRepository.saveAndFlush(entity);
        auditLogService.record(
                tenantId,
                principal.userId(),
                "DEV_POLICY_UPDATED",
                "DEV_POLICY",
                saved.getId().toString(),
                Map.of(
                        "scope", "TENANT_DEFAULT",
                        "failOnSeverity", sev,
                        "actionOnViolation", action,
                        "allowedCount", allowed.size(),
                        "blockedCount", blocked.size()
                )
        );
        return toDto(saved, false);
    }

    @Transactional
    public PolicyDto upsertProjectPolicy(OmegaPrincipal principal, UUID projectId, UpsertPolicyRequest request) {
        requireAdmin(principal);
        UUID tenantId = principal.tenantId();
        projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));

        String sev = normalizeSeverity(request.failOnSeverity());
        String action = normalizeAction(request.actionOnViolation());
        List<String> allowed = sanitizePackageList(request.allowedPackages());
        List<String> blocked = sanitizePackageList(request.blockedPackages());

        DevPolicyEntity entity = policyRepository.findByTenantIdAndProjectId(tenantId, projectId)
                .map(existing -> {
                    existing.setFailOnSeverity(sev);
                    existing.setActionOnViolation(action);
                    existing.setAllowedPackagesJson(writeJsonList(allowed));
                    existing.setBlockedPackagesJson(writeJsonList(blocked));
                    existing.touch(principal.userId());
                    return existing;
                })
                .orElseGet(() -> new DevPolicyEntity(
                        tenantId,
                        projectId,
                        sev,
                        action,
                        writeJsonList(allowed),
                        writeJsonList(blocked),
                        principal.userId()
                ));

        DevPolicyEntity saved = policyRepository.saveAndFlush(entity);
        auditLogService.record(
                tenantId,
                principal.userId(),
                "DEV_POLICY_UPDATED",
                "DEV_POLICY",
                saved.getId().toString(),
                Map.of(
                        "scope", "PROJECT_OVERRIDE",
                        "projectId", projectId.toString(),
                        "failOnSeverity", sev,
                        "actionOnViolation", action,
                        "allowedCount", allowed.size(),
                        "blockedCount", blocked.size()
                )
        );
        return toDto(saved, true);
    }

    @Transactional
    public void deleteProjectPolicyOverride(OmegaPrincipal principal, UUID projectId) {
        requireAdmin(principal);
        UUID tenantId = principal.tenantId();
        projectRepository.findByIdAndTenantId(projectId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Proyecto no encontrado en el espacio actual"));
        policyRepository.findByTenantIdAndProjectId(tenantId, projectId).ifPresent(entity -> {
            policyRepository.delete(entity);
            auditLogService.record(
                    tenantId,
                    principal.userId(),
                    "DEV_POLICY_OVERRIDE_REMOVED",
                    "DEV_POLICY",
                    entity.getId().toString(),
                    Map.of("projectId", projectId.toString())
            );
        });
    }

    public PolicyEvaluationResult evaluateScan(
            UUID tenantId,
            UUID projectId,
            List<DevFindingEntity> findings,
            List<DevDependencyEntity> dependencies
    ) {
        PolicyDto policy = getEffectivePolicyForProject(tenantId, projectId);
        int thresholdRank = severityRank(policy.failOnSeverity());
        List<String> violations = new ArrayList<>();

        List<String> allowedLower = policy.allowedPackages().stream()
                .map(s -> s.toLowerCase(Locale.ROOT))
                .toList();
        List<String> blockedLower = policy.blockedPackages().stream()
                .map(s -> s.toLowerCase(Locale.ROOT))
                .toList();

        for (DevFindingEntity f : findings) {
            if ("FALSE_POSITIVE".equalsIgnoreCase(f.getTriageStatus())
                    || "ACCEPTED".equalsIgnoreCase(f.getTriageStatus())
                    || "FIXED".equalsIgnoreCase(f.getTriageStatus())) {
                continue;
            }
            if (isAllowedByPackagePolicy(f.getTitle(), f.getLocation(), allowedLower)) {
                continue;
            }
            if (severityRank(f.getSeverity()) >= thresholdRank) {
                violations.add("Hallazgo " + f.getRuleId() + " (" + f.getSeverity() + ") supera umbral " + policy.failOnSeverity());
            }
        }

        for (DevDependencyEntity dep : dependencies) {
            String coord = (dep.getEcosystem() + ":" + dep.getPackageName()).toLowerCase(Locale.ROOT);
            String pkgOnly = dep.getPackageName().toLowerCase(Locale.ROOT);
            if (blockedLower.contains(coord) || blockedLower.contains(pkgOnly)) {
                violations.add("Paquete bloqueado por política: " + dep.getEcosystem() + ":" + dep.getPackageName());
            }
        }

        String status = violations.isEmpty()
                ? "PASS"
                : ("MARK_ONLY".equals(policy.actionOnViolation()) ? "WARN" : "FAIL");
        boolean shouldFailPipeline = !violations.isEmpty() && "FAIL_PIPELINE".equals(policy.actionOnViolation());

        return new PolicyEvaluationResult(
                status,
                policy.failOnSeverity(),
                policy.actionOnViolation(),
                shouldFailPipeline,
                violations
        );
    }

    private static boolean isAllowedByPackagePolicy(String title, String location, List<String> allowedLower) {
        if (allowedLower.isEmpty()) return false;
        String t = title == null ? "" : title.toLowerCase(Locale.ROOT);
        String l = location == null ? "" : location.toLowerCase(Locale.ROOT);
        for (String pkg : allowedLower) {
            if (!pkg.isBlank() && (t.contains(pkg) || l.contains(pkg))) {
                return true;
            }
        }
        return false;
    }

    private static int severityRank(String severity) {
        if (severity == null) return 1;
        return switch (severity.trim().toUpperCase(Locale.ROOT)) {
            case "CRITICAL" -> 4;
            case "HIGH" -> 3;
            case "MEDIUM" -> 2;
            case "LOW" -> 1;
            case "NONE" -> 99;
            default -> 1;
        };
    }

    private PolicyDto toDto(DevPolicyEntity entity, boolean projectOverride) {
        return new PolicyDto(
                entity.getId(),
                entity.getProjectId(),
                projectOverride,
                entity.getFailOnSeverity(),
                entity.getActionOnViolation(),
                readJsonList(entity.getAllowedPackagesJson()),
                readJsonList(entity.getBlockedPackagesJson()),
                entity.getUpdatedAt()
        );
    }

    private List<String> sanitizePackageList(List<String> raw) {
        if (raw == null || raw.isEmpty()) return List.of();
        List<String> out = new ArrayList<>();
        for (String item : raw) {
            String clean = DevProjectService.sanitizeText(item, 160);
            if (!clean.isBlank() && !out.contains(clean)) {
                out.add(clean);
            }
            if (out.size() >= 200) break;
        }
        return out;
    }

    private String writeJsonList(List<String> list) {
        try {
            return objectMapper.writeValueAsString(list == null ? List.of() : list);
        } catch (Exception ex) {
            return "[]";
        }
    }

    private List<String> readJsonList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception ex) {
            return List.of();
        }
    }

    private static String normalizeSeverity(String raw) {
        String s = raw == null ? "HIGH" : raw.trim().toUpperCase(Locale.ROOT);
        if (!VALID_SEVERITIES.contains(s)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Severidad de política inválida: " + raw);
        }
        return s;
    }

    private static String normalizeAction(String raw) {
        String a = raw == null ? "FAIL_PIPELINE" : raw.trim().toUpperCase(Locale.ROOT);
        if (!VALID_ACTIONS.contains(a)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Acción de política inválida: " + raw);
        }
        return a;
    }

    private void requireAdmin(OmegaPrincipal principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un administrador puede modificar las políticas.");
        }
        if (principal.role() == Role.ADMIN) {
            return;
        }
        boolean isIndividualOwner = tenantRepository != null
                && tenantRepository.findByIdAndActiveTrue(principal.tenantId())
                        .map(t -> "INDIVIDUAL".equalsIgnoreCase(t.getAccountType()))
                        .orElse(false);
        if (!isIndividualOwner) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un administrador puede modificar las políticas.");
        }
    }

    public record UpsertPolicyRequest(
            String failOnSeverity,
            String actionOnViolation,
            List<String> allowedPackages,
            List<String> blockedPackages
    ) {}

    public record PolicyDto(
            UUID id,
            UUID projectId,
            boolean projectOverride,
            String failOnSeverity,
            String actionOnViolation,
            List<String> allowedPackages,
            List<String> blockedPackages,
            Instant updatedAt
    ) {}

    public record PolicyEvaluationResult(
            String status,
            String failOnSeverity,
            String actionOnViolation,
            boolean shouldFailPipeline,
            List<String> violations
    ) {}
}
