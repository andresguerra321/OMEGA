package com.omega.platform.service;

import com.omega.platform.security.OmegaPrincipal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Auditoría de postura de la estación de trabajo del desarrollador (Bloque DJ).
 * Opera exclusivamente bajo consentimiento explícito y en solo lectura de metadatos (existencia y nombres de variable),
 * sin abrir ni leer jamás el contenido de llaves privadas, archivos .npmrc/.pypirc/.env ni valores de variables de entorno.
 */
@Service
public class DevWorkstationService {

    private static final Set<String> SENSITIVE_ENV_VAR_NAMES = Set.of(
            "GITHUB_TOKEN",
            "GH_TOKEN",
            "NPM_TOKEN",
            "PYPI_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "OMEGA_API_TOKEN"
    );

    private final AuditLogService auditLogService;

    public DevWorkstationService(AuditLogService auditLogService) {
        this.auditLogService = auditLogService;
    }

    @Transactional
    public WorkstationAuditResponse runReadOnlyPostureAudit(
            OmegaPrincipal principal,
            WorkstationAuditRequest request
    ) {
        if (request == null || !Boolean.TRUE.equals(request.consentConfirmed())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Se requiere consentimiento explícito para auditar la postura de la estación de trabajo."
            );
        }

        boolean sshWorldReadable = Boolean.TRUE.equals(request.sshKeyPermissiveAcl());
        boolean plainPkgCreds = Boolean.TRUE.equals(request.plaintextPackageManagerRc());
        boolean gitPlainStore = Boolean.TRUE.equals(request.gitCredentialHelperPlaintext());
        List<String> exposedEnvNames = sanitizeEnvNames(request.exposedSensitiveEnvNames());

        if (request.inspectLocalHostMetadata() != null && request.inspectLocalHostMetadata()) {
            String userHome = System.getProperty("user.home", "");
            if (!userHome.isBlank()) {
                Path home = Path.of(userHome);
                plainPkgCreds = plainPkgCreds
                        || Files.exists(home.resolve(".git-credentials"))
                        || Files.exists(home.resolve(".npmrc"))
                        || Files.exists(home.resolve(".pypirc"));
            }
            for (String envName : SENSITIVE_ENV_VAR_NAMES) {
                if (System.getenv(envName) != null && !exposedEnvNames.contains(envName)) {
                    exposedEnvNames.add(envName);
                }
            }
        }

        List<WorkstationControlDto> controls = new ArrayList<>(4);

        controls.add(new WorkstationControlDto(
                "DEV-WS-01",
                "Permisos de llaves privadas SSH (~/.ssh/id_*)",
                sshWorldReadable ? "WARN" : "PASS",
                sshWorldReadable ? "HIGH" : "LOW",
                "~/.ssh/",
                sshWorldReadable
                        ? "Se detectaron permisos amplios en metadatos de ~/.ssh/. Restringe las ACLs al propietario (chmod 600 / icacls /inheritance:r)."
                        : "Sin permisos excesivos detectados en metadatos de ~/.ssh/.",
                "Revoca llaves expuestas, aplica permisos 600 y habilita ssh-agent con confirmación por uso."
        ));

        controls.add(new WorkstationControlDto(
                "DEV-WS-02",
                "Credenciales de gestores de paquetes en disco (~/.npmrc, ~/.pypirc, ~/.git-credentials)",
                plainPkgCreds ? "WARN" : "PASS",
                plainPkgCreds ? "MEDIUM" : "LOW",
                "~/.npmrc | ~/.pypirc | ~/.git-credentials",
                plainPkgCreds
                        ? "Se detectó presencia de archivo de configuración de credenciales en el directorio raíz del usuario."
                        : "No se detectaron archivos ~/.git-credentials, ~/.npmrc ni ~/.pypirc en disco.",
                "Migra tokens de publicación a OIDC Trusted Publishers en CI y usa tokens efímeros con alcance mínimo."
        ));

        controls.add(new WorkstationControlDto(
                "DEV-WS-03",
                "Almacén de credenciales y hooks globales de Git",
                gitPlainStore ? "WARN" : "PASS",
                gitPlainStore ? "HIGH" : "LOW",
                "~/.gitconfig",
                gitPlainStore
                        ? "El helper de credenciales de Git está configurado en modo texto plano (credential.helper=store)."
                        : "Configuración de credential.helper delegada al llavero cifrado del sistema operativo.",
                "Configura git config --global credential.helper manager (Windows) o osxkeychain / libsecret."
        ));

        boolean hasEnvExposure = !exposedEnvNames.isEmpty();
        controls.add(new WorkstationControlDto(
                "DEV-WS-04",
                "Variables de entorno globales con nombres de tokens de producción",
                hasEnvExposure ? "WARN" : "PASS",
                hasEnvExposure ? "MEDIUM" : "LOW",
                "ENV:" + (hasEnvExposure ? String.join(",", exposedEnvNames) : "CLEAN"),
                hasEnvExposure
                        ? "Variables sensibles presentes en el entorno global de procesos: " + String.join(", ", exposedEnvNames) + " (valores no leídos)."
                        : "Ninguna variable de entorno de token de producción expuesta globalmente.",
                "Evita exportar tokens permanentes en perfiles de shell (.bashrc / perfil de sistema); inéctalos solo por sesión o vía gestor de secretos."
        ));

        int warningsCount = (int) controls.stream().filter(c -> "WARN".equals(c.status())).count();
        String overallStatus = warningsCount == 0 ? "PASS" : "WARN";

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "DEV_WORKSTATION_AUDITED",
                "DEV_WORKSTATION",
                principal.userId().toString(),
                Map.of(
                        "controlsEvaluated", controls.size(),
                        "warningsCount", warningsCount,
                        "consentConfirmed", true,
                        "readOnlyMetadataOnly", true
                )
        );

        return new WorkstationAuditResponse(
                overallStatus,
                Instant.now(),
                controls.size(),
                warningsCount,
                controls,
                "Auditoría local en solo lectura: OMEGA comprueba únicamente metadatos de permisos y nombres de variables bajo tu consentimiento, sin leer jamás valores de secretos ni llaves."
        );
    }

    private static List<String> sanitizeEnvNames(List<String> raw) {
        List<String> out = new ArrayList<>();
        if (raw == null) return out;
        for (String name : raw) {
            if (name == null) continue;
            String clean = name.trim().toUpperCase().replaceAll("[^A-Z0-9_]", "");
            if (!clean.isBlank() && SENSITIVE_ENV_VAR_NAMES.contains(clean) && !out.contains(clean)) {
                out.add(clean);
            }
        }
        return out;
    }

    public record WorkstationAuditRequest(
            Boolean consentConfirmed,
            Boolean inspectLocalHostMetadata,
            Boolean sshKeyPermissiveAcl,
            Boolean plaintextPackageManagerRc,
            Boolean gitCredentialHelperPlaintext,
            List<String> exposedSensitiveEnvNames
    ) {}

    public record WorkstationControlDto(
            String controlId,
            String title,
            String status,
            String severity,
            String normalizedTarget,
            String summary,
            String remediation
    ) {}

    public record WorkstationAuditResponse(
            String overallStatus,
            Instant auditedAt,
            int controlsEvaluated,
            int warningsCount,
            List<WorkstationControlDto> controls,
            String zeroRetentionNotice
    ) {}
}
