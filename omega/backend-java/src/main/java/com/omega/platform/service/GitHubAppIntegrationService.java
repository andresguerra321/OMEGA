package com.omega.platform.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.GitHubAppInstallationEntity;
import com.omega.platform.domain.GitHubOAuthStateEntity;
import com.omega.platform.repository.GitHubAppInstallationRepository;
import com.omega.platform.repository.GitHubOAuthStateRepository;
import com.omega.platform.repository.GitHubWebhookDeliveryRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class GitHubAppIntegrationService {

    private static final Logger log = LoggerFactory.getLogger(GitHubAppIntegrationService.class);
    public static final int MAX_WEBHOOK_BYTES = 1_048_576; // 1 MiB
    private static final int DELIVERY_TTL_HOURS = 48;

    private final GitHubAppInstallationRepository installationRepository;
    private final GitHubOAuthStateRepository stateRepository;
    private final GitHubWebhookDeliveryRepository deliveryRepository;
    private final GitHubApiClient gitHubApiClient;
    private final AuditLogService auditLogService;
    private final ObjectMapper objectMapper;
    private final String webhookSecret;
    private final SecureRandom secureRandom = new SecureRandom();

    @Autowired(required = false)
    private GitHubPullRequestScannerService prScannerService;

    public GitHubAppIntegrationService(
            GitHubAppInstallationRepository installationRepository,
            GitHubOAuthStateRepository stateRepository,
            GitHubWebhookDeliveryRepository deliveryRepository,
            GitHubApiClient gitHubApiClient,
            AuditLogService auditLogService,
            ObjectMapper objectMapper,
            @Value("${OMEGA_GITHUB_WEBHOOK_SECRET:}") String webhookSecret
    ) {
        this.installationRepository = installationRepository;
        this.stateRepository = stateRepository;
        this.deliveryRepository = deliveryRepository;
        this.gitHubApiClient = gitHubApiClient;
        this.auditLogService = auditLogService;
        this.objectMapper = objectMapper;
        this.webhookSecret = webhookSecret != null ? webhookSecret : "";
    }

    @Transactional
    public LinkStateResponse createLinkState(UUID tenantId, UUID userId) {
        byte[] buf = new byte[32];
        secureRandom.nextBytes(buf);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
        Instant now = Instant.now();
        Instant expiresAt = now.plus(10, ChronoUnit.MINUTES);
        stateRepository.save(new GitHubOAuthStateEntity(token, tenantId, userId, expiresAt, now));
        return new LinkStateResponse(token, expiresAt);
    }

    @Transactional
    public InstallationView completeInstallationLink(
            UUID tenantId,
            UUID userId,
            String stateToken,
            long installationId,
            String userAccessToken,
            String accountLogin
    ) {
        if (stateToken == null || stateToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El parámetro state es obligatorio");
        }
        GitHubOAuthStateEntity state = stateRepository
                .findByStateTokenAndTenantIdAndUserId(stateToken.trim(), tenantId, userId)
                .orElseThrow(() -> new AccessDeniedException("State inválido o no pertenece a tu sesión/tenant"));

        Instant now = Instant.now();
        if (state.getUsedAt() != null || !state.getExpiresAt().isAfter(now)) {
            throw new AccessDeniedException("El state ya fue utilizado o expiró");
        }
        state.setUsedAt(now);
        stateRepository.save(state);

        if (!gitHubApiClient.userHasInstallationAccess(userAccessToken, installationId)) {
            throw new AccessDeniedException("El usuario autenticado no tiene acceso a esta instalación de GitHub App");
        }

        Optional<GitHubAppInstallationEntity> existingByInstall = installationRepository.findByInstallationId(installationId);
        if (existingByInstall.isPresent() && !existingByInstall.get().getTenantId().equals(tenantId)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Esta instalación de GitHub App ya está vinculada a otro espacio de trabajo");
        }

        GitHubAppInstallationEntity entity = installationRepository.findByTenantId(tenantId)
                .orElseGet(() -> new GitHubAppInstallationEntity(
                        UUID.randomUUID(), tenantId, installationId, accountLogin, "[]", userId, now));
        if (entity.getInstallationId() != installationId) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El tenant ya tiene otra instalación vinculada; desvincúlala primero");
        }
        entity.setAccountLogin(accountLogin);
        entity.setSuspendedAt(null);
        entity.setUpdatedAt(now);
        installationRepository.save(entity);

        auditLogService.record(
                tenantId,
                userId,
                "GITHUB_INSTALLATION_LINKED",
                "GITHUB_INSTALLATION",
                String.valueOf(installationId),
                Map.of("accountLogin", entity.getAccountLogin())
        );

        return toView(entity);
    }

    @Transactional(readOnly = true)
    public Optional<InstallationView> getInstallationStatus(UUID tenantId) {
        return installationRepository.findByTenantId(tenantId).map(this::toView);
    }

    @Transactional
    public void unlinkInstallation(UUID tenantId, UUID userId) {
        GitHubAppInstallationEntity entity = installationRepository.findByTenantId(tenantId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No hay instalación vinculada"));
        long installId = entity.getInstallationId();
        installationRepository.delete(entity);
        auditLogService.record(
                tenantId,
                userId,
                "GITHUB_INSTALLATION_UNLINKED",
                "GITHUB_INSTALLATION",
                String.valueOf(installId),
                Map.of()
        );
    }

    public boolean acceptWebhookAsync(
            byte[] rawBody,
            String signatureHeader,
            String deliveryId,
            String eventType
    ) {
        if (rawBody == null || rawBody.length == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cuerpo de webhook vacío");
        }
        if (rawBody.length > MAX_WEBHOOK_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "El webhook supera el límite de 1 MiB");
        }
        if (webhookSecret.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Webhook secret no configurado");
        }
        if (!verifyHmacSha256(rawBody, signatureHeader, webhookSecret)) {
            throw new AccessDeniedException("Firma X-Hub-Signature-256 inválida");
        }
        if (deliveryId == null || deliveryId.isBlank() || deliveryId.length() > 128) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Falta cabecera X-GitHub-Delivery válida");
        }
        final String safeEvent = eventType != null ? eventType.trim() : "";
        if (!deliveryRepository.tryRecordDelivery(deliveryId.trim(), DELIVERY_TTL_HOURS, safeEvent, rawBody)) {
            return false;
        }

        final String safeDeliveryId = deliveryId.trim();
        CompletableFuture.runAsync(() -> {
            try {
                processWebhookPayload(rawBody, safeEvent);
                deliveryRepository.markProcessed(safeDeliveryId);
            } catch (Exception ex) {
                deliveryRepository.markFailed(safeDeliveryId);
                log.error("Alerta webhook GitHub FAILED ({} / {}): {}", safeDeliveryId, safeEvent, ex.getClass().getSimpleName());
            }
        });
        return true;
    }

    /**
     * Reconciliación periódica: GitHub no reintenta entregas fallidas automáticamente,
     * por lo que OMEGA reintenta eventos en estado FAILED y emite alerta si vuelven a fallar.
     */
    @Scheduled(fixedDelay = 60_000)
    public void reconcileFailedDeliveries() {
        List<GitHubWebhookDeliveryRepository.FailedDeliveryRecord> pending =
                deliveryRepository.findRetryableFailedDeliveries(3, 20);
        for (GitHubWebhookDeliveryRepository.FailedDeliveryRecord rec : pending) {
            if (!deliveryRepository.tryRecordDelivery(rec.deliveryId(), DELIVERY_TTL_HOURS)) {
                continue;
            }
            try {
                byte[] bytes = rec.payloadJson().getBytes(StandardCharsets.UTF_8);
                processWebhookPayload(bytes, rec.eventType() != null ? rec.eventType() : "");
                deliveryRepository.markProcessed(rec.deliveryId());
            } catch (Exception ex) {
                deliveryRepository.markFailed(rec.deliveryId());
                log.error("ALERTA reconciliación webhook GitHub FAILED (delivery={}, retry={}): {}",
                        rec.deliveryId(), rec.retryCount() + 1, ex.getClass().getSimpleName());
            }
        }
    }

    @Transactional
    public void processWebhookPayload(byte[] rawBody, String eventType) {
        try {
            Map<String, Object> payload = objectMapper.readValue(rawBody, new TypeReference<>() {});
            String action = String.valueOf(payload.getOrDefault("action", ""));
            Object installObj = payload.get("installation");
            if (!(installObj instanceof Map<?, ?> installMap) || !(installMap.get("id") instanceof Number numId)) {
                return;
            }
            long installationId = numId.longValue();

            if ("installation".equals(eventType)) {
                handleInstallationEvent(installationId, action);
            } else if ("installation_repositories".equals(eventType)) {
                handleInstallationRepositoriesEvent(installationId, payload);
            } else if ("pull_request".equals(eventType) && prScannerService != null) {
                prScannerService.submitPullRequestWebhook(installationId, payload);
            }
        } catch (Exception ex) {
            log.warn("Error procesando webhook GitHub ({}): {}", eventType, ex.getClass().getSimpleName());
            throw new IllegalStateException("Fallo procesando payload de webhook GitHub", ex);
        }
    }

    private void handleInstallationEvent(long installationId, String action) {
        Optional<GitHubAppInstallationEntity> found = installationRepository.findByInstallationId(installationId);
        if (found.isEmpty()) {
            return;
        }
        GitHubAppInstallationEntity entity = found.get();
        Instant now = Instant.now();
        if ("deleted".equals(action)) {
            installationRepository.delete(entity);
            auditLogService.record(
                    entity.getTenantId(),
                    entity.getCreatedByUserId(),
                    "GITHUB_INSTALLATION_DELETED_WEBHOOK",
                    "GITHUB_INSTALLATION",
                    String.valueOf(installationId),
                    Map.of()
            );
        } else if ("suspend".equals(action)) {
            entity.setSuspendedAt(now);
            entity.setUpdatedAt(now);
            installationRepository.save(entity);
        } else if ("unsuspend".equals(action)) {
            entity.setSuspendedAt(null);
            entity.setUpdatedAt(now);
            installationRepository.save(entity);
        }
    }

    private void handleInstallationRepositoriesEvent(long installationId, Map<String, Object> payload) {
        Optional<GitHubAppInstallationEntity> found = installationRepository.findByInstallationId(installationId);
        if (found.isEmpty()) {
            return;
        }
        GitHubAppInstallationEntity entity = found.get();
        Set<String> repos = new LinkedHashSet<>(parseRepos(entity.getSelectedReposJson()));

        if (payload.get("repositories_added") instanceof List<?> added) {
            for (Object item : added) {
                if (item instanceof Map<?, ?> m && m.get("full_name") instanceof String fn) {
                    repos.add(fn);
                }
            }
        }
        if (payload.get("repositories_removed") instanceof List<?> removed) {
            for (Object item : removed) {
                if (item instanceof Map<?, ?> m && m.get("full_name") instanceof String fn) {
                    repos.remove(fn);
                }
            }
        }
        try {
            entity.setSelectedReposJson(objectMapper.writeValueAsString(new ArrayList<>(repos)));
            entity.setUpdatedAt(Instant.now());
            installationRepository.save(entity);
        } catch (Exception ignored) {
            // keep existing list
        }
    }

    public static boolean verifyHmacSha256(byte[] rawBody, String signatureHeader, String secret) {
        if (rawBody == null || signatureHeader == null || !signatureHeader.startsWith("sha256=")) {
            return false;
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expected = mac.doFinal(rawBody);
            byte[] provided = HexFormat.of().parseHex(signatureHeader.substring("sha256=".length()).trim());
            return MessageDigest.isEqual(expected, provided);
        } catch (Exception ex) {
            return false;
        }
    }

    private List<String> parseRepos(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception ex) {
            return List.of();
        }
    }

    private InstallationView toView(GitHubAppInstallationEntity e) {
        return new InstallationView(
                e.getId(),
                e.getInstallationId(),
                e.getAccountLogin(),
                parseRepos(e.getSelectedReposJson()),
                e.getSuspendedAt(),
                e.getUpdatedAt()
        );
    }

    public record LinkStateResponse(String state, Instant expiresAt) {
    }

    public record InstallationView(
            UUID id,
            long installationId,
            String accountLogin,
            List<String> selectedRepositories,
            Instant suspendedAt,
            Instant updatedAt
    ) {
    }
}
