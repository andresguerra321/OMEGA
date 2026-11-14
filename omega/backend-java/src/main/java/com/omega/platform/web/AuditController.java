package com.omega.platform.web;

import com.omega.platform.domain.AuditLogEntity;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.AuditLogService.ChainVerificationResult;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/audit-logs")
@PreAuthorize("hasRole('ADMIN')")
public class AuditController {

    private final AuditLogService auditLogService;

    public AuditController(AuditLogService auditLogService) {
        this.auditLogService = auditLogService;
    }

    @GetMapping
    public List<AuditLogResponse> recent(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @RequestParam(defaultValue = "50") int limit
    ) {
        return auditLogService.listRecent(principal.tenantId(), limit).stream()
                .map(AuditLogResponse::fromEntity)
                .toList();
    }

    @GetMapping("/verify")
    public ChainVerificationResult verify(@AuthenticationPrincipal OmegaPrincipal principal) {
        return auditLogService.verifyTenantChain(principal.tenantId());
    }

    public record AuditLogResponse(
            UUID id,
            Long chainSeq,
            UUID tenantId,
            UUID actorUserId,
            String action,
            String resourceType,
            String resourceId,
            String metadataJson,
            String previousHash,
            String currentHash,
            Instant createdAt
    ) {
        static AuditLogResponse fromEntity(AuditLogEntity e) {
            return new AuditLogResponse(
                    e.getId(),
                    e.getChainSeq(),
                    e.getTenantId(),
                    e.getActorUserId(),
                    e.getAction(),
                    e.getResourceType(),
                    e.getResourceId(),
                    e.getMetadataJson(),
                    e.getPreviousHash(),
                    e.getCurrentHash(),
                    e.getCreatedAt()
            );
        }
    }
}
