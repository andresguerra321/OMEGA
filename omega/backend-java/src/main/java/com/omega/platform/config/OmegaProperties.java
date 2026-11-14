package com.omega.platform.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "omega")
public record OmegaProperties(
        @Valid Security security,
        @Valid Ingest ingest,
        @Valid Rag rag,
        @Valid ForensicWorker forensicWorker
) {

    public record Security(
            @NotBlank @Size(min = 32, message = "OMEGA_JWT_SECRET debe tener al menos 32 caracteres para HS256")
            String jwtSecret,
            @Positive long jwtExpirationSeconds,
            @NotBlank String jwtIssuer,
            boolean allowTenantSelfRegistration,
            String bootstrapSecret
    ) {
    }

    public record Ingest(
            @NotBlank String tempDir,
            @Positive long maxPdfBytes,
            @NotBlank String tesseractDataPath
    ) {
    }

    public record Rag(
            @NotBlank String embeddingModel,
            @Positive int embeddingDimensions,
            @Min(100) int minChunkTokens,
            @Min(200) int maxChunkTokens,
            @Min(0) int chunkOverlapTokens
    ) {
    }

    public record ForensicWorker(
            @NotBlank String baseUrl,
            @Positive int connectTimeoutMs,
            @Positive int readTimeoutMs
    ) {
    }
}
