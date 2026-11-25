package com.omega.platform.integration.forensic;

import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.PersistenceAuditResponse;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeStatus;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.RealtimeToggleRequest;
import com.omega.platform.saas.AlertDispatcherService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.time.Duration;
import java.util.Map;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Cliente especializado para telemetría en vivo del sensor de host (estado,
 * activación/pausa, auditoría de persistencia y sincronización de catálogo IOC).
 */
@Service
public class HostSensorBridge {
    @Autowired(required=false)
    private com.omega.platform.service.AnalysisEvidenceService evidence;

    private final ForensicWorkerTransport transport;
    private final AuditLogService auditLogService;
    private RestClient hostWorkerRestClient;
    private long lastHostCatalogSync;
    private final Set<String> dispatchedCriticalAlertIds = ConcurrentHashMap.newKeySet();

    @Autowired(required = false)
    private AlertDispatcherService alertDispatcherService;

    @Value("${OMEGA_HOST_OWNER_TENANT_ID:}")
    private String hostOwnerTenantId = "";

    @Autowired
    public HostSensorBridge(
            ForensicWorkerTransport transport,
            AuditLogService auditLogService) {
        this.transport = transport;
        this.auditLogService = auditLogService;
    }

    @Autowired(required = false)
    public void setHostWorkerRestClient(@Qualifier("hostWorkerRestClient") RestClient client) {
        this.hostWorkerRestClient = client;
    }

    public RestClient hostClient() {
        return hostWorkerRestClient == null ? transport.workerClient() : hostWorkerRestClient;
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 10000)
    public void refreshHostCatalogInBackground() {
        if (hostOwnerTenantId == null || hostOwnerTenantId.isBlank()) {
            return;
        }
        try {
            if (!"native-host".equals(hostScope())) {
                return;
            }
            syncHostCatalog(UUID.fromString(hostOwnerTenantId));
        } catch (RuntimeException ex) {
            LoggerFactory.getLogger(HostSensorBridge.class)
                    .warn("No se pudo actualizar el catálogo del sensor de equipo: {}", ex.getClass().getSimpleName());
        }
    }

    private String hostScope() {
        try {
            Map<?, ?> health = hostClient().get().uri("/api/health").retrieve().body(Map.class);
            return health != null && health.get("scope") instanceof String scope ? scope : "unavailable";
        } catch (RestClientException ex) {
            throw new ForensicWorkerException("No se pudo comprobar la conexión con el sensor de esta computadora.", ex);
        }
    }

    private void requireNativeHost() {
        if (!"native-host".equals(hostScope())) {
            throw new ForensicWorkerException("Esta operación requiere conectar un sensor nativo de la computadora.", null);
        }
    }

    private synchronized void syncHostCatalog(UUID tenantId) {
        StixCatalogService stix = transport.stixCatalogService();
        if (stix == null || (lastHostCatalogSync != 0 && System.nanoTime() - lastHostCatalogSync < Duration.ofSeconds(60).toNanos())) {
            return;
        }
        try {
            hostClient().post().uri("/api/host/iocs/sync")
                    .header("X-Host-Tenant", tenantId.toString())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("indicators", stix.hostIndicators()))
                    .retrieve()
                    .toBodilessEntity();
            lastHostCatalogSync = System.nanoTime();
        } catch (RestClientException ex) {
            throw ForensicWorkerTransport.translateWorkerException(ex, "sincronización del catálogo del sensor", false);
        }
    }

    public RealtimeStatus hostRealtimeStatus(OmegaPrincipal principal) {
        String scope = hostScope();
        if (!"native-host".equals(scope)) {
            return new RealtimeStatus(false, false, false, "unavailable", scope, null, null, 0,
                    null, 0, false, null, null, null, "unavailable", List.of(), 0,
                    Map.of("blocking", false, "eventBasedCapture", false),
                    "No hay un sensor nativo conectado a esta computadora. El worker de Docker analiza los archivos enviados, pero no vigila el equipo.");
        }
        syncHostCatalog(principal.tenantId());
        try {
            RealtimeStatus status = hostClient().get().uri("/api/host/realtime/status")
                    .header("X-Host-Tenant", principal.tenantId().toString())
                    .retrieve()
                    .body(RealtimeStatus.class);
            if (status != null && status.alerts() != null && alertDispatcherService != null) {
                for (Map<String, Object> alert : status.alerts()) {
                    String severity = String.valueOf(alert.getOrDefault("severity", ""));
                    String alertId = String.valueOf(alert.getOrDefault("id", ""));
                    if ("CRITICAL".equalsIgnoreCase(severity) && !alertId.isBlank()) {
                        if (dispatchedCriticalAlertIds.size() > 512) {
                            dispatchedCriticalAlertIds.clear();
                        }
                        if (dispatchedCriticalAlertIds.add(alertId)) {
                            try {
                                alertDispatcherService.dispatchCriticalAlert(
                                        principal.tenantId(),
                                        principal.userId(),
                                        "CRITICAL",
                                        String.valueOf(alert.getOrDefault("userFriendlyTitle", "Alerta crítica del sensor de host")),
                                        String.valueOf(alert.getOrDefault("detail", "")),
                                        "");
                            } catch (RuntimeException ignored) {
                                // El despacho externo no interrumpe la lectura del sensor
                            }
                        }
                    }
                }
            }
            return status;
        } catch (RestClientException ex) {
            throw ForensicWorkerTransport.translateWorkerException(ex, "estado del sensor de equipo", false);
        }
    }

    public RealtimeStatus toggleHostRealtime(OmegaPrincipal principal, boolean enabled) {
        requireNativeHost();
        syncHostCatalog(principal.tenantId());
        try {
            RealtimeStatus response = hostClient().post().uri("/api/host/realtime/toggle")
                    .header("X-Host-Tenant", principal.tenantId().toString())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new RealtimeToggleRequest(enabled))
                    .retrieve()
                    .body(RealtimeStatus.class);
            auditLogService.record(
                    principal.tenantId(),
                    principal.userId(),
                    "HOST_WATCH_TOGGLED",
                    "HOST_SENSOR",
                    "native-host",
                    Map.of("enabled", enabled));
            return response;
        } catch (RestClientException ex) {
            throw ForensicWorkerTransport.translateWorkerException(ex, "activar/pausar sensor de equipo", false);
        }
    }

    public PersistenceAuditResponse auditHostPersistence(OmegaPrincipal principal) {
        requireNativeHost();
        syncHostCatalog(principal.tenantId());
        try {
            PersistenceAuditResponse response = hostClient().post().uri("/api/host/persistence/audit")
                    .header("X-Host-Tenant", principal.tenantId().toString())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of())
                    .retrieve()
                    .body(PersistenceAuditResponse.class);
            if (response == null) {
                throw new ForensicWorkerException("Respuesta vacía de persistencia", null);
            }
            auditLogService.record(
                    principal.tenantId(),
                    principal.userId(),
                    "HOST_PERSISTENCE_AUDITED",
                    "HOST_SENSOR",
                    response.hostname(),
                    Map.of(
                            "findingCount", response.findings().size(),
                            "complete", response.complete(),
                            "scope", response.scope()));
            if(evidence!=null) evidence.record(principal,null,"HOST_PERSISTENCE",response);
            return response;
        } catch (RestClientException ex) {
            throw ForensicWorkerTransport.translateWorkerException(ex, "auditoría de persistencia", false);
        }
    }
}
