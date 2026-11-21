package com.omega.platform.service;

import com.omega.platform.domain.DocumentChunkEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.repository.DocumentChunkRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Q5: Extracción híbrida determinista de cronología de casos LEGAL.
 * Sin cita (document_id + chunk_id + page_number) no existe evento.
 * Respeta el consentimiento de IA documental (V19) y audita cada acción sin exponer contenido.
 */
@Service
public class LegalTimelineService {

    private static final Map<String, Integer> SPANISH_MONTHS = Map.ofEntries(
            Map.entry("enero", 1), Map.entry("ene", 1),
            Map.entry("febrero", 2), Map.entry("feb", 2),
            Map.entry("marzo", 3), Map.entry("mar", 3),
            Map.entry("abril", 4), Map.entry("abr", 4),
            Map.entry("mayo", 5), Map.entry("may", 5),
            Map.entry("junio", 6), Map.entry("jun", 6),
            Map.entry("julio", 7), Map.entry("jul", 7),
            Map.entry("agosto", 8), Map.entry("ago", 8),
            Map.entry("septiembre", 9), Map.entry("setiembre", 9), Map.entry("sep", 9), Map.entry("sept", 9),
            Map.entry("octubre", 10), Map.entry("oct", 10),
            Map.entry("noviembre", 11), Map.entry("nov", 11),
            Map.entry("diciembre", 12), Map.entry("dic", 12)
    );

    private static final Pattern ISO_DATE = Pattern.compile("\\b((?:19|20)\\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\\d|3[01])\\b");
    private static final Pattern DMY_DATE = Pattern.compile("\\b(0?[1-9]|[12]\\d|3[01])[-/](0?[1-9]|1[0-2])[-/]((?:19|20)\\d{2})\\b");
    private static final Pattern ES_TEXT_DATE = Pattern.compile(
            "\\b(0?[1-9]|[12]\\d|3[01])\\s+de\\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\\.?\\s+(?:de|del)\\s+((?:19|20)\\d{2})\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern ES_SHORTHAND_RANGE = Pattern.compile(
            "\\b(?:del|desde\\s+el|entre\\s+el)\\s+(0?[1-9]|[12]\\d|3[01])\\s+(?:al|hasta\\s+el|y\\s+el)\\s+(0?[1-9]|[12]\\d|3[01])\\s+de\\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\\.?\\s+(?:de|del)\\s+((?:19|20)\\d{2})\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern RANGE_PREFIX = Pattern.compile(
            "(?:\\b(?:del|desde\\s+el|entre\\s+el|hasta\\s+el|al|y\\s+el)\\s*)$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern RANGE_SUFFIX = Pattern.compile(
            "^(?:\\s*(?:al|hasta\\s+el|y\\s+el)\\s+(?:\\d{1,4}[-/]\\d{1,2}[-/]\\d{2,4}|\\d{1,2}\\s+de\\s+[a-záéíóú]+))",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private static final Set<String> VALID_REVIEW_STATUSES = Set.of("EXTRACTED", "CONFIRMED", "CORRECTED", "HIDDEN");

    private final ExpedienteAuthorizationService authorization;
    private final DocumentRepository documents;
    private final DocumentChunkRepository chunks;
    private final LegalDocumentAiService legalAi;
    private final JdbcTemplate jdbc;
    private final AuditLogService audit;

    public LegalTimelineService(
            ExpedienteAuthorizationService authorization,
            DocumentRepository documents,
            DocumentChunkRepository chunks,
            LegalDocumentAiService legalAi,
            JdbcTemplate jdbc,
            AuditLogService audit
    ) {
        this.authorization = authorization;
        this.documents = documents;
        this.chunks = chunks;
        this.legalAi = legalAi;
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public record TimelineEventView(
            UUID id,
            UUID expedienteId,
            UUID documentId,
            UUID chunkId,
            int pageNumber,
            LocalDate eventDate,
            String summary,
            String reviewStatus,
            boolean autoExtracted,
            String confidence,
            String confidenceReason,
            Instant createdAt,
            Instant updatedAt
    ) {}

    public record ExtractResult(int extractedCount, int totalEvents, List<TimelineEventView> events) {}

    public record ReviewRequest(
            @NotNull String reviewStatus,
            LocalDate eventDate,
            @Size(max = 500) String summary
    ) {}

    public record DetectedDate(
            LocalDate date,
            boolean ambiguous,
            String confidence,
            String confidenceReason,
            String excerpt
    ) {}

    @Transactional(readOnly = true)
    public List<TimelineEventView> list(OmegaPrincipal actor, UUID expedienteId, String statusFilter, UUID documentId, boolean includeHidden) {
        authorization.requireReadAccess(actor, expedienteId);
        StringBuilder sql = new StringBuilder("""
                SELECT id, expediente_id, document_id, chunk_id, page_number, event_date, summary, review_status, confidence, confidence_reason, created_at, updated_at
                FROM omega_rag.legal_timeline_events
                WHERE tenant_id = ? AND expediente_id = ?
                """);
        List<Object> params = new ArrayList<>();
        params.add(actor.tenantId());
        params.add(expedienteId);
        if (statusFilter != null && !statusFilter.isBlank() && VALID_REVIEW_STATUSES.contains(statusFilter.toUpperCase(Locale.ROOT))) {
            sql.append(" AND review_status = ?");
            params.add(statusFilter.toUpperCase(Locale.ROOT));
        } else if (!includeHidden) {
            sql.append(" AND review_status <> 'HIDDEN'");
        }
        if (documentId != null) {
            sql.append(" AND document_id = ?");
            params.add(documentId);
        }
        sql.append(" ORDER BY event_date ASC, page_number ASC, created_at ASC");
        return jdbc.query(sql.toString(), (rs, rowNum) -> new TimelineEventView(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("expediente_id")),
                UUID.fromString(rs.getString("document_id")),
                UUID.fromString(rs.getString("chunk_id")),
                rs.getInt("page_number"),
                rs.getDate("event_date").toLocalDate(),
                rs.getString("summary"),
                rs.getString("review_status"),
                "EXTRACTED".equals(rs.getString("review_status")),
                rs.getString("confidence"),
                rs.getString("confidence_reason"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()
        ), params.toArray());
    }

    @Transactional
    public ExtractResult extractFromIndexedDocuments(OmegaPrincipal actor, UUID expedienteId) {
        authorization.requireWriteAccess(actor, expedienteId);
        legalAi.requireConsent(actor);
        var indexedDocs = documents.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(actor.tenantId(), expedienteId).stream()
                .filter(d -> d.getStatus() == DocumentStatus.INDEXED)
                .toList();
        int insertedOrUpdated = 0;
        for (var doc : indexedDocs) {
            List<DocumentChunkEntity> docChunks = chunks.findAllByTenantIdAndDocumentIdOrderByChunkOrderAsc(actor.tenantId(), doc.getId());
            for (DocumentChunkEntity chunk : docChunks) {
                if (chunk.getPageNumber() < 1 || chunk.getContent() == null || chunk.getContent().isBlank()) {
                    continue;
                }
                List<DetectedDate> detected = detectDatesDeterministically(chunk.getContent());
                for (DetectedDate item : detected) {
                    String summary = item.excerpt();
                    if (item.ambiguous()) {
                        summary = summary + " [Fecha ambigua DD/MM vs MM/DD: verifique]";
                    }
                    int rows = jdbc.update("""
                            INSERT INTO omega_rag.legal_timeline_events
                                (tenant_id, expediente_id, document_id, chunk_id, page_number, event_date, summary, review_status, confidence, confidence_reason)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'EXTRACTED', ?, ?)
                            ON CONFLICT (tenant_id, expediente_id, chunk_id, event_date) DO NOTHING
                            """,
                            actor.tenantId(),
                            expedienteId,
                            doc.getId(),
                            chunk.getId(),
                            chunk.getPageNumber(),
                            Date.valueOf(item.date()),
                            summary,
                            item.confidence(),
                            item.confidenceReason()
                    );
                    insertedOrUpdated += rows;
                }
            }
        }
        audit.record(actor.tenantId(), actor.userId(), "TIMELINE_EXTRACTED", "EXPEDIENTE", expedienteId.toString(),
                Map.of("documentsScanned", indexedDocs.size(), "newEvents", insertedOrUpdated));
        List<TimelineEventView> all = list(actor, expedienteId, null, null, false);
        return new ExtractResult(insertedOrUpdated, all.size(), all);
    }

    @Transactional
    public TimelineEventView reviewEvent(OmegaPrincipal actor, UUID expedienteId, UUID eventId, ReviewRequest request) {
        authorization.requireWriteAccess(actor, expedienteId);
        String nextStatus = request.reviewStatus() == null ? "" : request.reviewStatus().trim().toUpperCase(Locale.ROOT);
        if (!Set.of("CONFIRMED", "CORRECTED", "HIDDEN", "EXTRACTED").contains(nextStatus)) {
            throw new IllegalArgumentException("Estado de revisión inválido");
        }
        List<TimelineEventView> existing = jdbc.query("""
                SELECT id, expediente_id, document_id, chunk_id, page_number, event_date, summary, review_status, confidence, confidence_reason, created_at, updated_at
                FROM omega_rag.legal_timeline_events
                WHERE id = ? AND tenant_id = ? AND expediente_id = ?
                """, (rs, rowNum) -> new TimelineEventView(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("expediente_id")),
                UUID.fromString(rs.getString("document_id")),
                UUID.fromString(rs.getString("chunk_id")),
                rs.getInt("page_number"),
                rs.getDate("event_date").toLocalDate(),
                rs.getString("summary"),
                rs.getString("review_status"),
                "EXTRACTED".equals(rs.getString("review_status")),
                rs.getString("confidence"),
                rs.getString("confidence_reason"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()
        ), eventId, actor.tenantId(), expedienteId);
        if (existing.isEmpty()) {
            throw new ResourceNotFoundException("Evento de cronología no encontrado");
        }
        TimelineEventView current = existing.getFirst();
        LocalDate nextDate = "CORRECTED".equals(nextStatus) && request.eventDate() != null
                ? request.eventDate() : current.eventDate();
        String nextSummary = "CORRECTED".equals(nextStatus) && request.summary() != null && !request.summary().isBlank()
                ? request.summary().strip() : current.summary();

        jdbc.update("""
                UPDATE omega_rag.legal_timeline_events
                SET review_status = ?, event_date = ?, summary = ?, updated_at = NOW()
                WHERE id = ? AND tenant_id = ? AND expediente_id = ?
                """, nextStatus, Date.valueOf(nextDate), nextSummary, eventId, actor.tenantId(), expedienteId);

        audit.record(actor.tenantId(), actor.userId(), "TIMELINE_EVENT_REVIEWED", "EXPEDIENTE", expedienteId.toString(),
                Map.of("eventId", eventId.toString(), "reviewStatus", nextStatus));

        return new TimelineEventView(
                current.id(), current.expedienteId(), current.documentId(), current.chunkId(),
                current.pageNumber(), nextDate, nextSummary, nextStatus, "EXTRACTED".equals(nextStatus),
                current.confidence(), current.confidenceReason(),
                current.createdAt(), Instant.now()
        );
    }

    /**
     * Detector determinista de fechas en múltiples formatos (ISO, DD/MM/YYYY, español textual, rangos).
     * Asigna nivel de confianza (HIGH, MEDIUM, LOW) y nunca inventa fechas para expresiones relativas ni texto sin fechas.
     */
    public static List<DetectedDate> detectDatesDeterministically(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        Map<LocalDate, DetectedDate> byDate = new LinkedHashMap<>();

        Matcher rangeEs = ES_SHORTHAND_RANGE.matcher(text);
        while (rangeEs.find()) {
            int dayStart = Integer.parseInt(rangeEs.group(1));
            int dayEnd = Integer.parseInt(rangeEs.group(2));
            Integer month = SPANISH_MONTHS.get(rangeEs.group(3).toLowerCase(Locale.ROOT));
            int year = Integer.parseInt(rangeEs.group(4));
            if (month != null) {
                String ctx = extractSentenceContext(text, rangeEs.start(), rangeEs.end());
                LocalDate startDate = safeDate(year, month, dayStart);
                LocalDate endDate = safeDate(year, month, dayEnd);
                if (startDate != null) {
                    byDate.putIfAbsent(startDate, new DetectedDate(
                            startDate, false, "MEDIUM",
                            "Extremo de un rango de fechas: verifique inicio y fin", ctx));
                }
                if (endDate != null) {
                    byDate.putIfAbsent(endDate, new DetectedDate(
                            endDate, false, "MEDIUM",
                            "Extremo de un rango de fechas: verifique inicio y fin", ctx));
                }
            }
        }

        Matcher iso = ISO_DATE.matcher(text);
        while (iso.find()) {
            LocalDate parsed = safeDate(Integer.parseInt(iso.group(1)), Integer.parseInt(iso.group(2)), Integer.parseInt(iso.group(3)));
            if (parsed != null) {
                boolean inRange = isWithinDateRange(text, iso.start(), iso.end());
                byDate.putIfAbsent(parsed, new DetectedDate(
                        parsed,
                        false,
                        inRange ? "MEDIUM" : "HIGH",
                        inRange ? "Extremo de un rango de fechas: verifique inicio y fin" : "Formato ISO inequívoco",
                        extractSentenceContext(text, iso.start(), iso.end())
                ));
            }
        }

        Matcher dmy = DMY_DATE.matcher(text);
        while (dmy.find()) {
            int first = Integer.parseInt(dmy.group(1));
            int second = Integer.parseInt(dmy.group(2));
            int year = Integer.parseInt(dmy.group(3));
            LocalDate parsed = safeDate(year, second, first);
            if (parsed != null) {
                boolean ambiguous = first <= 12 && second <= 12 && first != second;
                boolean inRange = isWithinDateRange(text, dmy.start(), dmy.end());
                String confidence = ambiguous ? "LOW" : (inRange ? "MEDIUM" : "HIGH");
                String reason = ambiguous
                        ? (inRange
                                ? "Fecha ambigua en un rango (DD/MM vs MM/DD): verifique día y mes"
                                : "Fecha numérica ambigua (DD/MM vs MM/DD): verifique día y mes")
                        : (inRange
                                ? "Extremo de un rango de fechas: verifique inicio y fin"
                                : "Formato DD/MM/YYYY inequívoco");
                byDate.putIfAbsent(parsed, new DetectedDate(
                        parsed, ambiguous, confidence, reason,
                        extractSentenceContext(text, dmy.start(), dmy.end())
                ));
            }
        }

        Matcher es = ES_TEXT_DATE.matcher(text);
        while (es.find()) {
            int day = Integer.parseInt(es.group(1));
            Integer month = SPANISH_MONTHS.get(es.group(2).toLowerCase(Locale.ROOT));
            int year = Integer.parseInt(es.group(3));
            if (month != null) {
                LocalDate parsed = safeDate(year, month, day);
                if (parsed != null) {
                    boolean inRange = isWithinDateRange(text, es.start(), es.end());
                    byDate.putIfAbsent(parsed, new DetectedDate(
                            parsed,
                            false,
                            inRange ? "MEDIUM" : "HIGH",
                            inRange ? "Extremo de un rango de fechas: verifique inicio y fin" : "Fecha textual en español inequívoca",
                            extractSentenceContext(text, es.start(), es.end())
                    ));
                }
            }
        }

        return List.copyOf(byDate.values());
    }

    private static boolean isWithinDateRange(String text, int start, int end) {
        String before = text.substring(Math.max(0, start - 20), start);
        String after = text.substring(end, Math.min(text.length(), end + 45));
        return RANGE_PREFIX.matcher(before).find() || RANGE_SUFFIX.matcher(after).find();
    }

    private static LocalDate safeDate(int year, int month, int day) {
        try {
            return LocalDate.of(year, month, day);
        } catch (Exception ex) {
            return null;
        }
    }

    private static String extractSentenceContext(String text, int start, int end) {
        int left = Math.max(0, start - 90);
        int right = Math.min(text.length(), end + 110);
        int prevStop = text.lastIndexOf('.', start);
        if (prevStop >= left) left = prevStop + 1;
        int nextStop = text.indexOf('.', end);
        if (nextStop > 0 && nextStop <= right) right = nextStop + 1;
        String snippet = text.substring(left, right).replaceAll("\\s+", " ").trim();
        return snippet.length() > 260 ? snippet.substring(0, 257) + "..." : snippet;
    }
}
