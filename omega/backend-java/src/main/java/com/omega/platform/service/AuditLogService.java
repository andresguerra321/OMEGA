package com.omega.platform.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.AuditLogEntity;
import com.omega.platform.repository.AuditLogRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Servicio de trazabilidad probatoria inmutable con encadenamiento SHA-256 serializado por tenant.
 */
@Service
public class AuditLogService {

    public static final String GENESIS_HASH = "0".repeat(64);

    private final AuditLogRepository auditLogRepository;
    private final ObjectMapper objectMapper;

    public AuditLogService(AuditLogRepository auditLogRepository, ObjectMapper objectMapper) {
        this.auditLogRepository = auditLogRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public AuditLogEntity record(
            UUID tenantId,
            UUID actorUserId,
            String action,
            String resourceType,
            String resourceId,
            Map<String, ?> metadata
    ) {
        auditLogRepository.lockTenantChain(tenantId.toString());

        String previousHash = auditLogRepository.findFirstByTenantIdOrderByChainSeqDesc(tenantId)
                .map(AuditLogEntity::getCurrentHash)
                .orElse(GENESIS_HASH);

        Instant createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
        String metadataJson = serializeMetadata(metadata);
        String currentHash = computeChainHash(
                previousHash,
                tenantId,
                actorUserId,
                action,
                resourceType,
                resourceId,
                metadataJson,
                createdAt
        );

        AuditLogEntity entry = new AuditLogEntity(
                tenantId,
                actorUserId,
                action,
                resourceType,
                resourceId,
                metadataJson,
                previousHash,
                currentHash,
                createdAt
        );
        return auditLogRepository.saveAndFlush(entry);
    }

    @Transactional(readOnly = true)
    public List<AuditLogEntity> listRecent(UUID tenantId, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, 200));
        return auditLogRepository.findAllByTenantIdOrderByChainSeqDesc(tenantId, PageRequest.of(0, safeLimit));
    }

    @Transactional(readOnly = true)
    public ChainVerificationResult verifyTenantChain(UUID tenantId) {
        List<AuditLogEntity> entries = auditLogRepository.findAllByTenantIdOrderByChainSeqAsc(tenantId);
        String expectedPrev = GENESIS_HASH;
        for (int i = 0; i < entries.size(); i++) {
            AuditLogEntity e = entries.get(i);
            if (!expectedPrev.equals(e.getPreviousHash())) {
                return new ChainVerificationResult(false, i, entries.size(), e.getId(), "Ruptura en previous_hash");
            }
            String recomputed = computeChainHash(
                    e.getPreviousHash(),
                    e.getTenantId(),
                    e.getActorUserId(),
                    e.getAction(),
                    e.getResourceType(),
                    e.getResourceId(),
                    e.getMetadataJson(),
                    e.getCreatedAt().truncatedTo(ChronoUnit.MICROS)
            );
            if (!recomputed.equals(e.getCurrentHash())) {
                return new ChainVerificationResult(false, i, entries.size(), e.getId(), "Hash SHA-256 inconsistente");
            }
            expectedPrev = e.getCurrentHash();
        }
        return new ChainVerificationResult(true, entries.size(), entries.size(), null, "Cadena íntegra");
    }

    static String computeChainHash(
            String previousHash,
            UUID tenantId,
            UUID actorUserId,
            String action,
            String resourceType,
            String resourceId,
            String metadataJson,
            Instant createdAt
    ) {
        String canonical = String.join(
                "|",
                previousHash,
                tenantId.toString(),
                actorUserId == null ? "system" : actorUserId.toString(),
                action,
                resourceType,
                resourceId == null ? "" : resourceId,
                metadataJson,
                createdAt.toString()
        );
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible en JVM", ex);
        }
    }

    private String serializeMetadata(Map<String, ?> metadata) {
        if (metadata == null || metadata.isEmpty()) {
            return "{}";
        }
        try {
            return objectMapper.writeValueAsString(metadata);
        } catch (JsonProcessingException ex) {
            return "{\"serializationError\":true}";
        }
    }

    public record ChainVerificationResult(
            boolean valid,
            int verifiedCount,
            int totalEntries,
            UUID brokenEntryId,
            String detail
    ) {
    }
}
