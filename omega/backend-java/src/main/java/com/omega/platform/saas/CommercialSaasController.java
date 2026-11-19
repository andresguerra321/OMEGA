package com.omega.platform.saas;

import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/saas")
public class CommercialSaasController {

    public record HeartbeatRequest(
            @NotBlank String deviceUid,
            String hostname,
            String osPlatform,
            String sensorVersion) {}

    public record PlanUpdateRequest(@NotBlank String planCode) {}

    public record AlertDispatchRequest(
            String severity,
            @NotBlank String title,
            String message,
            String webhookUrl) {}

    private final CommercialSaasService saasService;
    private final AlertDispatcherService alertDispatcherService;

    public CommercialSaasController(
            CommercialSaasService saasService,
            AlertDispatcherService alertDispatcherService) {
        this.saasService = saasService;
        this.alertDispatcherService = alertDispatcherService;
    }

    @GetMapping("/summary")
    public Map<String, Object> summary(@AuthenticationPrincipal OmegaPrincipal principal) {
        return saasService.getSaasSummary(principal.tenantId(), principal.userId());
    }

    @PostMapping("/devices/heartbeat")
    public Map<String, Object> heartbeat(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody HeartbeatRequest request) {
        try {
            DeviceEntity device = saasService.registerOrHeartbeatDevice(
                    principal.tenantId(),
                    principal.userId(),
                    request.deviceUid(),
                    request.hostname(),
                    request.osPlatform(),
                    request.sensorVersion());
            return Map.of(
                    "id", device.getId().toString(),
                    "deviceUid", device.getDeviceUid(),
                    "hostname", device.getHostname(),
                    "status", device.getStatus(),
                    "lastHeartbeatAt", device.getLastHeartbeatAt().toString());
        } catch (IllegalStateException ex) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, ex.getMessage(), ex);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage(), ex);
        }
    }

    @PostMapping("/devices/{deviceId}/revoke")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> revokeDevice(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @PathVariable UUID deviceId) {
        try {
            DeviceEntity device = saasService.revokeDevice(principal.tenantId(), deviceId);
            return Map.of(
                    "id", device.getId().toString(),
                    "status", device.getStatus(),
                    "revokedAt", device.getRevokedAt().toString());
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, ex.getMessage(), ex);
        }
    }

    @PutMapping("/subscription")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updatePlan(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody PlanUpdateRequest request) {
        try {
            SubscriptionEntity sub = saasService.updateSubscriptionPlan(principal.tenantId(), request.planCode());
            return Map.of(
                    "planCode", sub.getPlanCode(),
                    "status", sub.getStatus(),
                    "maxDevices", sub.getMaxDevices(),
                    "monthlyAiQuota", sub.getMonthlyAiQuota());
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage(), ex);
        }
    }

    @PostMapping("/alerts/dispatch")
    @PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")
    public Map<String, Object> dispatchAlert(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody AlertDispatchRequest request) {
        List<AlertDispatcherService.DispatchResult> results = alertDispatcherService.dispatchCriticalAlert(
                principal.tenantId(),
                principal.userId(),
                request.severity(),
                request.title(),
                request.message(),
                request.webhookUrl());
        return Map.of("results", results);
    }
}
