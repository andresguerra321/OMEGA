package com.omega.platform.web.dto;

import com.omega.platform.domain.ClassificationLevel;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.domain.ExpedientePermissionLevel;
import com.omega.platform.service.LegalCaseService;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ExpedienteDtos {

    private ExpedienteDtos() {
    }

    public record CreateExpedienteRequest(
            @NotBlank @Size(min = 3, max = 255) String title,
            ClassificationLevel classification,
            @Size(max = 200) String clientName,
            @Size(max = 200) String counterpartyName,
            @Size(max = 200) String courtName,
            @Pattern(regexp = "CIVIL|LABORAL|PENAL|FAMILIA|ADMINISTRATIVO|COMERCIAL|OTRO",
                    message = "Tipo de proceso inválido") String processType,
            @Size(max = 60) String caseStage
    ) {
        public CreateExpedienteRequest {
            title = title == null ? null : title.strip();
            clientName = LegalCaseService.normalizeOptional(clientName);
            counterpartyName = LegalCaseService.normalizeOptional(counterpartyName);
            courtName = LegalCaseService.normalizeOptional(courtName);
            processType = LegalCaseService.normalizeProcessType(processType);
            caseStage = LegalCaseService.normalizeOptional(caseStage);
        }

        public CreateExpedienteRequest(String title, ClassificationLevel classification) {
            this(title, classification, null, null, null, null, null);
        }
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
            Instant createdAt,
            String clientName,
            String counterpartyName,
            String courtName,
            String processType,
            String caseStage
    ) {
        public ExpedienteSummaryResponse(
                UUID id,
                UUID tenantId,
                UUID ownerUserId,
                String title,
                ClassificationLevel classification,
                Instant createdAt
        ) {
            this(id, tenantId, ownerUserId, title, classification, createdAt, null, null, null, null, null);
        }
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
            List<DocumentMetadataResponse> documents,
            String clientName,
            String counterpartyName,
            String courtName,
            String processType,
            String caseStage
    ) {
        public ExpedienteDetailResponse(
                UUID id,
                UUID tenantId,
                UUID ownerUserId,
                String title,
                ClassificationLevel classification,
                Instant createdAt,
                List<DocumentMetadataResponse> documents
        ) {
            this(id, tenantId, ownerUserId, title, classification, createdAt, documents, null, null, null, null, null);
        }
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
