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
import com.omega.platform.web.dto.ExpedienteDtos.CreateExpedienteRequest;
import com.omega.platform.web.dto.ExpedienteDtos.DocumentMetadataResponse;
import com.omega.platform.web.dto.ExpedienteDtos.ExpedienteDetailResponse;
import com.omega.platform.web.dto.ExpedienteDtos.ExpedienteSummaryResponse;
import com.omega.platform.web.dto.ExpedienteDtos.GrantPermissionRequest;
import com.omega.platform.web.dto.ExpedienteDtos.PermissionResponse;
import java.util.List;
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

    public ExpedienteService(
            ExpedienteRepository expedienteRepository,
            ExpedientePermissionRepository permissionRepository,
            DocumentRepository documentRepository,
            UserRepository userRepository,
            ExpedienteAuthorizationService authorizationService
    ) {
        this.expedienteRepository = expedienteRepository;
        this.permissionRepository = permissionRepository;
        this.documentRepository = documentRepository;
        this.userRepository = userRepository;
        this.authorizationService = authorizationService;
    }

    @Transactional
    public ExpedienteSummaryResponse createExpediente(OmegaPrincipal principal, CreateExpedienteRequest request) {
        ExpedienteEntity created = expedienteRepository.save(new ExpedienteEntity(
                principal.tenantId(),
                principal.userId(),
                request.title().trim(),
                request.classification() == null ? ClassificationLevel.CONFIDENTIAL : request.classification()
        ));
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
                documents
        );
    }

    @Transactional
    public PermissionResponse grantPermission(
            OmegaPrincipal principal,
            UUID expedienteId,
            GrantPermissionRequest request
    ) {
        ExpedienteEntity expediente = authorizationService.requireWriteAccess(principal, expedienteId);
        UserEntity targetUser = userRepository.findByIdAndTenantId(request.userId(), principal.tenantId())
                .filter(UserEntity::isActive)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario destino no encontrado en el tenant actual"));

        ExpedientePermissionEntity perm = permissionRepository
                .findByTenantIdAndExpedienteIdAndUserId(principal.tenantId(), expediente.getId(), targetUser.getId())
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

        return new PermissionResponse(
                perm.getId(),
                perm.getTenantId(),
                perm.getExpedienteId(),
                perm.getUserId(),
                perm.getPermission(),
                perm.getGrantedAt()
        );
    }

    private ExpedienteSummaryResponse toSummary(ExpedienteEntity entity) {
        return new ExpedienteSummaryResponse(
                entity.getId(),
                entity.getTenantId(),
                entity.getOwnerUserId(),
                entity.getTitle(),
                entity.getClassification(),
                entity.getCreatedAt()
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
