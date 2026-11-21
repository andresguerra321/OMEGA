package com.omega.platform.service;

import com.omega.platform.config.LegalQuotaProperties;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Q8: Cuotas por plan, rate limiting en carga/consulta con reserva atómica reversible
 * y vista de administrador de documentos en fallo o atascados (sin contenido ni nombres de archivo).
 */
@Service
public class LegalQuotaService {

    private static final List<DocumentStatus> ACTIVE_DOC_STATUSES = List.of(
            DocumentStatus.PROCESSING, DocumentStatus.INDEXED, DocumentStatus.REINDEX_REQUIRED
    );

    private final LegalQuotaProperties quotaProperties;
    private final DocumentRepository documentRepository;
    private final TenantRepository tenantRepository;
    private final CommercialSaasService commercialSaasService;

    private final ConcurrentHashMap<UUID, Deque<Instant>> uploadWindows = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, Deque<Instant>> queryWindows = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, AtomicInteger> inflightUploads = new ConcurrentHashMap<>();

    @Autowired
    public LegalQuotaService(
            LegalQuotaProperties quotaProperties,
            DocumentRepository documentRepository,
            TenantRepository tenantRepository,
            CommercialSaasService commercialSaasService
    ) {
        this.quotaProperties = quotaProperties;
        this.documentRepository = documentRepository;
        this.tenantRepository = tenantRepository;
        this.commercialSaasService = commercialSaasService;
    }

    public record UploadReservation(UUID tenantId, Instant timestamp, boolean active) {}

    public record AdminDocumentIssueView(
            UUID documentId,
            UUID expedienteId,
            String status,
            String failureCode,
            String reason,
            String sha256Hash,
            boolean stuck,
            Instant createdAt
    ) {}

    public record QuotaSummaryView(
            String planCode,
            int maxDocumentsPerCase,
            long maxTotalBytesPerCase,
            int monthlyQueries,
            int maxConcurrentIndexing,
            int uploadPerMinute,
            int queryPerMinute
    ) {}

    public QuotaSummaryView currentPlanSummary(OmegaPrincipal principal) {
        String planCode = resolvePlanCode(principal.tenantId());
        var q = quotaProperties.forPlan(planCode);
        return new QuotaSummaryView(
                planCode,
                q.getMaxDocumentsPerCase(),
                q.getMaxTotalBytesPerCase(),
                q.getMonthlyQueries(),
                q.getMaxConcurrentIndexing(),
                q.getUploadPerMinute(),
                q.getQueryPerMinute()
        );
    }

    /**
     * Reserva atómicamente un cupo de carga y concurrencia; si falla la ingesta antes de encolar,
     * el llamador invoca {@link #releaseUploadReservation(UploadReservation)} para revertir el cobro.
     */
    public UploadReservation reserveUploadSlot(OmegaPrincipal principal, UUID expedienteId) {
        if (!isLegalTenant(principal)) {
            return new UploadReservation(principal.tenantId(), Instant.now(), false);
        }
        String planCode = resolvePlanCode(principal.tenantId());
        var limits = quotaProperties.forPlan(planCode);

        Instant now = Instant.now();
        Deque<Instant> window = uploadWindows.computeIfAbsent(principal.tenantId(), k -> new ArrayDeque<>());
        synchronized (window) {
            pruneWindow(window, now);
            if (window.size() >= limits.getUploadPerMinute()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Has superado el límite de cargas por minuto de tu plan (" + limits.getUploadPerMinute() + "/min). Espera unos segundos e intenta de nuevo.");
            }
            window.addLast(now);
        }

        AtomicInteger inflight = inflightUploads.computeIfAbsent(principal.tenantId(), k -> new AtomicInteger(0));
        int currentInflight = inflight.incrementAndGet();
        try {
            long processingInDb = documentRepository.countByTenantIdAndStatus(principal.tenantId(), DocumentStatus.PROCESSING);
            if (processingInDb + currentInflight - 1 >= limits.getMaxConcurrentIndexing()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Hay demasiados documentos indexándose simultáneamente en tu plan (" + limits.getMaxConcurrentIndexing() + "). Espera a que termine alguno.");
            }
            long docsInCase = documentRepository.countByTenantIdAndExpedienteIdAndStatusIn(
                    principal.tenantId(), expedienteId, ACTIVE_DOC_STATUSES);
            if (docsInCase >= limits.getMaxDocumentsPerCase()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Este expediente alcanzó el límite de " + limits.getMaxDocumentsPerCase() + " documentos de tu plan " + planCode + ".");
            }
            return new UploadReservation(principal.tenantId(), now, true);
        } catch (RuntimeException ex) {
            releaseUploadReservation(new UploadReservation(principal.tenantId(), now, true));
            throw ex;
        }
    }

    public void commitUploadReservation(UploadReservation reservation) {
        if (reservation == null || !reservation.active()) return;
        AtomicInteger inflight = inflightUploads.get(reservation.tenantId());
        if (inflight != null) {
            inflight.updateAndGet(v -> Math.max(0, v - 1));
        }
    }

    public void releaseUploadReservation(UploadReservation reservation) {
        if (reservation == null || !reservation.active()) return;
        Deque<Instant> window = uploadWindows.get(reservation.tenantId());
        if (window != null) {
            synchronized (window) {
                window.removeLastOccurrence(reservation.timestamp());
            }
        }
        AtomicInteger inflight = inflightUploads.get(reservation.tenantId());
        if (inflight != null) {
            inflight.updateAndGet(v -> Math.max(0, v - 1));
        }
    }

    public void checkQueryRate(OmegaPrincipal principal) {
        if (principal == null || !isLegalTenant(principal)) return;
        String planCode = resolvePlanCode(principal.tenantId());
        var limits = quotaProperties.forPlan(planCode);
        Instant now = Instant.now();
        Deque<Instant> window = queryWindows.computeIfAbsent(principal.tenantId(), k -> new ArrayDeque<>());
        synchronized (window) {
            pruneWindow(window, now);
            if (window.size() >= limits.getQueryPerMinute()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Has superado el límite de consultas por minuto de tu plan (" + limits.getQueryPerMinute() + "/min). Intenta de nuevo en unos segundos.");
            }
            window.addLast(now);
        }
    }

    @Transactional(readOnly = true)
    public List<AdminDocumentIssueView> listAdminDocumentIssues(OmegaPrincipal principal) {
        if (principal.role() != Role.ADMIN) {
            throw new AccessDeniedException("Solo un administrador puede consultar el estado de documentos con incidencias.");
        }
        Instant stuckThreshold = Instant.now().minus(Duration.ofMinutes(Math.max(1, quotaProperties.getStuckProcessingMinutes())));
        List<DocumentEntity> candidates = documentRepository.findAllByTenantIdAndStatusInOrderByCreatedAtDesc(
                principal.tenantId(),
                List.of(DocumentStatus.FAILED, DocumentStatus.REJECTED, DocumentStatus.PROCESSING)
        );
        return candidates.stream()
                .filter(d -> d.getStatus() != DocumentStatus.PROCESSING || d.getCreatedAt().isBefore(stuckThreshold))
                .map(d -> {
                    boolean stuck = d.getStatus() == DocumentStatus.PROCESSING;
                    String code = stuck ? "PROCESSING_STUCK" : (d.getFailureCode() != null ? d.getFailureCode() : "PROCESSING_ERROR");
                    String reason = stuck
                            ? "El procesamiento excedió el tiempo esperado. Puedes reintentar o eliminar el documento."
                            : safeReason(d.getFailureCode());
                    return new AdminDocumentIssueView(
                            d.getId(),
                            d.getExpedienteId(),
                            d.getStatus().name(),
                            code,
                            reason,
                            d.getSha256Hash(),
                            stuck,
                            d.getCreatedAt()
                    );
                })
                .toList();
    }

    private boolean isLegalTenant(OmegaPrincipal principal) {
        if (tenantRepository == null || principal == null) return false;
        return tenantRepository.findByIdAndActiveTrue(principal.tenantId())
                .map(t -> t.getProfile() == TenantProfile.LEGAL)
                .orElse(false);
    }

    private String resolvePlanCode(UUID tenantId) {
        if (commercialSaasService == null) return "PERSONAL";
        try {
            var sub = commercialSaasService.getOrProvisionSubscription(tenantId);
            return sub != null && sub.getPlanCode() != null ? sub.getPlanCode() : "PERSONAL";
        } catch (Exception ex) {
            return "PERSONAL";
        }
    }

    private static void pruneWindow(Deque<Instant> window, Instant now) {
        Instant cutoff = now.minusSeconds(60);
        while (!window.isEmpty() && window.peekFirst().isBefore(cutoff)) {
            window.pollFirst();
        }
    }

    private static String safeReason(String failureCode) {
        if (failureCode == null) return "Error durante el procesamiento del documento.";
        return switch (failureCode) {
            case "UNSAFE_PDF" -> "El archivo contenía elementos activos no permitidos.";
            case "INVALID_FORMAT" -> "Formato o firma binaria no admitida.";
            case "TEXT_UNAVAILABLE" -> "No se pudo extraer texto legible (verifica OCR).";
            case "TEMP_DELETE_FAILED" -> "Incidencia al purgar el archivo temporal.";
            case "INDEXER_UNAVAILABLE" -> "El proveedor de indexación no respondió.";
            default -> "No se pudo completar el procesamiento.";
        };
    }
}
