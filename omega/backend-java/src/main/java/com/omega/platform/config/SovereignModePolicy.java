package com.omega.platform.config;

import com.omega.platform.ai.ollama.OllamaConfiguration;
import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.util.Set;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Application-level egress policy; host firewalls must enforce physical air-gapping. */
@Component
public class SovereignModePolicy {
    private final OmegaProperties properties;
    private final Environment environment;
    private static final Set<String> LOCAL_WORKER_ROUTES = Set.of("/api/health", "/api/ioc/verify/file", "/api/ioc/verify/text",
            "/api/triage/parallel", "/api/triage/ios-manifest-targets", "/api/triage/ios-manifest-decrypt",
            "/api/triage/device-live", "/api/triage/pc-live", "/api/yara", "/api/host/realtime/status",
            "/api/host/realtime/toggle", "/api/host/iocs/sync", "/api/host/persistence/audit", "/api/containment/execute",
            "/api/containment/history", "/api/mobile/usb/devices", "/api/mobile/usb/audit");

    public SovereignModePolicy(OmegaProperties properties, Environment environment) {
        this.properties = properties;
        this.environment = environment;
    }

    public boolean enabled() { return properties.ai().local(); }

    @PostConstruct
    public void validateLocalServices() {
        if (!enabled()) return;
        OllamaConfiguration.requireLocalEndpoint(properties.ai().ollama().baseUrl(), "ollama");
        OllamaConfiguration.requireLocalEndpoint(properties.forensicWorker().baseUrl(), "forensic-worker");
        OllamaConfiguration.requireLocalEndpoint(environment.getProperty("OMEGA_HOST_WORKER_URL", properties.forensicWorker().baseUrl()), "forensic-worker");
        String jdbc = environment.getProperty("spring.datasource.url", "jdbc:postgresql://localhost:5432/omega_cti");
        if (!jdbc.startsWith("jdbc:postgresql://")) throw new IllegalStateException("El modo soberano requiere PostgreSQL local explícito.");
        URI database = URI.create(jdbc.substring(5));
        if (database.getHost() == null || !Set.of("localhost", "127.0.0.1", "[::1]", "::1", "db", "postgres").contains(database.getHost())) {
            throw new IllegalStateException("El modo soberano no permite una base de datos remota.");
        }
        String smtp = environment.getProperty("spring.mail.host", "");
        if (!smtp.isBlank() && !Set.of("localhost", "127.0.0.1", "::1", "mailpit").contains(smtp)) {
            throw new IllegalStateException("El modo soberano requiere desactivar SMTP externo o usar un servidor local sin reenvío.");
        }
        String storageProvider = environment.getProperty("omega.storage.provider", "noop");
        if ("minio".equalsIgnoreCase(storageProvider)) {
            requireLocalStorageEndpoint(environment.getProperty("omega.storage.minio.endpoint", "http://localhost:9000"));
        }
    }

    public void requireLocalStorageEndpoint(String endpoint) {
        if (!enabled()) return;
        if (endpoint == null || endpoint.isBlank()) {
            throw new IllegalStateException("El modo soberano requiere un endpoint MinIO local explícito.");
        }
        URI uri;
        try {
            uri = URI.create(endpoint.trim());
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("Endpoint de almacenamiento inválido en modo soberano.", ex);
        }
        String host = uri.getHost();
        if (host == null || !Set.of("localhost", "127.0.0.1", "[::1]", "::1", "minio").contains(host.toLowerCase())) {
            throw new IllegalStateException("El modo soberano prohíbe endpoints de almacenamiento S3/MinIO externos.");
        }
    }

    public void requireExternalAccess() {
        if (enabled()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Consulta externa deshabilitada en Modo Soberano Local. No se ha enviado el objetivo.");
    }

    public void checkWorkerRequest(URI uri) {
        if (!enabled()) return;
        String path = uri.getPath();
        if (!LOCAL_WORKER_ROUTES.contains(path) && !path.matches("/api/(containment/rollback|mobile/usb/audit)/[a-fA-F0-9-]+")
                && !path.matches("/api/(campaigns|yara)/[a-fA-F0-9-]+(/(yara|mvt-script))?")) {
            requireExternalAccess();
        }
    }
}
