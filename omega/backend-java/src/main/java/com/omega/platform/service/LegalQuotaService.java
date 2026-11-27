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
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * Q8: Cuotas por plan y rate limiting PERSISTENTE y ATÓMICO en PostgreSQL
 * (omega_rag.legal_rate_limit_windows y omega_rag.legal_indexing_inflight, migración V21),
 * seguro en despliegues multi-instancia mediante pg_advisory_xact_lock + transacciones REQUIRES_NEW.
 */
@Service
public class LegalQuotaService {

    private static final List<DocumentStatus> ACTIVE_DOC_STATUSES = List.of(
            DocumentStatus.PROCESSING, DocumentStatus.INDEXED, DocumentStatus.REINDEX_REQUIRED
    );
    private static final Duration STALE_INFLIGHT_TTL = Duration.ofMinutes(10);

    private final LegalQuotaProperties quotaProperties;
    private final DocumentRepository documentRepository;
    private final TenantRepository tenantRepository;
    private final CommercialSaasService commercialSaasService;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate requiresNewTx;

    // Fallback en memoria únicamente para pruebas unitarias sin JdbcTemplate
    private final ConcurrentHashMap<UUID, Deque<Instant>> fallbackUploadWindows = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, Deque<Instant>> fallbackQueryWindows = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, AtomicInteger> fallbackInflight = new ConcurrentHashMap<>();

    public LegalQuotaService(
            LegalQuotaProperties quotaProperties,
            DocumentRepository documentRepository,
            TenantRepository tenantRepository,
            CommercialSaasService commercialSaasService
    ) {
        this(quotaProperties, documentRepository, tenantRepository, commercialSaasService, null, null);
    }

    @Autowired
    public LegalQuotaService(
            LegalQuotaProperties quotaProperties,
            DocumentRepository documentRepository,
            TenantRepository tenantRepository,
            CommercialSaasService commercialSaasService,
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager
    ) {
        this.quotaProperties = quotaProperties;
        this.documentRepository = documentRepository;
        this.tenantRepository = tenantRepository;
        this.commercialSaasService = commercialSaasService;
        this.jdbc = jdbc;
        if (transactionManager != null) {
            TransactionTemplate tt = new TransactionTemplate(transactionManager);
            tt.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            this.requiresNewTx = tt;
        } else {
            this.requiresNewTx = null;
        }
    }

    public record UploadReservation(UUID reservationId, UUID tenantId, Instant windowMinute, boolean active) {}

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
     * Reserva atómicamente en PostgreSQL (REQUIRES_NEW + advisory lock por tenant) un cupo de carga y concurrencia.
     * Si falla la ingesta antes de encolar, {@link #releaseUploadReservation(UploadReservation)} revierte el cobro en BD.
     */
    public UploadReservation reserveUploadSlot(OmegaPrincipal principal, UUID expedienteId) {
        return reserveUploadSlot(principal, expedienteId, 0L);
    }

    public UploadReservation reserveUploadSlot(OmegaPrincipal principal, UUID expedienteId, long incomingBytes) {
        if (principal == null || !isLegalTenant(principal)) {
            return new UploadReservation(null, principal == null ? null : principal.tenantId(), Instant.now(), false);
        }
        long safeIncomingBytes = Math.max(0L, incomingBytes);
        String planCode = resolvePlanCode(principal.tenantId());
        var limits = quotaProperties.forPlan(planCode);
        if (jdbc == null) {
            return reserveUploadInMemoryFallback(principal.tenantId(), expedienteId, planCode, limits, safeIncomingBytes);
        }
        return runRequiresNew(() -> {
            lockTenantQuota(principal.tenantId(), "UPLOAD");
            Instant windowMinute = Instant.now().truncatedTo(ChronoUnit.MINUTES);
            consumePersistentRateBucket(principal.tenantId(), "UPLOAD", windowMinute, limits.getUploadPerMinute(),
                    "Has superado el límite de cargas por minuto de tu plan (" + limits.getUploadPerMinute() + "/min). Espera unos segundos e intenta de nuevo.");

            // Purgar reservas huérfanas antiguas
            jdbc.update("DELETE FROM omega_rag.legal_indexing_inflight WHERE tenant_id = ? AND created_at < ?",
                    principal.tenantId(), Timestamp.from(Instant.now().minus(STALE_INFLIGHT_TTL)));

            Integer inflightCount = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM omega_rag.legal_indexing_inflight WHERE tenant_id = ?",
                    Integer.class, principal.tenantId());
            long processingInDb = documentRepository.countByTenantIdAndStatus(principal.tenantId(), DocumentStatus.PROCESSING);
            if (processingInDb + (inflightCount == null ? 0 : inflightCount) >= limits.getMaxConcurrentIndexing()) {
                decrementPersistentRateBucket(principal.tenantId(), "UPLOAD", windowMinute);
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Hay demasiados documentos indexándose simultáneamente en tu plan (" + limits.getMaxConcurrentIndexing() + "). Espera a que termine alguno.");
            }

            long docsInCase = documentRepository.countByTenantIdAndExpedienteIdAndStatusIn(
                    principal.tenantId(), expedienteId, ACTIVE_DOC_STATUSES);
            if (docsInCase >= limits.getMaxDocumentsPerCase()) {
                decrementPersistentRateBucket(principal.tenantId(), "UPLOAD", windowMinute);
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Este expediente alcanzó el límite de " + limits.getMaxDocumentsPerCase() + " documentos de tu plan " + planCode + ".");
            }

            // B-07: Enforcement atómico de maxTotalBytesPerCase (documentos persistidos + reservas en vuelo)
            if (limits.getMaxTotalBytesPerCase() > 0) {
                Long persistedBytes = jdbc.queryForObject(
                        """
                        SELECT COALESCE(SUM(file_size_bytes), 0)
                        FROM omega_rag.documents
                        WHERE tenant_id = ? AND expediente_id = ?
                          AND status IN ('PROCESSING', 'INDEXED', 'REINDEX_REQUIRED')
                        """,
                        Long.class, principal.tenantId(), expedienteId);
                Long inflightBytes = jdbc.queryForObject(
                        """
                        SELECT COALESCE(SUM(file_size_bytes), 0)
                        FROM omega_rag.legal_indexing_inflight
                        WHERE tenant_id = ? AND expediente_id = ?
                        """,
                        Long.class, principal.tenantId(), expedienteId);
                long projectedBytes = (persistedBytes == null ? 0L : persistedBytes)
                        + (inflightBytes == null ? 0L : inflightBytes)
                        + safeIncomingBytes;
                if (projectedBytes > limits.getMaxTotalBytesPerCase()) {
                    decrementPersistentRateBucket(principal.tenantId(), "UPLOAD", windowMinute);
                    throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                            "Este expediente supera el límite de almacenamiento (" + limits.getMaxTotalBytesPerCase()
                                    + " bytes) de tu plan " + planCode + ".");
                }
            }

            UUID reservationId = UUID.randomUUID();
            jdbc.update(
                    "INSERT INTO omega_rag.legal_indexing_inflight(reservation_id, tenant_id, expediente_id, file_size_bytes) VALUES (?, ?, ?, ?)",
                    reservationId, principal.tenantId(), expedienteId, safeIncomingBytes);
            return new UploadReservation(reservationId, principal.tenantId(), windowMinute, true);
        });
    }

    public void commitUploadReservation(UploadReservation reservation) {
        if (reservation == null || !reservation.active()) return;
        if (jdbc == null) {
            AtomicInteger inflight = fallbackInflight.get(reservation.tenantId());
            if (inflight != null) inflight.updateAndGet(v -> Math.max(0, v - 1));
            return;
        }
        runRequiresNew(() -> {
            jdbc.update("DELETE FROM omega_rag.legal_indexing_inflight WHERE reservation_id = ?", reservation.reservationId());
            return null;
        });
    }

    public void releaseUploadReservation(UploadReservation reservation) {
        if (reservation == null || !reservation.active()) return;
        if (jdbc == null) {
            Deque<Instant> window = fallbackUploadWindows.get(reservation.tenantId());
            if (window != null) {
                synchronized (window) { window.removeLastOccurrence(reservation.windowMinute()); }
            }
            AtomicInteger inflight = fallbackInflight.get(reservation.tenantId());
            if (inflight != null) inflight.updateAndGet(v -> Math.max(0, v - 1));
            return;
        }
        runRequiresNew(() -> {
            lockTenantQuota(reservation.tenantId(), "UPLOAD");
            jdbc.update("DELETE FROM omega_rag.legal_indexing_inflight WHERE reservation_id = ?", reservation.reservationId());
            decrementPersistentRateBucket(reservation.tenantId(), "UPLOAD", reservation.windowMinute());
            return null;
        });
    }

    public void checkQueryRate(OmegaPrincipal principal) {
        if (principal == null || !isLegalTenant(principal)) return;
        String planCode = resolvePlanCode(principal.tenantId());
        var limits = quotaProperties.forPlan(planCode);
        if (jdbc == null) {
            Instant now = Instant.now();
            Deque<Instant> window = fallbackQueryWindows.computeIfAbsent(principal.tenantId(), k -> new ArrayDeque<>());
            synchronized (window) {
                pruneWindow(window, now);
                if (window.size() >= limits.getQueryPerMinute()) {
                    throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                            "Has superado el límite de consultas por minuto de tu plan (" + limits.getQueryPerMinute() + "/min). Intenta de nuevo en unos segundos.");
                }
                window.addLast(now);
            }
            return;
        }
        runRequiresNew(() -> {
            lockTenantQuota(principal.tenantId(), "QUERY");
            Instant windowMinute = Instant.now().truncatedTo(ChronoUnit.MINUTES);
            consumePersistentRateBucket(principal.tenantId(), "QUERY", windowMinute, limits.getQueryPerMinute(),
                    "Has superado el límite de consultas por minuto de tu plan (" + limits.getQueryPerMinute() + "/min). Intenta de nuevo en unos segundos.");
            return null;
        });
    }

    @org.springframework.beans.factory.annotation.Value("${omega.legal.conflict-rate-limit-per-minute:30}")
    private int conflictRateLimitPerMinute = 30;

    /** Límite por usuario (no por espacio) para consultas de conflicto; excedido devuelve 429. */
    public void checkConflictSearchRate(OmegaPrincipal principal) {
        if (principal == null || jdbc == null) return;
        String bucket = "CONFLICT:" + principal.userId();
        int limit = Math.max(1, conflictRateLimitPerMinute);
        runRequiresNew(() -> {
            lockTenantQuota(principal.tenantId(), bucket);
            Instant windowMinute = Instant.now().truncatedTo(ChronoUnit.MINUTES);
            consumePersistentRateBucket(principal.tenantId(), bucket, windowMinute, limit,
                    "Demasiadas verificaciones de conflicto seguidas. Espera un minuto e inténtalo de nuevo.");
            return null;
        });
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

    private void lockTenantQuota(UUID tenantId, String bucketType) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", Object.class,
                "legal_quota:" + tenantId + ":" + bucketType);
    }

    private void consumePersistentRateBucket(UUID tenantId, String bucketType, Instant windowMinute, int maxPerMinute, String message) {
        // Limpieza ligera de ventanas vencidas (> 10 min)
        jdbc.update("DELETE FROM omega_rag.legal_rate_limit_windows WHERE tenant_id = ? AND bucket_type = ? AND window_minute < ?",
                tenantId, bucketType, Timestamp.from(windowMinute.minus(Duration.ofMinutes(10))));

        List<Integer> updated = jdbc.queryForList("""
                INSERT INTO omega_rag.legal_rate_limit_windows(tenant_id, bucket_type, window_minute, request_count, updated_at)
                VALUES (?, ?, ?, 1, NOW())
                ON CONFLICT (tenant_id, bucket_type, window_minute)
                DO UPDATE SET request_count = omega_rag.legal_rate_limit_windows.request_count + 1, updated_at = NOW()
                WHERE omega_rag.legal_rate_limit_windows.request_count < ?
                RETURNING request_count
                """, Integer.class, tenantId, bucketType, Timestamp.from(windowMinute), maxPerMinute);

        if (updated.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, message);
        }
    }

    private void decrementPersistentRateBucket(UUID tenantId, String bucketType, Instant windowMinute) {
        jdbc.update("""
                UPDATE omega_rag.legal_rate_limit_windows
                SET request_count = GREATEST(0, request_count - 1), updated_at = NOW()
                WHERE tenant_id = ? AND bucket_type = ? AND window_minute = ?
                """, tenantId, bucketType, Timestamp.from(windowMinute));
    }

    private <T> T runRequiresNew(java.util.function.Supplier<T> action) {
        if (requiresNewTx != null) {
            return requiresNewTx.execute(status -> action.get());
        }
        return action.get();
    }

    private UploadReservation reserveUploadInMemoryFallback(UUID tenantId, UUID expedienteId, String planCode, LegalQuotaProperties.PlanQuota limits, long incomingBytes) {
        Instant now = Instant.now();
        Deque<Instant> window = fallbackUploadWindows.computeIfAbsent(tenantId, k -> new ArrayDeque<>());
        synchronized (window) {
            pruneWindow(window, now);
            if (window.size() >= limits.getUploadPerMinute()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Has superado el límite de cargas por minuto de tu plan (" + limits.getUploadPerMinute() + "/min). Espera unos segundos e intenta de nuevo.");
            }
            window.addLast(now);
        }
        AtomicInteger inflight = fallbackInflight.computeIfAbsent(tenantId, k -> new AtomicInteger(0));
        int currentInflight = inflight.incrementAndGet();
        try {
            long processingInDb = documentRepository.countByTenantIdAndStatus(tenantId, DocumentStatus.PROCESSING);
            if (processingInDb + currentInflight - 1 >= limits.getMaxConcurrentIndexing()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Hay demasiados documentos indexándose simultáneamente en tu plan (" + limits.getMaxConcurrentIndexing() + "). Espera a que termine alguno.");
            }
            long docsInCase = documentRepository.countByTenantIdAndExpedienteIdAndStatusIn(tenantId, expedienteId, ACTIVE_DOC_STATUSES);
            if (docsInCase >= limits.getMaxDocumentsPerCase()) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Este expediente alcanzó el límite de " + limits.getMaxDocumentsPerCase() + " documentos de tu plan " + planCode + ".");
            }
            if (limits.getMaxTotalBytesPerCase() > 0 && incomingBytes > 0) {
                long persistedBytes = documentRepository.sumFileSizeBytesByTenantIdAndExpedienteIdAndStatusIn(
                        tenantId, expedienteId, ACTIVE_DOC_STATUSES);
                if (persistedBytes + incomingBytes > limits.getMaxTotalBytesPerCase()) {
                    throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                            "Este expediente supera el límite de almacenamiento (" + limits.getMaxTotalBytesPerCase()
                                    + " bytes) de tu plan " + planCode + ".");
                }
            }
            return new UploadReservation(UUID.randomUUID(), tenantId, now, true);
        } catch (RuntimeException ex) {
            releaseUploadReservation(new UploadReservation(null, tenantId, now, true));
            throw ex;
        }
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
