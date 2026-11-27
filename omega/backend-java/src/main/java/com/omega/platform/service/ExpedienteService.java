package com.omega.platform.service;

import com.omega.platform.domain.ClassificationLevel;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.ExpedienteEntity;
import com.omega.platform.domain.ExpedientePermissionEntity;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.repository.ExpedientePermissionRepository;
import com.omega.platform.repository.ExpedienteRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.storage.ObjectStoragePort;
import com.omega.platform.web.dto.ExpedienteDtos.CreateExpedienteRequest;
import com.omega.platform.web.dto.ExpedienteDtos.DocumentMetadataResponse;
import com.omega.platform.web.dto.ExpedienteDtos.ExpedienteDetailResponse;
import com.omega.platform.web.dto.ExpedienteDtos.ExpedienteSummaryResponse;
import com.omega.platform.web.dto.ExpedienteDtos.GrantPermissionRequest;
import com.omega.platform.web.dto.ExpedienteDtos.PermissionResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExpedienteService {

    private final ExpedienteRepository expedienteRepository;
    private final ExpedientePermissionRepository permissionRepository;
    private final DocumentRepository documentRepository;
    private final UserRepository userRepository;
    private final ExpedienteAuthorizationService authorizationService;
    private final AuditLogService auditLogService;
    private final com.omega.platform.security.WorkspaceMfaPolicyService mfaPolicy;
    private final LegalCasePartyService partyService;
    private final ObjectStoragePort objectStoragePort;

    public ExpedienteService(
            ExpedienteRepository expedienteRepository,
            ExpedientePermissionRepository permissionRepository,
            DocumentRepository documentRepository,
            UserRepository userRepository,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService
    ) {
        this(
                expedienteRepository,
                permissionRepository,
                documentRepository,
                userRepository,
                authorizationService,
                auditLogService,
                null,
                null,
                null
        );
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ExpedienteService(
            ExpedienteRepository expedienteRepository,
            ExpedientePermissionRepository permissionRepository,
            DocumentRepository documentRepository,
            UserRepository userRepository,
            ExpedienteAuthorizationService authorizationService,
            AuditLogService auditLogService,
            com.omega.platform.security.WorkspaceMfaPolicyService mfaPolicy,
            LegalCasePartyService partyService,
            @org.springframework.beans.factory.annotation.Autowired(required = false) ObjectStoragePort objectStoragePort
    ) {
        this.expedienteRepository = expedienteRepository;
        this.permissionRepository = permissionRepository;
        this.documentRepository = documentRepository;
        this.userRepository = userRepository;
        this.authorizationService = authorizationService;
        this.auditLogService = auditLogService;
        this.mfaPolicy = mfaPolicy;
        this.partyService = partyService;
        this.objectStoragePort = objectStoragePort;
    }

    @Transactional
    public ExpedienteSummaryResponse createExpediente(OmegaPrincipal principal, CreateExpedienteRequest request) {
        ExpedienteEntity entity = new ExpedienteEntity(
                principal.tenantId(),
                principal.userId(),
                request.title().trim(),
                request.classification() == null ? ClassificationLevel.CONFIDENTIAL : request.classification()
        );
        LegalCaseService.applyCaseSheet(
                entity,
                request.clientName(),
                request.counterpartyName(),
                request.courtName(),
                request.processType(),
                request.caseStage()
        );
        ExpedienteEntity created = expedienteRepository.saveAndFlush(entity);
        if (partyService != null) {
            partyService.syncPrimaryParties(
                    principal.tenantId(),
                    created.getId(),
                    created.getClientName(),
                    created.getCounterpartyName()
            );
        }
        auditLogService.record(principal.tenantId(), principal.userId(), "EXPEDIENTE_CREATED", "EXPEDIENTE",
                created.getId().toString(), Map.of("classification", created.getClassification().name()));
        return toSummary(created);
    }

    @Transactional(readOnly = true)
    public List<ExpedienteSummaryResponse> listAccessibleExpedientes(OmegaPrincipal principal) {
        List<ExpedienteEntity> list = principal.role() == Role.ADMIN
                ? expedienteRepository.findAllByTenantIdOrderByCreatedAtDesc(principal.tenantId())
                : expedienteRepository.findAllAccessibleByUserInTenant(principal.tenantId(), principal.userId());
        return list.stream().map(this::toSummary).toList();
    }

    @Transactional(readOnly = true)
    public ExpedienteDetailResponse getExpedienteDetail(OmegaPrincipal principal, UUID expedienteId) {
        ExpedienteEntity expediente = authorizationService.requireReadAccess(principal, expedienteId);
        List<DocumentMetadataResponse> documents = documentRepository
                .findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(principal.tenantId(), expedienteId)
                .stream()
                .map(this::toDocumentMetadata)
                .toList();

        return new ExpedienteDetailResponse(
                expediente.getId(),
                expediente.getTenantId(),
                expediente.getOwnerUserId(),
                expediente.getTitle(),
                expediente.getClassification(),
                expediente.getCreatedAt(),
                documents,
                expediente.getClientName(),
                expediente.getCounterpartyName(),
                expediente.getCourtName(),
                expediente.getProcessType(),
                expediente.getCaseStage()
        );
    }

    @Transactional
    public PermissionResponse grantPermission(
            OmegaPrincipal principal,
            UUID expedienteId,
            GrantPermissionRequest request
    ) {
        ExpedienteEntity expediente = authorizationService.requirePermissionManagementAccess(principal, expedienteId);
        if (mfaPolicy != null) mfaPolicy.requireRecentMfaIfOrganizationalLegal(principal);
        userRepository.findActiveWorkspaceMember(request.userId(), principal.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Usuario destino no encontrado en el tenant actual"));
        UserEntity targetUser = userRepository.findById(request.userId())
                .filter(UserEntity::isActive)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario destino no encontrado en el tenant actual"));

        var previous = permissionRepository
                .findByTenantIdAndExpedienteIdAndUserId(principal.tenantId(), expediente.getId(), targetUser.getId());
        String previousPermission = previous.map(p -> p.getPermission().name()).orElse("NONE");
        ExpedientePermissionEntity perm = previous
                .map(existing -> {
                    existing.setPermission(request.permission());
                    return permissionRepository.save(existing);
                })
                .orElseGet(() -> permissionRepository.save(new ExpedientePermissionEntity(
                        principal.tenantId(),
                        expediente.getId(),
                        targetUser.getId(),
                        request.permission()
                )));

        auditLogService.record(principal.tenantId(), principal.userId(), "EXPEDIENTE_PERMISSION_GRANTED", "EXPEDIENTE",
                expedienteId.toString(), Map.of("userId", targetUser.getId().toString(),
                        "permission", perm.getPermission().name(), "previousPermission", previousPermission));
        return toPermissionResponse(perm);
    }

    @Transactional(readOnly = true)
    public List<PermissionResponse> listPermissions(OmegaPrincipal principal, UUID expedienteId) {
        authorizationService.requirePermissionManagementAccess(principal, expedienteId);
        return permissionRepository.findAllByTenantIdAndExpedienteIdOrderByGrantedAtAsc(principal.tenantId(), expedienteId)
                .stream().map(this::toPermissionResponse).toList();
    }

    @Transactional
    public void revokePermission(OmegaPrincipal principal, UUID expedienteId, UUID userId) {
        authorizationService.requirePermissionManagementAccess(principal, expedienteId);
        if (mfaPolicy != null) mfaPolicy.requireRecentMfaIfOrganizationalLegal(principal);
        ExpedientePermissionEntity permission = permissionRepository
                .findByTenantIdAndExpedienteIdAndUserId(principal.tenantId(), expedienteId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Permiso no encontrado"));
        permissionRepository.delete(permission);
        auditLogService.record(principal.tenantId(), principal.userId(), "EXPEDIENTE_PERMISSION_REVOKED", "EXPEDIENTE",
                expedienteId.toString(), Map.of("userId", userId.toString(), "permission", permission.getPermission().name()));
    }

    private PermissionResponse toPermissionResponse(ExpedientePermissionEntity perm) {
        return new PermissionResponse(
                perm.getId(),
                perm.getTenantId(),
                perm.getExpedienteId(),
                perm.getUserId(),
                perm.getPermission(),
                perm.getGrantedAt()
        );
    }

    @Transactional
    public void deleteExpediente(OmegaPrincipal principal, UUID expedienteId) {
        ExpedienteEntity expediente = authorizationService.requireWriteAccess(principal, expedienteId);
        if (mfaPolicy != null) mfaPolicy.requireRecentMfaIfOrganizationalLegal(principal);
        List<DocumentEntity> storedDocs = documentRepository
                .findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(principal.tenantId(), expedienteId)
                .stream()
                .filter(d -> d.getStorageBucket() != null && !d.getStorageBucket().isBlank()
                        && d.getStorageObjectKey() != null && !d.getStorageObjectKey().isBlank())
                .toList();
        expedienteRepository.delete(expediente);
        expedienteRepository.flush();
        int purgedObjectsCount = 0;
        if (objectStoragePort != null) {
            for (DocumentEntity doc : storedDocs) {
                objectStoragePort.deleteObject(doc.getStorageBucket(), doc.getStorageObjectKey());
                purgedObjectsCount++;
            }
        }
        auditLogService.record(principal.tenantId(), principal.userId(), "EXPEDIENTE_DELETED", "EXPEDIENTE",
                expedienteId.toString(), Map.of("purgedObjectsCount", purgedObjectsCount));
    }

    private ExpedienteSummaryResponse toSummary(ExpedienteEntity entity) {
        return new ExpedienteSummaryResponse(
                entity.getId(),
                entity.getTenantId(),
                entity.getOwnerUserId(),
                entity.getTitle(),
                entity.getClassification(),
                entity.getCreatedAt(),
                entity.getClientName(),
                entity.getCounterpartyName(),
                entity.getCourtName(),
                entity.getProcessType(),
                entity.getCaseStage()
        );
    }

    private DocumentMetadataResponse toDocumentMetadata(DocumentEntity doc) {
        return new DocumentMetadataResponse(
                doc.getId(),
                doc.getTenantId(),
                doc.getExpedienteId(),
                doc.getOriginalFilename(),
                doc.getSha256Hash(),
                doc.getTotalPages(),
                doc.getEmbeddingModel(),
                doc.isOcrApplied(),
                doc.getStatus(),
                doc.getCreatedAt(),
                doc.getTempDeletedAt()
        );
    }
}
