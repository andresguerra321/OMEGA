package com.omega.platform.rag;

import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.rag.RagAnswerGenerator.RankedChunk;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Motor de consulta RAG híbrida con detección de cambio de modelo (`REINDEX_REQUIRED`),
 * aislamiento multi-tenant/expediente estricto y citas probatorias verificables con SHA-256.
 */
@Service
public class HybridRagQueryService {

    private final ExpedienteAuthorizationService authorizationService;
    private final DocumentRepository documentRepository;
    private final EmbeddingProvider embeddingProvider;
    private final HybridRagSearchRepository searchRepository;
    private final RagAnswerGenerator answerGenerator;
    private final AuditLogService auditLogService;

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
        String activeModel = embeddingProvider.modelName();
        int topK = request.topK() == null ? 6 : Math.max(1, Math.min(request.topK(), 20));

        List<DocumentEntity> docs = documentRepository
                .findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(principal.tenantId(), expedienteId);

        List<DocumentReindexNotice> reindexNotices = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        int activeIndexedCount = 0;

        for (DocumentEntity doc : docs) {
            if (doc.getStatus() == DocumentStatus.INDEXED && !activeModel.equals(doc.getEmbeddingModel())) {
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

        if (activeIndexedCount == 0) {
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

        float[] queryVector = embeddingProvider.embedQuery(request.question().trim());
        List<RankedChunk> ranked = searchRepository.searchHybrid(
                principal.tenantId(),
                expedienteId,
                request.question(),
                queryVector,
                activeModel,
                topK
        );

        String answer = answerGenerator.generateGroundedAnswer(request.question(), ranked);
        List<RagCitationDto> citations = ranked.stream()
                .map(c -> new RagCitationDto(
                        c.documentId(),
                        c.originalFilename(),
                        c.sha256Hash(),
                        c.pageNumber(),
                        c.sectionTitle(),
                        c.citationLabel(),
                        c.content().length() > 420 ? c.content().substring(0, 417) + "..." : c.content(),
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
                        "reindexWarnings", reindexNotices.size()
                )
        );

        String status = reindexNotices.isEmpty() ? "OK" : "PARTIAL_REINDEX_REQUIRED";
        return new RagQueryResponse(status, activeModel, answer, warnings, reindexNotices, citations);
    }

    public record RagQueryRequest(
            @NotBlank @Size(min = 2, max = 2000) String question,
            @Min(1) @Max(20) Integer topK
    ) {
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
