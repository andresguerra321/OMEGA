package com.omega.platform.web;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.cti.PublicSchemaSupport;
import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import java.net.InetAddress;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Gobernanza agregada del sistema: estadísticas del corpus público, aislamiento de tenant
 * Zero-Retention e integridad de auditoría.
 */
@RestController
@RequestMapping("/api/v1/system")
public class SystemController {

    private static final String OS_SCOPE_NOTICE =
            "OMEGA opera en espacio de usuario analizando artefactos post-compromiso y no sustituye parches del sistema operativo ni el Modo Aislamiento (Lockdown Mode) frente a exploits zero-click en kernel.";

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final PublicSchemaSupport publicSchemaSupport;
    private final AuditLogService auditLogService;
    private final OmegaProperties properties;
    private final StixCatalogService stixCatalogService;

    public SystemController(
            NamedParameterJdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService,
            OmegaProperties properties
    ) {
        this(jdbcTemplate, publicSchemaSupport, auditLogService, properties, null);
    }

    @Autowired
    public SystemController(
            NamedParameterJdbcTemplate jdbcTemplate,
            PublicSchemaSupport publicSchemaSupport,
            AuditLogService auditLogService,
            OmegaProperties properties,
            StixCatalogService stixCatalogService
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.publicSchemaSupport = publicSchemaSupport;
        this.auditLogService = auditLogService;
        this.properties = properties;
        this.stixCatalogService = stixCatalogService;
    }

    @GetMapping("/governance")
    @Transactional(readOnly = true)
    public GovernanceResponse governance(@AuthenticationPrincipal OmegaPrincipal principal) {
        long reports = 0L;
        long chunks = 0L;
        long publicIocs = 0L;
        long publicCampaigns = 0L;
        List<IndexedSourceItem> indexedSources = List.of();

        if (publicSchemaSupport.hasTable("public.reports")) {
            reports = queryCount("SELECT COUNT(*) FROM public.reports");
            indexedSources = jdbcTemplate.query(
                    """
                    SELECT title, organization, publication_date, ingested_at, source_url
                    FROM public.reports
                    ORDER BY publication_date DESC NULLS LAST, ingested_at DESC
                    LIMIT 50
                    """,
                    (rs, rowNum) -> new IndexedSourceItem(
                            rs.getString("title"),
                            rs.getString("organization"),
                            rs.getDate("publication_date") != null ? rs.getDate("publication_date").toString() : null,
                            rs.getTimestamp("ingested_at") != null ? rs.getTimestamp("ingested_at").toInstant().toString() : null,
                            rs.getString("source_url")
                    )
            );
        }
        if (publicSchemaSupport.hasTable("public.document_chunks")) {
            chunks += queryCount("SELECT COUNT(*) FROM public.document_chunks");
        }
        if (publicSchemaSupport.hasTable("public.iocs")) {
            publicIocs += queryCount("SELECT COUNT(*) FROM public.iocs");
        }
        if (publicSchemaSupport.hasTable("public.campaigns")) {
            publicCampaigns += queryCount("SELECT COUNT(*) FROM public.campaigns");
        }

        long stixIocs = queryCount("SELECT COUNT(*) FROM omega_rag.ioc_indicators");
        long stixCampaigns = queryCount("SELECT COUNT(*) FROM omega_rag.campaigns");

        UUID tenantId = principal.tenantId();
        MapSqlParameterSource tenantParams = new MapSqlParameterSource("tenantId", tenantId);
        long tenantExpedientes = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.expedientes WHERE tenant_id = :tenantId",
                tenantParams
        );
        long tenantDocuments = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.documents WHERE tenant_id = :tenantId",
                tenantParams
        );
        long tenantChunks = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.document_chunks WHERE tenant_id = :tenantId",
                tenantParams
        );
        long purgedPdfs = queryTenantCount(
                "SELECT COUNT(*) FROM omega_rag.documents WHERE tenant_id = :tenantId AND temp_deleted_at IS NOT NULL",
                tenantParams
        );
        long tenantOsintAssets = publicSchemaSupport.hasTable("omega_rag.osint_monitored_assets")
                ? queryTenantCount(
                        "SELECT COUNT(*) FROM omega_rag.osint_monitored_assets WHERE tenant_id = :tenantId",
                        tenantParams
                )
                : 0L;

        boolean auditChainValid = auditLogService.verifyTenantChain(tenantId).valid();
        StixCatalogService.CatalogFreshnessDto catalogFreshness = stixCatalogService != null
                ? stixCatalogService.getCatalogFreshness()
                : new StixCatalogService.CatalogFreshnessDto("2024-12-16", "2024-12-16", 0, "pr_reviewed_only", false);

        AiEngineStatus aiEngine = resolveAiEngineStatus();

        return new GovernanceResponse(
                tenantId.toString(),
                properties.ai().local() ? "ollama:" + properties.ai().ollama().embedModel() : properties.rag().embeddingModel(),
                auditChainValid,
                new CorpusStats(
                        reports,
                        chunks + tenantChunks,
                        publicIocs + stixIocs,
                        Math.max(publicCampaigns, stixCampaigns)
                ),
                new TenantStats(
                        tenantExpedientes,
                        tenantDocuments,
                        tenantChunks,
                        purgedPdfs,
                        tenantOsintAssets
                ),
                indexedSources,
                Map.of(
                        "pdf_retention", "zero-retention",
                        "forensic_worker", "ram-only-isolated",
                        "public_corpus_scope", "global-read-only",
                        "client_persistence", "volatile-ram-only",
                        "cti_supply_chain", "sha256-manifest-pr-reviewed"
                ),
                catalogFreshness,
                OS_SCOPE_NOTICE,
                aiEngine,
                properties.ai().provider(),
                properties.ai().local()
        );
    }

    private AiEngineStatus resolveAiEngineStatus() {
        if (properties.ai().local()) return new AiEngineStatus(true, "ollama", properties.ai().ollama().chatModel(), false, false, false, false, "");
        OmegaProperties.Rag rag = properties.rag();
        boolean customConfigured = rag.customChatBaseUrl() != null && !rag.customChatBaseUrl().isBlank();
        boolean omniConfigured = rag.omniRouteBaseUrl() != null && !rag.omniRouteBaseUrl().isBlank();
        boolean openAiConfigured = rag.openAiApiKey() != null && !rag.openAiApiKey().isBlank();
        boolean groqConfigured = rag.groqApiKey() != null && !rag.groqApiKey().isBlank();
        String customProvider = (rag.customChatProvider() == null || rag.customChatProvider().isBlank())
                ? "custom"
                : rag.customChatProvider().trim().toLowerCase(Locale.ROOT);

        String activeProvider = "extractive";
        String activeModel = "omega-extractive-fallback";
        if (customConfigured) {
            activeProvider = customProvider;
            activeModel = (rag.customChatModel() == null || rag.customChatModel().isBlank())
                    ? "llama3.2"
                    : rag.customChatModel().trim();
        } else if (omniConfigured) {
            activeProvider = "omniroute";
            activeModel = (rag.omniRouteModel() == null || rag.omniRouteModel().isBlank()) ? "auto" : rag.omniRouteModel().trim();
        } else if (openAiConfigured) {
            activeProvider = "openai";
            activeModel = rag.chatModel();
        } else if (groqConfigured) {
            activeProvider = "groq";
            activeModel = (rag.groqModel() == null || rag.groqModel().isBlank()) ? "openai/gpt-oss-120b" : rag.groqModel().trim();
        }

        return new AiEngineStatus(
                customConfigured || omniConfigured || openAiConfigured || groqConfigured,
                activeProvider,
                activeModel,
                groqConfigured,
                openAiConfigured,
                omniConfigured,
                customConfigured,
                customConfigured ? customProvider : ""
        );
    }

    @PostMapping("/ai-test")
    public AiConnectionTestResponse testAiConnection(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestBody(required = false) AiConnectionTestRequest request
    ) {
        if (principal == null) {
            return new AiConnectionTestResponse(false, 0L, "", List.of(), "Sesión requerida para probar la conexión.");
        }
        if (properties.ai().local()) {
            return new AiConnectionTestResponse(false, 0L, properties.ai().ollama().chatModel(), List.of(),
                    "Modo Soberano Local activo. Las pruebas de endpoints configurables están deshabilitadas; la inferencia usa solo Ollama local.");
        }
        String provider = request == null || request.provider() == null ? "groq" : request.provider().trim().toLowerCase(Locale.ROOT);
        String resolvedUrl = resolveProbeBaseUrl(provider, request == null ? null : request.baseUrl());
        String safetyError = validateProbeTargetUrl(resolvedUrl);
        if (safetyError != null) {
            return new AiConnectionTestResponse(false, 0L, "", List.of(), safetyError);
        }

        String apiKey = resolveProbeApiKey(provider, request == null ? null : request.apiKey());
        String model = request == null || request.model() == null ? "" : request.model().trim();

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(4));
        factory.setReadTimeout(Duration.ofSeconds(12));
        RestClient probeClient = RestClient.builder()
                .baseUrl(resolvedUrl)
                .requestFactory(factory)
                .build();

        long startNs = System.nanoTime();
        // A model list can succeed even when inference is unavailable or the model was removed.
        if (!model.isBlank()) {
            return runFallbackChatPing(probeClient, resolvedUrl, apiKey, model, provider, startNs);
        }
        try {
            ModelsListResponse modelsResp = probeClient.get()
                    .uri("/models")
                    .headers(h -> {
                        if (!apiKey.isBlank()) {
                            h.setBearerAuth(apiKey);
                        }
                    })
                    .retrieve()
                    .body(ModelsListResponse.class);

            long latencyMs = Math.max(1L, (System.nanoTime() - startNs) / 1_000_000L);
            List<String> detected = new ArrayList<>();
            if (modelsResp != null && modelsResp.data() != null) {
                for (ModelItem item : modelsResp.data()) {
                    if (item != null && item.id() != null && !item.id().isBlank()) {
                        detected.add(item.id().trim());
                        if (detected.size() >= 12) break;
                    }
                }
            }
            String summary = detected.isEmpty()
                    ? String.format("Conexión verificada con %s en %d ms.", provider, latencyMs)
                    : String.format("Conexión verificada (%d ms · %d modelos detectados).", latencyMs, detected.size());
            return new AiConnectionTestResponse(true, latencyMs, resolvedUrl, detected, summary);
        } catch (RestClientResponseException httpEx) {
            int code = httpEx.getStatusCode().value();
            if ((code == 404 || code == 405) && !model.isBlank()) {
                return runFallbackChatPing(probeClient, resolvedUrl, apiKey, model, provider, startNs);
            }
            long latencyMs = Math.max(1L, (System.nanoTime() - startNs) / 1_000_000L);
            String detail = code == 401 || code == 403
                    ? "API Key rechazada o faltante (HTTP " + code + ")."
                    : "El servidor respondió HTTP " + code + ".";
            return new AiConnectionTestResponse(false, latencyMs, resolvedUrl, List.of(), detail);
        } catch (Exception ex) {
            long latencyMs = Math.max(1L, (System.nanoTime() - startNs) / 1_000_000L);
            return new AiConnectionTestResponse(
                    false,
                    latencyMs,
                    resolvedUrl,
                    List.of(),
                    "No se pudo conectar con " + resolvedUrl + ". Verifica que el servicio esté activo y accesible."
            );
        }
    }

    private AiConnectionTestResponse runFallbackChatPing(
            RestClient probeClient,
            String resolvedUrl,
            String apiKey,
            String model,
            String provider,
            long startNs
    ) {
        try {
            Map<?, ?> response = probeClient.post()
                    .uri("/chat/completions")
                    .headers(h -> {
                        if (!apiKey.isBlank()) {
                            h.setBearerAuth(apiKey);
                        }
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "model", model,
                            "max_tokens", 128,
                            "messages", List.of(Map.of("role", "user", "content", "Responde solamente OK."))
                    ))
                    .retrieve()
                    .body(Map.class);
            if (response == null || !(response.get("choices") instanceof List<?> choices) || choices.isEmpty()
                    || !(choices.get(0) instanceof Map<?, ?> choice)
                    || !(choice.get("message") instanceof Map<?, ?> message)
                    || !(message.get("content") instanceof String content) || content.isBlank()) {
                return new AiConnectionTestResponse(false, 0L, resolvedUrl, List.of(),
                        "El proveedor respondió, pero el modelo no generó texto. Revisa el modelo o la cuota.");
            }
            long latencyMs = Math.max(1L, (System.nanoTime() - startNs) / 1_000_000L);
            return new AiConnectionTestResponse(
                    true,
                    latencyMs,
                    resolvedUrl,
                    List.of(model),
                    String.format("Conexión verificada con %s (%s) en %d ms.", provider, model, latencyMs)
            );
        } catch (RestClientResponseException ex) {
            long latencyMs = Math.max(1L, (System.nanoTime() - startNs) / 1_000_000L);
            return new AiConnectionTestResponse(false, latencyMs, resolvedUrl, List.of(), "HTTP " + ex.getStatusCode().value() + " al probar el modelo " + model + ".");
        } catch (Exception ex) {
            long latencyMs = Math.max(1L, (System.nanoTime() - startNs) / 1_000_000L);
            return new AiConnectionTestResponse(false, latencyMs, resolvedUrl, List.of(), "Error de red probando " + resolvedUrl + ".");
        }
    }

    private String resolveProbeBaseUrl(String provider, String providedBaseUrl) {
        if (providedBaseUrl != null && !providedBaseUrl.isBlank()) {
            return providedBaseUrl.trim().replaceAll("/+$", "");
        }
        return switch (provider) {
            case "groq" -> "https://api.groq.com/openai/v1";
            case "openai" -> "https://api.openai.com/v1";
            case "gemini" -> "https://generativelanguage.googleapis.com/v1beta/openai";
            case "openrouter" -> "https://openrouter.ai/api/v1";
            case "ollama" -> "http://host.docker.internal:11434/v1";
            case "lmstudio" -> "http://host.docker.internal:1234/v1";
            case "omniroute" -> "http://omniroute:20128/v1";
            default -> properties.rag().customChatBaseUrl() == null ? "" : properties.rag().customChatBaseUrl().trim().replaceAll("/+$", "");
        };
    }

    private String resolveProbeApiKey(String provider, String providedKey) {
        if (providedKey != null && !providedKey.isBlank()) {
            return providedKey.trim();
        }
        OmegaProperties.Rag rag = properties.rag();
        return switch (provider) {
            case "groq" -> rag.groqApiKey() == null ? "" : rag.groqApiKey().trim();
            case "openai" -> rag.openAiApiKey() == null ? "" : rag.openAiApiKey().trim();
            case "omniroute" -> rag.omniRouteApiKey() == null ? "" : rag.omniRouteApiKey().trim();
            default -> rag.customChatApiKey() == null ? "" : rag.customChatApiKey().trim();
        };
    }

    static String validateProbeTargetUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return "Indica la URL base del proveedor (ej. http://host.docker.internal:11434/v1 o https://...).";
        }
        URI uri;
        try {
            uri = URI.create(rawUrl.trim());
        } catch (IllegalArgumentException ex) {
            return "URL base inválida.";
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            return "Solo se admiten endpoints http:// o https://.";
        }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (host.isBlank()) {
            return "La URL debe incluir un host válido.";
        }
        if (host.equals("postgres") || host.equals("omega-db") || host.equals("omega_postgres")
                || host.equals("forensic-worker") || host.equals("omega-api") || host.equals("omega_forensic_worker")
                || host.equals("metadata.google.internal") || host.equals("metadata.goog")
                || host.startsWith("169.254.") || host.equals("100.100.100.200")) {
            return "Destino bloqueado por seguridad interna.";
        }
        try {
            InetAddress addr = InetAddress.getByName(host);
            if (addr.isLinkLocalAddress()) {
                return "Destino link-local bloqueado por seguridad.";
            }
        } catch (Exception ignored) {
            // Host remoto o aún no resoluble; el cliente informará si no conecta
        }
        return null;
    }

    private long queryCount(String sql) {
        Long val = jdbcTemplate.queryForObject(sql, new MapSqlParameterSource(), Long.class);
        return val != null ? val : 0L;
    }

    private long queryTenantCount(String sql, MapSqlParameterSource params) {
        Long val = jdbcTemplate.queryForObject(sql, params, Long.class);
        return val != null ? val : 0L;
    }

    public record CorpusStats(long reports, long chunks, long iocs, long campaigns) {
    }

    public record TenantStats(
            long expedientes,
            long documents,
            long chunks,
            @JsonProperty("zero_retention_purged_pdfs") long zeroRetentionPurgedPdfs,
            @JsonProperty("osint_assets") long osintAssets
    ) {
    }

    public record IndexedSourceItem(
            String title,
            String organization,
            @JsonProperty("publication_date") String publicationDate,
            @JsonProperty("ingested_at") String ingestedAt,
            @JsonProperty("source_url") String sourceUrl
    ) {
    }

    public record AiEngineStatus(
            boolean configured,
            @JsonProperty("active_provider") String activeProvider,
            @JsonProperty("active_model") String activeModel,
            @JsonProperty("groq_configured") boolean groqConfigured,
            @JsonProperty("openai_configured") boolean openaiConfigured,
            @JsonProperty("omniroute_configured") boolean omnirouteConfigured,
            @JsonProperty("custom_configured") boolean customConfigured,
            @JsonProperty("custom_provider") String customProvider
    ) {
    }

    public record AiConnectionTestRequest(
            String provider,
            @JsonProperty("base_url") String baseUrl,
            @JsonProperty("api_key") String apiKey,
            String model
    ) {
    }

    public record AiConnectionTestResponse(
            boolean ok,
            @JsonProperty("latency_ms") long latencyMs,
            @JsonProperty("tested_url") String testedUrl,
            @JsonProperty("detected_models") List<String> detectedModels,
            String message
    ) {
    }

    public record ModelsListResponse(List<ModelItem> data) {
    }

    public record ModelItem(String id) {
    }

    public record GovernanceResponse(
            @JsonProperty("workspace_id") String workspaceId,
            @JsonProperty("embedding_model") String embeddingModel,
            @JsonProperty("audit_chain_valid") boolean auditChainValid,
            @JsonProperty("corpus_stats") CorpusStats corpusStats,
            @JsonProperty("tenant_stats") TenantStats tenantStats,
            @JsonProperty("indexed_sources") List<IndexedSourceItem> indexedSources,
            Map<String, String> guarantees,
            @JsonProperty("catalog_freshness") StixCatalogService.CatalogFreshnessDto catalogFreshness,
            @JsonProperty("os_scope_notice") String osScopeNotice,
            @JsonProperty("ai_engine") AiEngineStatus aiEngine,
            String aiProvider,
            boolean airGappedMode
    ) {
        public GovernanceResponse(
                String workspaceId,
                String embeddingModel,
                boolean auditChainValid,
                CorpusStats corpusStats,
                TenantStats tenantStats,
                List<IndexedSourceItem> indexedSources,
                Map<String, String> guarantees
        ) {
            this(workspaceId, embeddingModel, auditChainValid, corpusStats, tenantStats, indexedSources, guarantees, null, OS_SCOPE_NOTICE, null, "openai", false);
        }

        public GovernanceResponse(
                String workspaceId,
                String embeddingModel,
                boolean auditChainValid,
                CorpusStats corpusStats,
                TenantStats tenantStats,
                List<IndexedSourceItem> indexedSources,
                Map<String, String> guarantees,
                StixCatalogService.CatalogFreshnessDto catalogFreshness,
                String osScopeNotice
        ) {
            this(workspaceId, embeddingModel, auditChainValid, corpusStats, tenantStats, indexedSources, guarantees, catalogFreshness, osScopeNotice, null, "openai", false);
        }
    }
}
