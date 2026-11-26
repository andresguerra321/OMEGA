package com.omega.platform.service;

import com.omega.platform.domain.ApiTokenEntity;
import com.omega.platform.domain.RepoScanUsageEntity;
import com.omega.platform.repository.ApiTokenRepository;
import com.omega.platform.repository.RepoScanUsageRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.saas.SubscriptionEntity;
import com.omega.platform.security.Role;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ApiTokenService {

    public static final String TOKEN_PREFIX = "omega_scan_";
    public static final String SCOPE_REPO_SCAN = "REPO_SCAN";

    private static final Map<String, Integer> PLAN_MONTHLY_SCAN_QUOTA = Map.of(
            "PERSONAL", 30,
            "PRO", 300,
            "ENTERPRISE", 3000
    );

    private final ApiTokenRepository apiTokenRepository;
    private final RepoScanUsageRepository repoScanUsageRepository;
    private final TenantRepository tenantRepository;
    private final AuditLogService auditLogService;
    private final SecureRandom secureRandom = new SecureRandom();

    @Autowired(required = false)
    private CommercialSaasService commercialSaasService;

    @Autowired(required = false)
    private NamedParameterJdbcTemplate jdbc;

    @Autowired(required = false)
    private com.omega.platform.repository.UserRepository userRepository;

    public ApiTokenService(
            ApiTokenRepository apiTokenRepository,
            RepoScanUsageRepository repoScanUsageRepository,
            TenantRepository tenantRepository,
            AuditLogService auditLogService
    ) {
        this.apiTokenRepository = apiTokenRepository;
        this.repoScanUsageRepository = repoScanUsageRepository;
        this.tenantRepository = tenantRepository;
        this.auditLogService = auditLogService;
    }

    @Transactional
    public CreatedApiToken createToken(
            UUID tenantId,
            UUID userId,
            String name,
            Integer expiresInDays,
            Integer maxUses
    ) {
        String cleanName = name == null ? "" : name.trim();
        if (cleanName.isEmpty() || cleanName.length() > 120) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre del token debe tener entre 1 y 120 caracteres");
        }
        if (maxUses != null && maxUses <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El límite de usos debe ser mayor a 0");
        }
        if (expiresInDays != null && (expiresInDays <= 0 || expiresInDays > 365)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La expiración debe estar entre 1 y 365 días");
        }

        byte[] randomBytes = new byte[32];
        secureRandom.nextBytes(randomBytes);
        String rawToken = TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        String tokenHash = sha256Hex(rawToken);
        String displayPrefix = rawToken.substring(0, Math.min(rawToken.length(), 18)) + "...";
        Instant now = Instant.now();
        Instant expiresAt = expiresInDays != null ? now.plus(expiresInDays, ChronoUnit.DAYS) : null;

        ApiTokenEntity entity = new ApiTokenEntity(
                UUID.randomUUID(),
                tenantId,
                userId,
                cleanName,
                displayPrefix,
                tokenHash,
                SCOPE_REPO_SCAN,
                maxUses,
                expiresAt,
                now
        );
        apiTokenRepository.save(entity);

        auditLogService.record(
                tenantId,
                userId,
                "API_TOKEN_CREATED",
                "API_TOKEN",
                entity.getId().toString(),
                Map.of(
                        "name", cleanName,
                        "scope", SCOPE_REPO_SCAN,
                        "tokenPrefix", displayPrefix,
                        "hasExpiration", expiresAt != null,
                        "hasMaxUses", maxUses != null
                )
        );

        return new CreatedApiToken(toView(entity), rawToken);
    }

    @Transactional(readOnly = true)
    public List<ApiTokenView> listTokens(UUID tenantId) {
        return apiTokenRepository.findAllByTenantIdOrderByCreatedAtDesc(tenantId).stream()
                .map(ApiTokenService::toView)
                .toList();
    }

    @Transactional
    public ApiTokenView revokeToken(UUID tenantId, UUID actorUserId, Role actorRole, UUID tokenId) {
        ApiTokenEntity entity = apiTokenRepository.findByIdAndTenantId(tokenId, tenantId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Token de API no encontrado"));

        if (actorRole != Role.ADMIN && !actorUserId.equals(entity.getCreatedByUserId())) {
            throw new AccessDeniedException("Solo un ADMIN o el creador puede revocar este token");
        }
        if (entity.getRevokedAt() == null) {
            entity.setRevokedAt(Instant.now());
            apiTokenRepository.save(entity);
            auditLogService.record(
                    tenantId,
                    actorUserId,
                    "API_TOKEN_REVOKED",
                    "API_TOKEN",
                    entity.getId().toString(),
                    Map.of("tokenPrefix", entity.getTokenPrefix())
            );
        }
        return toView(entity);
    }

    @Transactional
    public Optional<AuthenticatedApiToken> authenticate(String rawToken) {
        if (rawToken == null || !rawToken.startsWith(TOKEN_PREFIX)) {
            return Optional.empty();
        }
        String hash = sha256Hex(rawToken);
        Optional<ApiTokenEntity> found = apiTokenRepository.findByTokenHash(hash);
        if (found.isEmpty()) {
            return Optional.empty();
        }
        ApiTokenEntity token = found.get();
        Instant now = Instant.now();
        if (token.getRevokedAt() != null) {
            return Optional.empty();
        }
        if (token.getExpiresAt() != null && !token.getExpiresAt().isAfter(now)) {
            return Optional.empty();
        }
        if (token.getMaxUses() != null && token.getUsesCount() >= token.getMaxUses()) {
            return Optional.empty();
        }
        if (tenantRepository.findByIdAndActiveTrue(token.getTenantId()).isEmpty()) {
            return Optional.empty();
        }
        if (userRepository != null) {
            Optional<Role> creatorRole = userRepository.findActiveWorkspaceRole(
                    token.getCreatedByUserId(),
                    token.getTenantId()
            );
            if (creatorRole.isEmpty() || creatorRole.get() == Role.CLIENT) {
                apiTokenRepository.revokeActiveTokensByTenantAndCreator(
                        token.getTenantId(),
                        token.getCreatedByUserId(),
                        now
                );
                return Optional.empty();
            }
        }
        return Optional.of(new AuthenticatedApiToken(
                token.getId(),
                token.getTenantId(),
                token.getCreatedByUserId(),
                token.getScope()
        ));
    }

    @Transactional(readOnly = true)
    public boolean hasAvailableMonthlyQuota(UUID tenantId) {
        int monthlyQuota = resolveMonthlyScanQuota(tenantId);
        String periodYm = YearMonth.now(ZoneOffset.UTC).toString();
        return repoScanUsageRepository.findByTenantIdAndPeriodYm(tenantId, periodYm)
                .map(u -> u.getScansUsed() < monthlyQuota)
                .orElse(true);
    }

    @Transactional
    public boolean tryReserveMonthlyScanQuota(UUID tenantId) {
        int monthlyQuota = resolveMonthlyScanQuota(tenantId);
        String periodYm = YearMonth.now(ZoneOffset.UTC).toString();
        Instant now = Instant.now();
        if (jdbc != null) {
            int updated = jdbc.update(
                    """
                    INSERT INTO omega_rag.repo_scan_usage (id, tenant_id, period_ym, scans_used, updated_at)
                    VALUES (:id, :tenantId, :periodYm, 1, :now)
                    ON CONFLICT (tenant_id, period_ym) DO UPDATE
                        SET scans_used = omega_rag.repo_scan_usage.scans_used + 1,
                            updated_at = EXCLUDED.updated_at
                        WHERE omega_rag.repo_scan_usage.scans_used < :quota
                    """,
                    Map.of(
                            "id", UUID.randomUUID(),
                            "tenantId", tenantId,
                            "periodYm", periodYm,
                            "now", java.sql.Timestamp.from(now),
                            "quota", monthlyQuota
                    )
            );
            return updated == 1;
        }
        RepoScanUsageEntity usage = repoScanUsageRepository.findByTenantIdAndPeriodYm(tenantId, periodYm)
                .orElseGet(() -> new RepoScanUsageEntity(UUID.randomUUID(), tenantId, periodYm, 0, now));
        if (usage.getScansUsed() >= monthlyQuota) {
            return false;
        }
        usage.setScansUsed(usage.getScansUsed() + 1);
        usage.setUpdatedAt(now);
        repoScanUsageRepository.save(usage);
        return true;
    }

    @Transactional
    public void releaseMonthlyScanQuota(UUID tenantId) {
        String periodYm = YearMonth.now(ZoneOffset.UTC).toString();
        Instant now = Instant.now();
        if (jdbc != null) {
            jdbc.update(
                    """
                    UPDATE omega_rag.repo_scan_usage
                    SET scans_used = GREATEST(0, scans_used - 1), updated_at = :now
                    WHERE tenant_id = :tenantId AND period_ym = :periodYm
                    """,
                    Map.of(
                            "tenantId", tenantId,
                            "periodYm", periodYm,
                            "now", java.sql.Timestamp.from(now)
                    )
            );
            return;
        }
        repoScanUsageRepository.findByTenantIdAndPeriodYm(tenantId, periodYm).ifPresent(u -> {
            if (u.getScansUsed() > 0) {
                u.setScansUsed(u.getScansUsed() - 1);
                u.setUpdatedAt(now);
                repoScanUsageRepository.save(u);
            }
        });
    }

    @Transactional
    public void consumeTenantMonthlyScanQuota(UUID tenantId) {
        consumeScanQuotaAndTokenUse(tenantId, null);
    }

    @Transactional
    public void consumeScanQuotaAndTokenUse(UUID tenantId, UUID apiTokenIdOrNull) {
        int monthlyQuota = resolveMonthlyScanQuota(tenantId);
        String periodYm = YearMonth.now(ZoneOffset.UTC).toString();
        Instant now = Instant.now();

        // B-06: Consumo atómico de cuota mensual sin ventana TOCTOU
        int quotaRowsUpdated;
        if (monthlyQuota <= 0) {
            quotaRowsUpdated = 0;
        } else if (jdbc != null) {
            quotaRowsUpdated = jdbc.update(
                    """
                    INSERT INTO omega_rag.repo_scan_usage (id, tenant_id, period_ym, scans_used, updated_at)
                    VALUES (:id, :tenantId, :periodYm, 1, :now)
                    ON CONFLICT (tenant_id, period_ym) DO UPDATE
                        SET scans_used = omega_rag.repo_scan_usage.scans_used + 1,
                            updated_at = EXCLUDED.updated_at
                        WHERE omega_rag.repo_scan_usage.scans_used < :quota
                    """,
                    Map.of(
                            "id", UUID.randomUUID(),
                            "tenantId", tenantId,
                            "periodYm", periodYm,
                            "now", java.sql.Timestamp.from(now),
                            "quota", monthlyQuota
                    )
            );
        } else {
            quotaRowsUpdated = repoScanUsageRepository.incrementScansUsedAtomically(tenantId, periodYm, monthlyQuota, now);
            if (quotaRowsUpdated == 0 && repoScanUsageRepository.findByTenantIdAndPeriodYm(tenantId, periodYm).isEmpty()) {
                repoScanUsageRepository.save(new RepoScanUsageEntity(UUID.randomUUID(), tenantId, periodYm, 1, now));
                quotaRowsUpdated = 1;
            }
        }
        if (quotaRowsUpdated != 1) {
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "Cuota mensual de escaneos de repositorio agotada para el plan actual");
        }

        if (apiTokenIdOrNull != null) {
            // B-06: Consumo atómico de usos del token con guarda WHERE (max_uses IS NULL OR uses_count < max_uses)
            int tokenRowsUpdated = apiTokenRepository.incrementUseAtomically(apiTokenIdOrNull, tenantId, now);
            if (tokenRowsUpdated != 1) {
                ApiTokenEntity token = apiTokenRepository.findByIdAndTenantId(apiTokenIdOrNull, tenantId)
                        .orElseThrow(() -> new AccessDeniedException("Token de API inexistente"));
                if (token.getRevokedAt() != null
                        || (token.getExpiresAt() != null && !token.getExpiresAt().isAfter(now))) {
                    throw new AccessDeniedException("Token de API revocado o expirado");
                }
                throw new ResponseStatusException(
                        HttpStatus.TOO_MANY_REQUESTS,
                        "El token de API alcanzó su límite máximo de usos");
            }

            ApiTokenEntity updatedToken = apiTokenRepository.findByIdAndTenantId(apiTokenIdOrNull, tenantId).orElse(null);
            if (updatedToken != null) {
                auditLogService.record(
                        tenantId,
                        updatedToken.getCreatedByUserId(),
                        "API_TOKEN_SCAN_USED",
                        "API_TOKEN",
                        updatedToken.getId().toString(),
                        Map.of("usesCount", updatedToken.getUsesCount(), "periodYm", periodYm)
                );
            }
        }
    }

    public int resolveMonthlyScanQuota(UUID tenantId) {
        if (commercialSaasService == null) {
            return PLAN_MONTHLY_SCAN_QUOTA.get("PERSONAL");
        }
        SubscriptionEntity sub = commercialSaasService.getOrProvisionSubscription(tenantId);
        if (sub == null || sub.getPlanCode() == null) {
            return PLAN_MONTHLY_SCAN_QUOTA.get("PERSONAL");
        }
        return PLAN_MONTHLY_SCAN_QUOTA.getOrDefault(sub.getPlanCode().toUpperCase(), 30);
    }

    public static String sha256Hex(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible", ex);
        }
    }

    private static ApiTokenView toView(ApiTokenEntity e) {
        return new ApiTokenView(
                e.getId(),
                e.getName(),
                e.getTokenPrefix(),
                e.getScope(),
                e.getUsesCount(),
                e.getMaxUses(),
                e.getExpiresAt(),
                e.getRevokedAt(),
                e.getLastUsedAt(),
                e.getCreatedAt()
        );
    }

    public record ApiTokenView(
            UUID id,
            String name,
            String tokenPrefix,
            String scope,
            int usesCount,
            Integer maxUses,
            Instant expiresAt,
            Instant revokedAt,
            Instant lastUsedAt,
            Instant createdAt
    ) {
    }

    public record CreatedApiToken(
            ApiTokenView token,
            String plainTextToken
    ) {
    }

    public record AuthenticatedApiToken(
            UUID tokenId,
            UUID tenantId,
            UUID createdByUserId,
            String scope
    ) {
    }
}
