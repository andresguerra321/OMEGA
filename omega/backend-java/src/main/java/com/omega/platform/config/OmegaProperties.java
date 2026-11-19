package com.omega.platform.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "omega")
public record OmegaProperties(
                @Valid Security security,
                @Valid Ingest ingest,
                @Valid Rag rag,
                @Valid ForensicWorker forensicWorker,
                @Valid Cti cti,
                @Valid Ai ai) {

        @ConstructorBinding
        public OmegaProperties {
                if (ai == null) ai = new Ai("openai", null);
        }

        public OmegaProperties(Security security, Ingest ingest, Rag rag, ForensicWorker forensicWorker, Cti cti) {
                this(security, ingest, rag, forensicWorker, cti, new Ai("openai", null));
        }

        public record Ai(@Pattern(regexp = "openai|ollama") String provider, @Valid Ollama ollama) {
                public Ai {
                        if (provider == null) provider = "openai";
                        if (ollama == null) ollama = new Ollama(null, null, null, null);
                }

                public boolean local() { return "ollama".equals(provider); }
        }

        public record Ollama(@NotBlank String baseUrl, @NotBlank String embedModel,
                             @NotBlank String chatModel, @NotBlank String visionModel) {
                public Ollama {
                        if (baseUrl == null) baseUrl = "http://localhost:11434";
                        if (embedModel == null) embedModel = "bge-m3";
                        if (chatModel == null) chatModel = "qwen2.5:14b";
                        if (visionModel == null) visionModel = "qwen2.5vl:7b";
                }
        }

        public record Security(
                        @NotBlank @Size(min = 32, message = "OMEGA_JWT_SECRET debe tener al menos 32 caracteres para HS256") String jwtSecret,
                        @Positive long jwtExpirationSeconds,
                        @NotBlank String jwtIssuer,
                        boolean allowTenantSelfRegistration,
                        String bootstrapSecret,
                        @NotBlank String internalServiceToken) {
        }

        public record Ingest(
                        @NotBlank String tempDir,
                        @Positive long maxPdfBytes,
                        @NotBlank String tesseractDataPath,
                        @Positive long maxImageBytes,
                        @Positive int maxImageDimension) {
                @ConstructorBinding
                public Ingest {
                }

                public Ingest(String tempDir, long maxPdfBytes, String tesseractDataPath) {
                        this(tempDir, maxPdfBytes, tesseractDataPath, 8_388_608L, 4096);
                }
        }

    public record Rag(
            @NotBlank String embeddingProvider,
            @NotBlank String embeddingModel,
            @Positive int embeddingDimensions,
            @NotBlank String openAiBaseUrl,
            String openAiApiKey,
            @Min(1) int openAiBatchSize,
            @Min(0) int openAiMaxRetries,
            @NotBlank String chatModel,
            @Positive int rrfK,
            @Positive double vectorWeight,
            @Positive double lexicalWeight,
            @Min(100) int minChunkTokens,
            @Min(200) int maxChunkTokens,
            @Min(0) int chunkOverlapTokens,
            String groqBaseUrl,
            String groqApiKey,
            String groqModel,
            String omniRouteBaseUrl,
            String omniRouteApiKey,
            String omniRouteModel,
            String customChatProvider,
            String customChatBaseUrl,
            String customChatApiKey,
            String customChatModel
    ) {
        @ConstructorBinding
        public Rag {
        }

        public Rag(
                String embeddingProvider,
                String embeddingModel,
                int embeddingDimensions,
                String openAiBaseUrl,
                String openAiApiKey,
                int openAiBatchSize,
                int openAiMaxRetries,
                String chatModel,
                int rrfK,
                double vectorWeight,
                double lexicalWeight,
                int minChunkTokens,
                int maxChunkTokens,
                int chunkOverlapTokens
        ) {
            this(
                    embeddingProvider,
                    embeddingModel,
                    embeddingDimensions,
                    openAiBaseUrl,
                    openAiApiKey,
                    openAiBatchSize,
                    openAiMaxRetries,
                    chatModel,
                    rrfK,
                    vectorWeight,
                    lexicalWeight,
                    minChunkTokens,
                    maxChunkTokens,
                    chunkOverlapTokens,
                    "https://api.groq.com/openai/v1",
                    "",
                    "openai/gpt-oss-120b",
                    "",
                    "",
                    "auto",
                    "",
                    "",
                    "",
                    ""
            );
        }

        public Rag(
                String embeddingProvider,
                String embeddingModel,
                int embeddingDimensions,
                String openAiBaseUrl,
                String openAiApiKey,
                int openAiBatchSize,
                int openAiMaxRetries,
                String chatModel,
                int rrfK,
                double vectorWeight,
                double lexicalWeight,
                int minChunkTokens,
                int maxChunkTokens,
                int chunkOverlapTokens,
                String groqBaseUrl,
                String groqApiKey,
                String groqModel
        ) {
            this(
                    embeddingProvider,
                    embeddingModel,
                    embeddingDimensions,
                    openAiBaseUrl,
                    openAiApiKey,
                    openAiBatchSize,
                    openAiMaxRetries,
                    chatModel,
                    rrfK,
                    vectorWeight,
                    lexicalWeight,
                    minChunkTokens,
                    maxChunkTokens,
                    chunkOverlapTokens,
                    groqBaseUrl,
                    groqApiKey,
                    groqModel,
                    "",
                    "",
                    "auto",
                    "",
                    "",
                    "",
                    ""
            );
        }

        public Rag(
                String embeddingProvider,
                String embeddingModel,
                int embeddingDimensions,
                String openAiBaseUrl,
                String openAiApiKey,
                int openAiBatchSize,
                int openAiMaxRetries,
                String chatModel,
                int rrfK,
                double vectorWeight,
                double lexicalWeight,
                int minChunkTokens,
                int maxChunkTokens,
                int chunkOverlapTokens,
                String groqBaseUrl,
                String groqApiKey,
                String groqModel,
                String omniRouteBaseUrl,
                String omniRouteApiKey,
                String omniRouteModel
        ) {
            this(
                    embeddingProvider,
                    embeddingModel,
                    embeddingDimensions,
                    openAiBaseUrl,
                    openAiApiKey,
                    openAiBatchSize,
                    openAiMaxRetries,
                    chatModel,
                    rrfK,
                    vectorWeight,
                    lexicalWeight,
                    minChunkTokens,
                    maxChunkTokens,
                    chunkOverlapTokens,
                    groqBaseUrl,
                    groqApiKey,
                    groqModel,
                    omniRouteBaseUrl,
                    omniRouteApiKey,
                    omniRouteModel,
                    "",
                    "",
                    "",
                    ""
            );
        }
    }

    public record ForensicWorker(
            @NotBlank String baseUrl,
            @Positive int connectTimeoutMs,
            @Positive int readTimeoutMs
    ) {
    }

    public record Cti(
            @NotBlank String stixCorpusDir
    ) {
    }
}
