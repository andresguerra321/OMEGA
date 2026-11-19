package com.omega.platform.rag;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.config.SovereignModePolicy;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.ingest.AsyncDocumentProcessor;
import com.omega.platform.rag.RagAnswerGenerator.RankedChunk;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Motor de consulta RAG híbrida con detección de cambio de modelo (`REINDEX_REQUIRED`),
 * aislamiento multi-tenant/expediente estricto y citas probatorias verificables con SHA-256.
 */
@Service
public class HybridRagQueryService {

    private static final Logger log = LoggerFactory.getLogger(HybridRagQueryService.class);

    private final ExpedienteAuthorizationService authorizationService;
    private final DocumentRepository documentRepository;
    private final EmbeddingProvider embeddingProvider;
    private final HybridRagSearchRepository searchRepository;
    private final RagAnswerGenerator answerGenerator;
    private final AuditLogService auditLogService;

    @Autowired(required = false)
    private CommercialSaasService commercialSaasService;

    @Autowired(required = false)
    private SovereignModePolicy sovereignModePolicy;

    public HybridRagQueryService(
            ExpedienteAuthorizationService authorizationService,
            DocumentRepository documentRepository,
            EmbeddingProvider embeddingProvider,
            HybridRagSearchRepository searchRepository,
            RagAnswerGenerator answerGenerator,
            AuditLogService auditLogService
    ) {
        this.authorizationService = authorizationService;
        this.documentRepository = documentRepository;
        this.embeddingProvider = embeddingProvider;
        this.searchRepository = searchRepository;
        this.answerGenerator = answerGenerator;
        this.auditLogService = auditLogService;
    }

    @Transactional
    public RagQueryResponse queryExpediente(
            OmegaPrincipal principal,
            UUID expedienteId,
            RagQueryRequest request
    ) {
        authorizationService.requireReadAccess(principal, expedienteId);
        if (commercialSaasService != null && principal != null) {
            boolean sovereign = sovereignModePolicy != null && sovereignModePolicy.enabled();
            try {
                commercialSaasService.consumeAiQuota(principal.tenantId(), principal.userId(), sovereign, false);
            } catch (IllegalStateException ex) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage(), ex);
            }
        }
        String activeModel = embeddingProvider.modelName();
        int topK = request.topK() == null ? 6 : Math.max(1, Math.min(request.topK(), 20));

        List<DocumentEntity> docs = documentRepository
                .findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(principal.tenantId(), expedienteId);

        List<DocumentReindexNotice> reindexNotices = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        int activeIndexedCount = 0;
        int lexicalIndexedCount = 0;

        for (DocumentEntity doc : docs) {
            boolean isLexicalFallback = AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL.equals(doc.getEmbeddingModel());
            if (doc.getStatus() == DocumentStatus.INDEXED
                    && !activeModel.equals(doc.getEmbeddingModel())
                    && !isLexicalFallback) {
                doc.setStatus(DocumentStatus.REINDEX_REQUIRED);
                documentRepository.saveAndFlush(doc);
            }

            if (doc.getStatus() == DocumentStatus.REINDEX_REQUIRED) {
                String advice = String.format(
                        "El documento '%s' (SHA-256: %s) fue indexado con '%s' y requiere reindexación para '%s'. "
                                + "Por política Zero-Retention no conservamos el PDF en el servidor; vuelve a subir tu copia local.",
                        doc.getOriginalFilename(),
                        doc.getSha256Hash(),
                        doc.getEmbeddingModel(),
                        activeModel
                );
                warnings.add(advice);
                reindexNotices.add(new DocumentReindexNotice(
                        doc.getId(),
                        doc.getOriginalFilename(),
                        doc.getSha256Hash(),
                        doc.getEmbeddingModel(),
                        activeModel,
                        advice
                ));
            } else if (doc.getStatus() == DocumentStatus.INDEXED && activeModel.equals(doc.getEmbeddingModel())) {
                activeIndexedCount++;
            } else if (doc.getStatus() == DocumentStatus.INDEXED && isLexicalFallback) {
                lexicalIndexedCount++;
                warnings.add(String.format(
                        "El documento '%s' (SHA-256: %s) fue indexado sin clave de embeddings y se consulta por índice léxico exacto (tsvector).",
                        doc.getOriginalFilename(),
                        doc.getSha256Hash()
                ));
            }
        }

        if (!reindexNotices.isEmpty()) {
            auditLogService.record(
                    principal.tenantId(),
                    principal.userId(),
                    "DOCUMENT_REINDEX_REQUIRED",
                    "EXPEDIENTE",
                    expedienteId.toString(),
                    Map.of(
                            "activeModel", activeModel,
                            "driftedDocuments", reindexNotices.size()
                    )
            );
        }

        if (activeIndexedCount == 0 && lexicalIndexedCount == 0) {
            String status = reindexNotices.isEmpty() ? "NO_INDEXED_DOCUMENTS" : "REINDEX_REQUIRED";
            String answer = reindexNotices.isEmpty()
                    ? "Este expediente aún no tiene documentos PDF indexados listos para consulta."
                    : "Todos los documentos del expediente requieren reindexación por cambio de modelo de embeddings ("
                            + activeModel + "). Por política Zero-Retention, vuelve a subir tus PDFs originales locales.";

            auditLogService.record(
                    principal.tenantId(),
                    principal.userId(),
                    "RAG_QUERY_BLOCKED",
                    "EXPEDIENTE",
                    expedienteId.toString(),
                    Map.of("reason", status, "activeModel", activeModel)
            );
            return new RagQueryResponse(status, activeModel, answer, warnings, reindexNotices, List.of());
        }

        List<String> lexicalModels = new ArrayList<>();
        if (activeIndexedCount > 0) {
            lexicalModels.add(activeModel);
        }
        if (lexicalIndexedCount > 0) {
            lexicalModels.add(AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL);
        }

        boolean lexicalDegraded = false;
        List<RankedChunk> ranked;
        if (activeIndexedCount == 0) {
            lexicalDegraded = true;
            warnings.add("Consulta ejecutada en modo léxico exacto (tsvector): los documentos indexados no disponen de embeddings vectoriales.");
            ranked = searchRepository.searchLexicalOnly(
                    principal.tenantId(),
                    expedienteId,
                    request.question(),
                    lexicalModels,
                    topK
            );
        } else {
            try {
                float[] queryVector = embeddingProvider.embedQuery(request.question().trim());
                ranked = searchRepository.searchHybrid(
                        principal.tenantId(),
                        expedienteId,
                        request.question(),
                        queryVector,
                        activeModel,
                        topK
                );
                if (lexicalIndexedCount > 0) {
                    ranked = mergeLexicalFallbackHits(
                            ranked,
                            searchRepository.searchLexicalOnly(
                                    principal.tenantId(),
                                    expedienteId,
                                    request.question(),
                                    List.of(AsyncDocumentProcessor.LEXICAL_FALLBACK_MODEL),
                                    topK
                            ),
                            topK
                    );
                }
            } catch (EmbeddingException ex) {
                lexicalDegraded = true;
                log.warn("Proveedor de embeddings no disponible; degradando consulta del expediente {} a búsqueda léxica tsvector: {}",
                        expedienteId, ex.getMessage());
                warnings.add("Proveedor de embeddings no disponible temporalmente; consulta ejecutada en modo degradado por búsqueda léxica exacta (tsvector).");
                ranked = searchRepository.searchLexicalOnly(
                        principal.tenantId(),
                        expedienteId,
                        request.question(),
                        lexicalModels,
                        topK
                );
            }
        }

        String answer = answerGenerator.generateGroundedAnswer(request.question(), ranked, request.analysisContext());
        List<RagCitationDto> citations = ranked.stream()
                .map(c -> new RagCitationDto(
                        c.documentId(),
                        c.originalFilename(),
                        c.sha256Hash(),
                        c.pageNumber(),
                        c.sectionTitle(),
                        c.citationLabel(),
                        c.content().length() > 1500 ? c.content().substring(0, 1497) + "..." : c.content(),
                        c.vectorScore(),
                        c.lexicalScore(),
                        c.rrfScore()
                ))
                .toList();

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "RAG_QUERY_EXECUTED",
                "EXPEDIENTE",
                expedienteId.toString(),
                Map.of(
                        "activeModel", activeModel,
                        "topK", topK,
                        "citationsCount", citations.size(),
                        "reindexWarnings", reindexNotices.size(),
                        "degradedMode", lexicalDegraded ? "LEXICAL_ONLY" : "HYBRID_RRF"
                )
        );

        String status = lexicalDegraded
                ? "DEGRADED_LEXICAL"
                : (reindexNotices.isEmpty() ? "OK" : "PARTIAL_REINDEX_REQUIRED");
        return new RagQueryResponse(status, activeModel, answer, warnings, reindexNotices, citations);
    }

    private static List<RankedChunk> mergeLexicalFallbackHits(
            List<RankedChunk> primaryHits,
            List<RankedChunk> fallbackHits,
            int topK
    ) {
        if (fallbackHits == null || fallbackHits.isEmpty()) {
            return primaryHits;
        }
        Map<String, RankedChunk> merged = new LinkedHashMap<>();
        for (RankedChunk c : primaryHits) {
            merged.put(c.documentId() + ":" + c.chunkOrder(), c);
        }
        for (RankedChunk c : fallbackHits) {
            merged.putIfAbsent(c.documentId() + ":" + c.chunkOrder(), c);
        }
        return merged.values().stream()
                .sorted(Comparator.comparingDouble(RankedChunk::rrfScore).reversed()
                        .thenComparingInt(RankedChunk::pageNumber)
                        .thenComparingInt(RankedChunk::chunkOrder))
                .limit(topK)
                .toList();
    }

    public record RagQueryRequest(
            @NotBlank @Size(min = 2, max = 2000) String question,
            @Min(1) @Max(20) Integer topK,
            @Size(max = 4000) @JsonProperty("analysis_context") String analysisContext
    ) {
        public RagQueryRequest(String question, Integer topK) {
            this(question, topK, null);
        }
    }

    public record DocumentReindexNotice(
            UUID documentId,
            String originalFilename,
            String sha256Hash,
            String indexedEmbeddingModel,
            String activeEmbeddingModel,
            String actionRequired
    ) {
    }

    public record RagCitationDto(
            UUID documentId,
            String originalFilename,
            String sha256Hash,
            int pageNumber,
            String sectionTitle,
            String citationLabel,
            String excerpt,
            double vectorScore,
            double lexicalScore,
            double rrfScore
    ) {
    }

    public record RagQueryResponse(
            String status,
            String activeEmbeddingModel,
            String answer,
            List<String> warnings,
            List<DocumentReindexNotice> reindexRequiredDocuments,
            List<RagCitationDto> citations
    ) {
    }
}
