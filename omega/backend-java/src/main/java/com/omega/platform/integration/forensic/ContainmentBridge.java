package com.omega.platform.integration.forensic;

import com.omega.platform.config.SovereignModePolicy;
import com.omega.platform.saas.AlertDispatcherService;
import com.omega.platform.security.ContainmentAuthorizationService;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;

/**
 * Cliente especializado para acciones de contención reversible en el host
 * (challenge MFA/contraseña, ejecución, rollback y consulta de historial).
 */
@Service
public class ContainmentBridge {

    private final HostSensorBridge hostSensorBridge;
    private final ExpedienteAuthorizationService authorizationService;
    private final AuditLogService auditLogService;
    private ContainmentAuthorizationService containmentAuthorization;

    @Autowired(required = false)
    private SovereignModePolicy sovereignPolicy;

    @Autowired(required = false)
    private AlertDispatcherService alertDispatcherService;

    @Autowired
    public ContainmentBridge(
            HostSensorBridge hostSensorBridge,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService) {
        this.hostSensorBridge = hostSensorBridge;
        this.authorizationService = authorizationService;
        this.auditLogService = auditLogService;
    }

    @Autowired(required = false)
    public void setContainmentAuthorization(ContainmentAuthorizationService authorization) {
        this.containmentAuthorization = authorization;
    }

    public Map<String, Object> containmentChallenge(OmegaPrincipal principal, String password) {
        if (containmentAuthorization == null) {
            throw new AccessDeniedException("Verificación sensible no configurada");
        }
        return containmentAuthorization.challenge(principal, password);
    }

    public Map<String, Object> executeContainment(
            OmegaPrincipal principal,
            ForensicWorkerContracts.ContainmentRequest request) {
        if (request.expedienteId() != null) {
            authorizationService.requireWriteAccess(principal, request.expedienteId());
        }
        if (sovereignPolicy != null && sovereignPolicy.enabled() && "BLOCK_NETWORK_INDICATOR".equals(request.actionType())) {
            String indicator = String.valueOf(request.target().getOrDefault("indicator", ""));
            if (!indicator.matches("[0-9a-fA-F:.]+")) {
                throw new IllegalArgumentException(
                        "En modo local, selecciona una IP ya medida: no se resolverán dominios por DNS externo.");
            }
        }
        if (!request.dryRun()) {
            if (containmentAuthorization == null) {
                throw new AccessDeniedException("Verificación sensible no configurada");
            }
            containmentAuthorization.authorize(
                    principal,
                    request.currentPassword(),
                    request.challengeToken(),
                    request.code());
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("actionType", request.actionType());
        payload.put("target", request.target());
        payload.put("dryRun", request.dryRun());
        payload.put("previewToken", request.previewToken());
        Map<String, Object> result = containmentOperation(
                principal,
                "/api/containment/execute",
                payload,
                request.actionType(),
                String.valueOf(request.target().getOrDefault("sha256", "")),
                request.dryRun(),
                request.expedienteId());
        if (!request.dryRun() && alertDispatcherService != null && principal != null) {
            try {
                alertDispatcherService.dispatchCriticalAlert(
                        principal.tenantId(),
                        principal.userId(),
                        "CRITICAL",
                        "Contención ejecutada en host: " + request.actionType(),
                        "Acción de aislamiento aplicada sobre objetivo: " + request.target(),
                        "");
            } catch (RuntimeException ignored) {
                // El despacho fuera de banda nunca debe revertir la contención ya aplicada
            }
        }
        return result;
    }

    public Map<String, Object> rollbackContainment(
            OmegaPrincipal principal,
            String actionId,
            ForensicWorkerContracts.ContainmentCredentials credentials) {
        UUID.fromString(actionId);
        if (credentials.expedienteId() != null) {
            authorizationService.requireWriteAccess(principal, credentials.expedienteId());
        }
        if (containmentAuthorization == null) {
            throw new AccessDeniedException("Verificación sensible no configurada");
        }
        containmentAuthorization.authorize(
                principal,
                credentials.currentPassword(),
                credentials.challengeToken(),
                credentials.code());
        return containmentOperation(
                principal,
                "/api/containment/rollback/" + actionId,
                Map.of(),
                "ROLLBACK",
                "",
                false,
                credentials.expedienteId());
    }

    public Map<String, Object> containmentHistory(OmegaPrincipal principal) {
        try {
            return hostSensorBridge.hostClient().get()
                    .uri("/api/containment/history")
                    .header("X-Host-Tenant", principal.tenantId().toString())
                    .retrieve()
                    .body(ForensicWorkerTransport.MAP_TYPE);
        } catch (RestClientException ex) {
            throw ForensicWorkerTransport.translateWorkerException(ex, "historial de contención", false);
        }
    }

    private Map<String, Object> containmentOperation(
            OmegaPrincipal principal,
            String uri,
            Map<String, Object> payload,
            String actionType,
            String targetHash,
            boolean dryRun,
            UUID expedienteId) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("actionType", actionType);
        meta.put("targetHash", targetHash);
        meta.put("dryRun", dryRun);
        if (expedienteId != null) {
            meta.put("expedienteId", expedienteId.toString());
            meta.put("caseAssociationSource", "USER_SELECTED_CASE");
        }
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "CONTAINMENT_REQUESTED",
                "HOST_CONTAINMENT",
                "pending",
                meta);
        try {
            Map<String, Object> result = hostSensorBridge.hostClient().post()
                    .uri(uri)
                    .header("X-Host-Tenant", principal.tenantId().toString())
                    .header("X-Host-Actor", principal.userId().toString())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .body(ForensicWorkerTransport.MAP_TYPE);
            if (result == null) {
                throw new ForensicWorkerException("Respuesta de contención vacía", null);
            }
            meta.put("actionId", result.getOrDefault("actionId", "unknown"));
            if (result.get("target") instanceof Map<?, ?> measured) {
                if (measured.get("sha256") instanceof String sha && !sha.isBlank()) {
                    meta.put("targetHash", sha);
                    meta.put("targetHashKind", "FILE_SHA256");
                } else {
                    try {
                        meta.put("targetHash", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                                .digest(String.valueOf(measured).getBytes(StandardCharsets.UTF_8))));
                        meta.put("targetHashKind", "TARGET_DESCRIPTION_SHA256");
                    } catch (NoSuchAlgorithmException impossible) {
                        throw new IllegalStateException("SHA-256 no disponible", impossible);
                    }
                }
            }
            meta.put("result", result.getOrDefault("status", "UNKNOWN"));
            auditLogService.record(
                    principal.tenantId(),
                    principal.userId(),
                    "ROLLBACK".equals(actionType) ? "CONTAINMENT_ROLLBACK" : "CONTAINMENT_RESULT",
                    "HOST_CONTAINMENT",
                    String.valueOf(meta.get("actionId")),
                    meta);
            return result;
        } catch (RestClientException ex) {
            meta.put("result", "WORKER_ERROR_CHECK_HISTORY");
            auditLogService.record(
                    principal.tenantId(),
                    principal.userId(),
                    "CONTAINMENT_ERROR",
                    "HOST_CONTAINMENT",
                    "unknown",
                    meta);
            throw ForensicWorkerTransport.translateWorkerException(
                    ex,
                    "contención del equipo; consulta el historial para confirmar el estado",
                    false);
        }
    }
}
