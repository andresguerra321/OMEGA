package com.omega.platform.web.dto;

import com.omega.platform.domain.ClassificationLevel;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.ExpedientePermissionLevel;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ExpedienteDtos {

    private ExpedienteDtos() {
    }

    public record CreateExpedienteRequest(
            @NotBlank @Size(min = 3, max = 255) String title,
            ClassificationLevel classification
    ) {
    }

    public record GrantPermissionRequest(
            @NotNull UUID userId,
            @NotNull ExpedientePermissionLevel permission
    ) {
    }

    public record ExpedienteSummaryResponse(
            UUID id,
            UUID tenantId,
            UUID ownerUserId,
            String title,
            ClassificationLevel classification,
            Instant createdAt
    ) {
    }

    public record DocumentMetadataResponse(
            UUID id,
            UUID tenantId,
            UUID expedienteId,
            String originalFilename,
            String sha256Hash,
            int totalPages,
            String embeddingModel,
            boolean ocrApplied,
            DocumentStatus status,
            Instant createdAt,
            Instant tempDeletedAt
    ) {
    }

    public record ExpedienteDetailResponse(
            UUID id,
            UUID tenantId,
            UUID ownerUserId,
            String title,
            ClassificationLevel classification,
            Instant createdAt,
            List<DocumentMetadataResponse> documents
    ) {
    }

    public record PermissionResponse(
            UUID id,
            UUID tenantId,
            UUID expedienteId,
            UUID userId,
            ExpedientePermissionLevel permission,
            Instant grantedAt
    ) {
    }
}
