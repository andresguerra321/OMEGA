package com.omega.platform.multimodal;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.config.SovereignModePolicy;
import com.omega.platform.cti.ExternalReputationService;
import com.omega.platform.cti.PublicCorpusRagService;
import com.omega.platform.cti.PublicCorpusRagService.PublicCtiQueryRequest;
import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.domain.IocIndicatorEntity;
import com.omega.platform.ingest.OcrExtractor;
import com.omega.platform.integration.forensic.ForensicBridgeService;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.multimodal.ImageSecuritySanitizer.SanitizedImage;
import com.omega.platform.multimodal.VisionAnalysisProvider.ImageForensicExtraction;
import com.omega.platform.rag.HybridRagQueryService;
import com.omega.platform.rag.HybridRagQueryService.RagCitationDto;
import com.omega.platform.rag.HybridRagQueryService.RagQueryRequest;
import com.omega.platform.rag.HybridRagQueryService.RagQueryResponse;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import org.springframework.beans.factory.annotation.Autowired;
import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Orquestador Multimodal + Determinista + RAG Híbrido bajo Zero-Retention estricto.
 */
@Service
public class MultimodalThreatQueryService {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.CreditService creditService;

    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private com.omega.platform.service.LegalDocumentAiService legalAi;

    private static final Pattern URL_RE = Pattern.compile("https?://[^\\s<>\"')]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern DOMAIN_RE = Pattern.compile("\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:com|net|org|io|xyz|top|tk|ml|ga|cf|gq|click|info|biz|ru|cn|app|dev|edu|gov|co)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern IPV4_RE = Pattern.compile("\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b");
    private static final Pattern SHA256_RE = Pattern.compile("\\b[a-f0-9]{64}\\b", Pattern.CASE_INSENSITIVE);
    private static final int PUBLIC_RATE_LIMIT_PER_MIN = 12;

    private final ImageSecuritySanitizer sanitizer;
    private final VisionAnalysisProvider visionProvider;
    private final OcrExtractor ocrExtractor;
    private final StixCatalogService stixCatalogService;
    private final ExternalReputationService reputationService;
    private final ForensicBridgeService forensicBridgeService;
    private final HybridRagQueryService hybridRagQueryService;
    private final PublicCorpusRagService publicCorpusRagService;
    private final ExpedienteAuthorizationService authorizationService;
    private final AuditLogService auditLogService;
    private final Map<String, Deque<Long>> publicRateWindows = new ConcurrentHashMap<>();

    @Autowired(required = false)
    private CommercialSaasService commercialSaasService;

    @Autowired(required = false)
    private SovereignModePolicy sovereignModePolicy;

    public MultimodalThreatQueryService(
            ImageSecuritySanitizer sanitizer,
            VisionAnalysisProvider visionProvider,
            OcrExtractor ocrExtractor,
            StixCatalogService stixCatalogService,
            ExternalReputationService reputationService,
            ForensicBridgeService forensicBridgeService,
            HybridRagQueryService hybridRagQueryService,
            PublicCorpusRagService publicCorpusRagService,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService
    ) {
        this.sanitizer = sanitizer;
        this.visionProvider = visionProvider;
        this.ocrExtractor = ocrExtractor;
        this.stixCatalogService = stixCatalogService;
        this.reputationService = reputationService;
        this.forensicBridgeService = forensicBridgeService;
        this.hybridRagQueryService = hybridRagQueryService;
        this.publicCorpusRagService = publicCorpusRagService;
        this.authorizationService = authorizationService;
        this.auditLogService = auditLogService;
    }

    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.AI_IMAGE)
    public MultimodalThreatResponse analyzePrivateExpediente(
            OmegaPrincipal principal,
            UUID expedienteId,
            byte[] imageBytes,
            String question
    ) {
        authorizationService.requireReadAccess(principal, expedienteId);
        if(legalAi!=null) legalAi.requireIndexedImageForLegal(principal);
        return executePipeline(principal, expedienteId, imageBytes, question);
    }

    @com.omega.platform.billing.Metered(com.omega.platform.billing.CreditOperation.AI_IMAGE)
    public MultimodalThreatResponse analyzePublicTriage(
            OmegaPrincipal principal,
            byte[] imageBytes,
            String question
    ) {
        enforcePublicRateLimit(principal);
        return executePipeline(principal, null, imageBytes, question);
    }

    private MultimodalThreatResponse executePipeline(
            OmegaPrincipal principal,
            UUID expedienteId,
            byte[] imageBytes,
            String rawQuestion
    ) {
        if (commercialSaasService != null && principal != null && creditService == null) {
            boolean sovereign = sovereignModePolicy != null && sovereignModePolicy.enabled();
            try {
                commercialSaasService.consumeAiQuota(principal.tenantId(), principal.userId(), sovereign, true);
            } catch (IllegalStateException ex) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage(), ex);
            }
        }
        String question = (rawQuestion == null || rawQuestion.isBlank())
                ? "Analiza esta captura en busca de indicadores maliciosos, phishing o vectores de spyware."
                : rawQuestion.trim();

        SanitizedImage sanitized = sanitizer.sanitize(imageBytes);

        // 1. Extracción multimodal en paralelo (Vision LLM + OCR Tesseract en RAM)
        CompletableFuture<ImageForensicExtraction> visionFuture = CompletableFuture.supplyAsync(
                () -> visionProvider.analyze(sanitized, question)
        );
        CompletableFuture<String> ocrFuture = CompletableFuture.supplyAsync(() -> {
            if (sanitized.bufferedImage() == null) return "";
            try {
                String txt = ocrExtractor.extractText(sanitized.bufferedImage());
                return txt == null ? "" : txt.trim();
            } catch (Exception ex) {
                return "";
            }
        });

        ImageForensicExtraction vision = visionFuture.join();
        String ocrText = ocrFuture.join();

        // 2. Unificar URLs e indicadores de Vision + OCR
        Set<String> urls = new LinkedHashSet<>(vision.extractedUrls());
        Set<String> indicators = new LinkedHashSet<>(vision.extractedIndicators());
        extractMatches(URL_RE, ocrText, urls);
        extractMatches(DOMAIN_RE, ocrText, indicators);
        extractMatches(IPV4_RE, ocrText, indicators);
        extractMatches(SHA256_RE, ocrText, indicators);
        for (String u : urls) {
            try {
                String host = URI.create(u).getHost();
                if (host != null && !host.isBlank()) {
                    indicators.add(host.toLowerCase(Locale.ROOT));
                }
            } catch (Exception ignored) {
                // URL parcial
            }
        }

        // 3. Cruce determinista contra STIX, Reputación externa y Verificador pasivo de enlaces
        List<Map<String, Object>> stixMatches = new ArrayList<>();
        Set<String> seenStix = new LinkedHashSet<>();
        for (String ind : indicators) {
            for (IocIndicatorEntity match : stixCatalogService.lookupIndicator(ind)) {
                String key = match.getIocType() + ":" + match.getNormalizedValue();
                if (seenStix.add(key)) {
                    stixMatches.add(Map.of(
                            "ioc_type", match.getIocType(),
                            "ioc_value", match.getIocValue(),
                            "source_report", match.getSourceReport() == null ? "STIX 2.1" : match.getSourceReport(),
                            "organization", match.getOrganization() == null ? "CTI" : match.getOrganization()
                    ));
                }
            }
        }

        List<Map<String, Object>> reputationHits = new ArrayList<>();
        int repChecked = 0;
        for (String ind : indicators) {
            if (repChecked >= 3) break;
            try {
                reputationHits.add(reputationService.lookupIndicator(ind));
                repChecked++;
            } catch (Exception ignored) {
                // Indicador no compatible
            }
        }

        List<LinkVerifyResponse> linkChecks = new ArrayList<>();
        int linkChecked = 0;
        for (String url : urls) {
            if (linkChecked >= 3) break;
            try {
                linkChecks.add(forensicBridgeService.verifyLink(principal, expedienteId, url));
                linkChecked++;
            } catch (Exception ignored) {
                // Worker forense o URL parcial
            }
        }

        // 4. RAG Híbrido enriquecido (expediente privado + corpus público CTI)
        String ocrSnippet = ocrText.length() > 280 ? ocrText.substring(0, 280) : ocrText;
        String enrichedQuery = (question + " " + vision.visualSummary() + " " + vision.suspectedVector()
                + " " + String.join(" ", indicators) + " " + ocrSnippet).trim();
        if (enrichedQuery.length() > 1800) {
            enrichedQuery = enrichedQuery.substring(0, 1800);
        }

        List<RagCitationDto> combinedCitations = new ArrayList<>();
        if (expedienteId != null) {
            try {
                RagQueryResponse privResp = hybridRagQueryService.queryExpediente(
                        principal,
                        expedienteId,
                        new RagQueryRequest(enrichedQuery, 4)
                );
                if (privResp.citations() != null) {
                    combinedCitations.addAll(privResp.citations());
                }
            } catch (Exception ignored) {
                // No bloquear si el expediente aún no tiene PDFs indexados
            }
        }

        try {
            RagQueryResponse pubResp = publicCorpusRagService.queryPublicCorpus(
                    principal,
                    new PublicCtiQueryRequest(enrichedQuery, 4, null, false)
            );
            if (pubResp.citations() != null) {
                combinedCitations.addAll(pubResp.citations());
            }
        } catch (Exception ignored) {
            // Corpus público vacío o sin coincidencias léxicas
        }

        // 5. Nivel de riesgo y síntesis fundamentada
        String riskLevel = computeRiskLevel(stixMatches, linkChecks, vision.suspectedVector());
        for (Map<String, Object> reputation : reputationHits) {
            String level = String.valueOf(reputation.getOrDefault("riskLevel", "UNKNOWN"));
            if ("CRITICAL".equals(level)) { riskLevel = "CRITICAL"; break; }
            if ("HIGH".equals(level) && !"CRITICAL".equals(riskLevel)) { riskLevel = "HIGH"; }
        }
        String answer = buildGroundedSynthesis(
                vision,
                ocrText,
                new ArrayList<>(urls),
                new ArrayList<>(indicators),
                stixMatches,
                linkChecks,
                combinedCitations,
                riskLevel
        );

        // 6. Auditoría inmutable sin guardar bytes de imagen
        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "MULTIMODAL_THREAT_QUERY",
                expedienteId != null ? "EXPEDIENTE" : "PUBLIC_CTI_CORPUS",
                expedienteId != null ? expedienteId.toString() : "PUBLIC_TRIAGE",
                Map.of(
                        "imageSha256Hash", sanitized.sha256Hash(),
                        "suspectedVector", vision.suspectedVector(),
                        "riskLevel", riskLevel,
                        "stixMatchesCount", stixMatches.size(),
                        "linkChecksCount", linkChecks.size(),
                        "citationsCount", combinedCitations.size()
                )
        );

        return new MultimodalThreatResponse(
                riskLevel,
                sanitized.sha256Hash(),
                vision,
                ocrText,
                new ArrayList<>(urls),
                new ArrayList<>(indicators),
                stixMatches,
                reputationHits,
                linkChecks,
                combinedCitations,
                answer
        );
    }

    private void enforcePublicRateLimit(OmegaPrincipal principal) {
        String key = principal.tenantId() + ":" + principal.userId();
        long now = System.currentTimeMillis();
        Deque<Long> window = publicRateWindows.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > 60_000L) {
                window.pollFirst();
            }
            if (window.size() >= PUBLIC_RATE_LIMIT_PER_MIN) {
                throw new ResponseStatusException(
                        HttpStatus.TOO_MANY_REQUESTS,
                        "Límite de triaje multimodal público alcanzado. Intenta de nuevo en un minuto."
                );
            }
            window.addLast(now);
        }
    }

    private static void extractMatches(Pattern pattern, String text, Set<String> target) {
        if (text == null || text.isBlank()) return;
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            String val = m.group().trim();
            if (!val.isBlank()) {
                target.add(val.toLowerCase(Locale.ROOT));
            }
        }
    }

    private static String computeRiskLevel(
            List<Map<String, Object>> stixMatches,
            List<LinkVerifyResponse> linkChecks,
            String suspectedVector
    ) {
        if (linkChecks.stream().anyMatch(l -> "CRITICAL".equalsIgnoreCase(l.riskLevel()))) {
            return "CRITICAL";
        }
        if (!stixMatches.isEmpty() || linkChecks.stream().anyMatch(l -> "HIGH".equalsIgnoreCase(l.riskLevel()))) {
            return "HIGH";
        }
        if (linkChecks.stream().anyMatch(l -> "MEDIUM".equalsIgnoreCase(l.riskLevel()))
                || "ONE_CLICK_PHISHING".equalsIgnoreCase(suspectedVector)
                || "ZERO_CLICK_VECTOR".equalsIgnoreCase(suspectedVector)
                || "MDM_PROFILE_ABUSE".equalsIgnoreCase(suspectedVector)) {
            return "MEDIUM";
        }
        return "LOW";
    }

    private static String buildGroundedSynthesis(
            ImageForensicExtraction vision,
            String ocrText,
            List<String> urls,
            List<String> indicators,
            List<Map<String, Object>> stixMatches,
            List<LinkVerifyResponse> linkChecks,
            List<RagCitationDto> citations,
            String riskLevel
    ) {
        StringBuilder sb = new StringBuilder();
        sb.append("### Análisis Multimodal (Zero-Retention)\n");
        sb.append("- **Riesgo estimado:** `").append(riskLevel).append("` · **Vector:** `").append(vision.suspectedVector()).append("`\n");
        sb.append("- **Resumen visual:** ").append(vision.visualSummary()).append("\n");
        if (!urls.isEmpty()) {
            sb.append("- **Enlaces detectados:** ").append(String.join(", ", urls)).append("\n");
        }
        if (!indicators.isEmpty()) {
            sb.append("- **Indicadores extraídos:** ").append(String.join(", ", indicators)).append("\n");
        }
        if (!stixMatches.isEmpty()) {
            sb.append("- **Coincidencias STIX 2.1:** ").append(stixMatches.size())
                    .append(" indicador(es) coinciden con infraestructura documentada.\n");
        } else {
            sb.append("- **Coincidencias STIX 2.1:** Sin coincidencias directas en el catálogo local.\n");
        }
        if (!linkChecks.isEmpty()) {
            sb.append("- **Verificación pasiva de enlaces (OWASP + CTI):** ");
            for (LinkVerifyResponse lc : linkChecks) {
                sb.append("[").append(lc.riskLevel()).append("] ").append(lc.verdict()).append("; ");
                if (lc.domainAgeDays() != null) {
                    sb.append(" Dominio registrado hace ").append(lc.domainAgeDays()).append(" días. ");
                }
                if (Boolean.TRUE.equals(lc.freshTlsCertificate())) {
                    sb.append(" Certificado reciente (puede ser renovación legítima). ");
                }
                if (lc.evasionReasons() != null) {
                    for (String reason : lc.evasionReasons()) sb.append(reason).append(" ");
                }
            }
            sb.append("\n");
        }
        if (!citations.isEmpty()) {
            sb.append("- **Metodología y referencias CTI recuperadas:** ");
            int maxC = Math.min(citations.size(), 3);
            for (int i = 0; i < maxC; i++) {
                RagCitationDto c = citations.get(i);
                sb.append("[").append(i + 1).append("] ").append(c.originalFilename())
                        .append(" (pág. ").append(c.pageNumber()).append(") ");
            }
            sb.append("\n");
        }
        if (!ocrText.isBlank()) {
            String snippet = ocrText.length() > 220 ? ocrText.substring(0, 220) + "..." : ocrText;
            sb.append("- **Texto OCR extraído:** `").append(snippet.replace("\n", " ")).append("`\n");
        }
        sb.append("\n**Pasos forenses recomendados:**\n");
        if ("HIGH".equals(riskLevel) || "CRITICAL".equals(riskLevel)) {
            sb.append("1. No interactúes ni abras los enlaces mostrados en la captura.\n");
            sb.append("2. Ejecuta una auditoría del equipo/dispositivo en la pestaña **Equipos** (USB Android/iOS o PC en vivo).\n");
            sb.append("3. Conserva esta evidencia de forma aislada y verifica conexiones de red activas.\n");
        } else {
            sb.append("1. Verifica por otro canal al remitente si la captura corresponde a un mensaje inesperado.\n");
            sb.append("2. Si notas anomalías en el equipo, ejecuta un triaje preventivo en **Equipos**.\n");
        }
        return sb.toString();
    }

    public record MultimodalThreatResponse(
            @JsonProperty("risk_level") String riskLevel,
            @JsonProperty("image_sha256") String imageSha256,
            @JsonProperty("vision_extraction") ImageForensicExtraction visionExtraction,
            @JsonProperty("ocr_text") String ocrText,
            @JsonProperty("extracted_urls") List<String> extractedUrls,
            @JsonProperty("extracted_indicators") List<String> extractedIndicators,
            @JsonProperty("stix_matches") List<Map<String, Object>> stixMatches,
            @JsonProperty("reputation_hits") List<Map<String, Object>> reputationHits,
            @JsonProperty("link_checks") List<LinkVerifyResponse> linkChecks,
            List<RagCitationDto> citations,
            String answer
    ) {
    }
}
