package com.omega.platform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.LegalQuotaProperties;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.saas.AlertDispatcherService;
import com.omega.platform.saas.CommercialSaasService;
import com.omega.platform.security.JwtService;
import com.omega.platform.security.LoginRateLimiter;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.storage.StorageProperties;
import com.omega.platform.web.ValidationPatterns;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.HtmlUtils;

/**
 * Servicio unificado para el lanzamiento de pilotos (Fases 1 a 4):
 * - Fase 1 y 2: Embudo de activación DEVELOPER/LEGAL y telemetría agregada Zero-PII.
 * - Fase 3.1: Invitaciones de equipo por correo con enlace firmado (token SHA-256, 72h TTL).
 * - Fase 3.2: Reporte de problemas in-app con contexto técnico saneado libre de PII.
 * - Fase 4: Estado público del sistema y transparencia de planes/retención.
 */
@Service
public class PilotOpsService {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.AccountSeatService seats;


    private static final Logger log = LoggerFactory.getLogger(PilotOpsService.class);
    public static final String INVITE_TOKEN_PREFIX = "omega_inv_";
    private static final int INVITE_TTL_HOURS = 72;

    private static final Set<String> ALLOWED_TELEMETRY_EVENTS = Set.of(
            "ONBOARDING_COMPLETED",
            "DEV_FIRST_SCAN_COMPLETED",
            "DEV_FINDING_RESOLVED",
            "LEGAL_FIRST_DOC_INDEXED",
            "LEGAL_QUERY_CITED",
            "TEAM_INVITATION_SENT",
            "TEAM_INVITATION_ACCEPTED",
            "SUPPORT_TICKET_CREATED"
    );

    private static final Set<String> ALLOWED_SUPPORT_CATEGORIES = Set.of(
            "BUG", "FALSE_POSITIVE", "UX", "BILLING"
    );

    private static final Pattern SAFE_ENUM_VALUE_PATTERN = Pattern.compile("^[A-Za-z0-9_.:-]{1,48}$");
    private static final Pattern SECRET_REDACT_PATTERN = Pattern.compile(
            "(?i)(omega_scan_[A-Za-z0-9_-]{6,}|omega_inv_[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{16,}|Bearer\\s+[A-Za-z0-9._-]{8,})"
    );
    private static final Pattern EMAIL_PATTERN = Pattern.compile(ValidationPatterns.STRICT_EMAIL_REGEX);
    private static final Pattern PERSON_NAME_PATTERN = Pattern.compile(ValidationPatterns.PERSON_NAME_REGEX);
    private static final Pattern STRONG_PASSWORD_PATTERN = Pattern.compile(ValidationPatterns.STRONG_PASSWORD_REGEX);

    private final JdbcTemplate jdbc;
    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final PasswordResetService passwordResetService;
    private final LoginRateLimiter loginRateLimiter;
    private final AuditLogService auditLogService;
    private final LegalQuotaProperties legalQuotaProperties;
    private final ObjectMapper objectMapper;
    private final SecureRandom secureRandom = new SecureRandom();

    @Autowired(required = false)
    private CommercialSaasService commercialSaasService;

    @Autowired(required = false)
    private AlertDispatcherService alertDispatcherService;

    @Autowired(required = false)
    private StorageProperties storageProperties;

    @Autowired(required = false)
    private JavaMailSender mailSender;

    @Value("${spring.mail.host:}")
    private String smtpHost = "";

    @Value("${OMEGA_SMTP_FROM:${spring.mail.username:}}")
    private String smtpFrom = "";

    public PilotOpsService(
            JdbcTemplate jdbc,
            TenantRepository tenantRepository,
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            @Autowired(required = false) PasswordResetService passwordResetService,
            LoginRateLimiter loginRateLimiter,
            AuditLogService auditLogService,
            LegalQuotaProperties legalQuotaProperties,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.passwordResetService = passwordResetService;
        this.loginRateLimiter = loginRateLimiter;
        this.auditLogService = auditLogService;
        this.legalQuotaProperties = legalQuotaProperties;
        this.objectMapper = objectMapper;
    }

    // =========================================================================
    // FASE 1 & 2: Analítica Mínima Privada (Zero-PII) y Embudo de Activación
    // =========================================================================

    @Transactional
    public void recordTelemetryEvent(
            OmegaPrincipal principal,
            String eventName,
            Map<String, Object> rawProperties
    ) {
        if (principal == null) {
            throw new AccessDeniedException("Se requiere sesión autenticada.");
        }
        String cleanEvent = eventName == null ? "" : eventName.trim().toUpperCase(Locale.ROOT);
        if (!ALLOWED_TELEMETRY_EVENTS.contains(cleanEvent)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Evento de telemetría no permitido: " + cleanEvent);
        }
        String profile = tenantRepository.findById(principal.tenantId())
                .map(t -> t.getProfile() != null ? t.getProfile().name() : "GENERAL")
                .orElse("GENERAL");
        insertSanitizedTelemetry(principal.tenantId(), principal.userId(), profile, cleanEvent, rawProperties);
    }

    public void insertSanitizedTelemetry(
            UUID tenantId,
            UUID userId,
            String profile,
            String eventName,
            Map<String, Object> rawProperties
    ) {
        Map<String, Object> safeProps = sanitizeTelemetryProperties(rawProperties);
        String json;
        try {
            json = objectMapper.writeValueAsString(safeProps);
        } catch (Exception ex) {
            json = "{}";
        }
        jdbc.update(
                """
                INSERT INTO omega_rag.product_telemetry_events
                    (id, tenant_id, user_id, profile, event_name, properties_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, NOW())
                """,
                UUID.randomUUID(),
                tenantId,
                userId,
                profile != null ? profile : "GENERAL",
                eventName,
                json
        );
    }

    /**
     * Filtra estrictamente cualquier propiedad para garantizar Zero-PII:
     * solo permite números, booleanos y enums cortos sin '@', '/' ni espacios.
     */
    static Map<String, Object> sanitizeTelemetryProperties(Map<String, Object> raw) {
        Map<String, Object> clean = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) {
            return clean;
        }
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            String key = entry.getKey();
            Object val = entry.getValue();
            if (key == null || !SAFE_ENUM_VALUE_PATTERN.matcher(key).matches() || val == null) {
                continue;
            }
            String lowKey = key.toLowerCase(Locale.ROOT);
            if (lowKey.contains("email") || lowKey.contains("name") || lowKey.contains("filename")
                    || lowKey.contains("prompt") || lowKey.contains("question") || lowKey.contains("token")
                    || lowKey.contains("url") || lowKey.contains("path")) {
                continue;
            }
            if (val instanceof Number || val instanceof Boolean) {
                clean.put(key, val);
            } else if (val instanceof String strVal) {
                String trimmed = strVal.trim();
                if (SAFE_ENUM_VALUE_PATTERN.matcher(trimmed).matches() && !trimmed.contains("@")) {
                    clean.put(key, trimmed);
                }
            }
            if (clean.size() >= 12) {
                break;
            }
        }
        return clean;
    }

    @Transactional(readOnly = true)
    public PilotFunnelResponse getPilotFunnel(OmegaPrincipal principal) {
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(principal.tenantId())
                .orElseThrow(() -> new AccessDeniedException("Tenant inactivo o inexistente"));
        TenantProfile profile = tenant.getProfile() != null ? tenant.getProfile() : TenantProfile.GENERAL;

        if (profile == TenantProfile.DEVELOPER) {
            return buildDeveloperFunnel(tenant);
        }
        return buildLegalOrGeneralFunnel(tenant, profile);
    }

    private PilotFunnelResponse buildDeveloperFunnel(TenantEntity tenant) {
        UUID tenantId = tenant.getId();
        int projectsCount = queryInt("SELECT COUNT(*) FROM omega_rag.dev_projects WHERE tenant_id = ?", tenantId);
        int tokensCount = queryInt("SELECT COUNT(*) FROM omega_rag.api_tokens WHERE tenant_id = ? AND revoked_at IS NULL", tenantId);
        int scansCount = queryInt("SELECT COUNT(*) FROM omega_rag.dev_scans WHERE tenant_id = ?", tenantId);
        int suppressionsCount = queryInt("SELECT COUNT(*) FROM omega_rag.dev_suppressions WHERE tenant_id = ?", tenantId);
        int resolvedEventsCount = queryInt(
                "SELECT COUNT(*) FROM omega_rag.product_telemetry_events WHERE tenant_id = ? AND event_name = 'DEV_FINDING_RESOLVED'",
                tenantId);
        // También cuenta reducción verificada de hallazgos entre escaneos sucesivos de un mismo proyecto
        int reducedFindingsProjects = queryInt(
                """
                SELECT COUNT(DISTINCT s1.project_id)
                FROM omega_rag.dev_scans s1
                JOIN omega_rag.dev_scans s2
                  ON s1.tenant_id = s2.tenant_id
                 AND s1.project_id = s2.project_id
                 AND s2.created_at > s1.created_at
                 AND s2.findings_count < s1.findings_count
                WHERE s1.tenant_id = ?
                """,
                tenantId);

        int distinctReposOrScans = Math.max(projectsCount, scansCount);
        int totalMitigations = suppressionsCount + resolvedEventsCount + reducedFindingsProjects;

        boolean m1 = (projectsCount + tokensCount) >= 1;
        boolean m2 = scansCount >= 1;
        boolean m3 = distinctReposOrScans >= 3 && totalMitigations >= 1;

        List<FunnelMilestone> milestones = List.of(
                new FunnelMilestone(
                        "DEV_ONBOARDING",
                        "1. Configurar proyecto o token CLI",
                        m1,
                        projectsCount + tokensCount,
                        1
                ),
                new FunnelMilestone(
                        "DEV_FIRST_SCAN",
                        "2. Ejecutar primer escaneo de repositorio",
                        m2,
                        scansCount,
                        1
                ),
                new FunnelMilestone(
                        "DEV_PILOT_ACTIVATED",
                        "3. Escanear 3 repositorios y mitigar 1 hallazgo",
                        m3,
                        Math.min(3, distinctReposOrScans),
                        3
                )
        );

        return new PilotFunnelResponse(
                tenantId,
                TenantProfile.DEVELOPER.name(),
                m3,
                milestones,
                Map.of(
                        "projectsCount", projectsCount,
                        "activeApiTokens", tokensCount,
                        "scansCount", scansCount,
                        "mitigatedFindings", totalMitigations
                )
        );
    }

    private PilotFunnelResponse buildLegalOrGeneralFunnel(TenantEntity tenant, TenantProfile profile) {
        UUID tenantId = tenant.getId();
        int ownCasesCount = queryInt(
                "SELECT COUNT(*) FROM omega_rag.expedientes WHERE tenant_id = ? AND LOWER(title) NOT LIKE '%demo%'",
                tenantId);
        int indexedDocsCount = queryInt(
                "SELECT COUNT(*) FROM omega_rag.documents WHERE tenant_id = ? AND status = 'INDEXED'",
                tenantId);
        int citedAuditQueries = queryInt(
                """
                SELECT COUNT(*)
                FROM omega_rag.audit_logs
                WHERE tenant_id = ?
                  AND action = 'RAG_QUERY_EXECUTED'
                  AND COALESCE((metadata_json::jsonb->>'citationsCount')::int, 0) > 0
                """,
                tenantId);
        int citedTelemetryQueries = queryInt(
                "SELECT COUNT(*) FROM omega_rag.product_telemetry_events WHERE tenant_id = ? AND event_name = 'LEGAL_QUERY_CITED'",
                tenantId);
        int totalCitedQueries = Math.max(citedAuditQueries, citedTelemetryQueries);

        boolean m1 = ownCasesCount >= 1;
        boolean m2 = indexedDocsCount >= 1;
        boolean m3 = indexedDocsCount >= 1 && totalCitedQueries >= 1;

        List<FunnelMilestone> milestones = List.of(
                new FunnelMilestone(
                        "LEGAL_ONBOARDING",
                        "1. Crear expediente propio en el espacio",
                        m1,
                        ownCasesCount,
                        1
                ),
                new FunnelMilestone(
                        "LEGAL_FIRST_DOC",
                        "2. Indexar primer documento con sello SHA-256",
                        m2,
                        indexedDocsCount,
                        1
                ),
                new FunnelMilestone(
                        "LEGAL_PILOT_ACTIVATED",
                        "3. Obtener primera respuesta con cita verificada",
                        m3,
                        totalCitedQueries,
                        1
                )
        );

        return new PilotFunnelResponse(
                tenantId,
                profile.name(),
                m3,
                milestones,
                Map.of(
                        "ownExpedientesCount", ownCasesCount,
                        "indexedDocumentsCount", indexedDocsCount,
                        "citedQueriesCount", totalCitedQueries
                )
        );
    }

    private int queryInt(String sql, Object... args) {
        Integer val = jdbc.queryForObject(sql, Integer.class, args);
        return val != null ? val : 0;
    }

    // =========================================================================
    // FASE 3.1: Invitaciones de Equipo por Correo (Enlace Firmado 72h)
    // =========================================================================

    @Transactional
    public InvitationCreatedResponse createInvitation(
            OmegaPrincipal admin,
            String rawEmail,
            Role targetRole
    ) {
        requireAdmin(admin);
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase(Locale.ROOT);
        if (!EMAIL_PATTERN.matcher(email).matches() || email.length() > 255) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ingresa un correo electrónico válido.");
        }
        Role role = targetRole != null ? targetRole : Role.ANALYST;
        if (seats != null) seats.requireAvailableSeat(admin.tenantId(), null, role);

        if (userRepository.existsByTenantIdAndEmailIgnoreCase(admin.tenantId(), email)) {
            throw new ConflictException("Este correo ya pertenece al equipo actual.");
        }

        // Revocar invitaciones previas pendientes para el mismo correo en este tenant
        jdbc.update(
                """
                UPDATE omega_rag.tenant_invitations
                SET revoked_at = NOW()
                WHERE tenant_id = ? AND LOWER(email) = ? AND accepted_at IS NULL AND revoked_at IS NULL
                """,
                admin.tenantId(),
                email
        );

        byte[] randomBytes = new byte[32];
        secureRandom.nextBytes(randomBytes);
        String rawToken = INVITE_TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        String tokenHash = sha256Hex(rawToken);
        UUID invitationId = UUID.randomUUID();
        Instant now = Instant.now();
        Instant expiresAt = now.plus(INVITE_TTL_HOURS, ChronoUnit.HOURS);

        jdbc.update(
                """
                INSERT INTO omega_rag.tenant_invitations
                    (id, tenant_id, email, role, token_hash, invited_by, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                invitationId,
                admin.tenantId(),
                email,
                role.name(),
                tokenHash,
                admin.userId(),
                Timestamp.from(expiresAt),
                Timestamp.from(now)
        );

        TenantEntity tenant = tenantRepository.findById(admin.tenantId()).orElse(null);
        String tenantName = tenant != null ? tenant.getName() : "OMEGA Workspace";
        boolean emailed = trySendInvitationEmail(email, tenantName, role.name(), rawToken);

        auditLogService.record(
                admin.tenantId(),
                admin.userId(),
                "TENANT_INVITATION_CREATED",
                "TENANT_INVITATION",
                invitationId.toString(),
                Map.of("role", role.name(), "deliveryChannel", emailed ? "smtp" : "manual_link")
        );
        insertSanitizedTelemetry(
                admin.tenantId(),
                admin.userId(),
                tenant != null && tenant.getProfile() != null ? tenant.getProfile().name() : "GENERAL",
                "TEAM_INVITATION_SENT",
                Map.of("role", role.name(), "channel", emailed ? "SMTP" : "MANUAL")
        );

        return new InvitationCreatedResponse(
                invitationId,
                email,
                role.name(),
                expiresAt,
                emailed ? "smtp" : "manual_link",
                rawToken
        );
    }

    @Transactional(readOnly = true)
    public List<InvitationSummaryView> listInvitations(OmegaPrincipal admin) {
        requireAdmin(admin);
        Instant now = Instant.now();
        return jdbc.query(
                """
                SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at
                FROM omega_rag.tenant_invitations
                WHERE tenant_id = ?
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (rs, n) -> {
                    Instant exp = rs.getTimestamp("expires_at").toInstant();
                    Timestamp accTs = rs.getTimestamp("accepted_at");
                    Timestamp revTs = rs.getTimestamp("revoked_at");
                    String status = revTs != null ? "REVOKED"
                            : accTs != null ? "ACCEPTED"
                            : exp.isBefore(now) ? "EXPIRED" : "PENDING";
                    return new InvitationSummaryView(
                            UUID.fromString(rs.getString("id")),
                            rs.getString("email"),
                            rs.getString("role"),
                            status,
                            exp,
                            rs.getTimestamp("created_at").toInstant()
                    );
                },
                admin.tenantId()
        );
    }

    @Transactional
    public void revokeInvitation(OmegaPrincipal admin, UUID invitationId) {
        requireAdmin(admin);
        int updated = jdbc.update(
                """
                UPDATE omega_rag.tenant_invitations
                SET revoked_at = NOW()
                WHERE id = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
                """,
                invitationId,
                admin.tenantId()
        );
        if (updated == 0) {
            throw new ResourceNotFoundException("Invitación no encontrada o ya procesada.");
        }
        auditLogService.record(
                admin.tenantId(),
                admin.userId(),
                "TENANT_INVITATION_REVOKED",
                "TENANT_INVITATION",
                invitationId.toString(),
                Map.of()
        );
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public AuthTokenResponse acceptInvitation(
            String rawToken,
            String rawFullName,
            String rawPassword,
            String clientIp
    ) {
        String ip = (clientIp == null || clientIp.isBlank()) ? "unknown" : clientIp.trim();
        loginRateLimiter.assertScopedAllowed("invite-accept-ip", ip, 10);

        String cleanToken = rawToken == null ? "" : rawToken.trim();
        if (!cleanToken.startsWith(INVITE_TOKEN_PREFIX) || cleanToken.length() < 24 || cleanToken.length() > 160) {
            loginRateLimiter.recordScopedFailure("invite-accept-ip", ip, 10);
            throw new BadCredentialsException("Enlace de invitación inválido o expirado.");
        }
        String fullName = rawFullName == null ? "" : rawFullName.trim();
        if (fullName.length() < 2 || fullName.length() > 200 || !PERSON_NAME_PATTERN.matcher(fullName).matches()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Ingresa un nombre completo válido (solo letras y espacios, sin números ni símbolos)."
            );
        }
        if (rawPassword == null || rawPassword.length() < 12 || rawPassword.length() > 128
                || !STRONG_PASSWORD_PATTERN.matcher(rawPassword).matches()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "La contraseña debe tener al menos 12 caracteres e incluir letras y números o símbolos."
            );
        }

        String tokenHash = sha256Hex(cleanToken);
        List<Map<String, Object>> rows = jdbc.queryForList(
                """
                SELECT id, tenant_id, email, role, expires_at, accepted_at, revoked_at
                FROM omega_rag.tenant_invitations
                WHERE token_hash = ?
                FOR UPDATE
                """,
                tokenHash
        );
        if (rows.isEmpty()) {
            loginRateLimiter.recordScopedFailure("invite-accept-ip", ip, 10);
            throw new BadCredentialsException("Enlace de invitación inválido o expirado.");
        }

        Map<String, Object> row = rows.get(0);
        UUID invitationId = (UUID) row.get("id");
        UUID tenantId = (UUID) row.get("tenant_id");
        String email = String.valueOf(row.get("email")).trim().toLowerCase(Locale.ROOT);
        Role role = Role.valueOf(String.valueOf(row.get("role")));
        Instant expiresAt = ((Timestamp) row.get("expires_at")).toInstant();
        Object acceptedAt = row.get("accepted_at");
        Object revokedAt = row.get("revoked_at");

        if (acceptedAt != null || revokedAt != null || !expiresAt.isAfter(Instant.now())) {
            loginRateLimiter.recordScopedFailure("invite-accept-ip", ip, 10);
            throw new BadCredentialsException("Esta invitación ya fue utilizada, revocada o expiró.");
        }

        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(tenantId)
                .orElseThrow(() -> new BadCredentialsException("El espacio de trabajo ya no se encuentra activo."));

        if (userRepository.existsByTenantIdAndEmailIgnoreCase(tenantId, email)) {
            throw new ConflictException("Ya existe un usuario con este correo en la organización.");
        }

        if (seats != null) seats.requireAvailableSeat(tenantId, null, role);
        UserEntity createdUser = userRepository.saveAndFlush(new UserEntity(
                tenantId,
                email,
                passwordEncoder.encode(rawPassword),
                fullName,
                role
        ));

        jdbc.update(
                "UPDATE omega_rag.tenant_invitations SET accepted_at = NOW() WHERE id = ?",
                invitationId
        );

        Role effectiveRole = userRepository.findActiveWorkspaceRole(createdUser.getId(), tenantId)
                .orElse(role);

        String jwt = jwtService.issueToken(
                createdUser.getId(),
                createdUser.getTenantId(),
                createdUser.getEmail(),
                effectiveRole
        );
        AuthTokenResponse response = new AuthTokenResponse(
                jwt,
                "Bearer",
                jwtService.getExpirationSeconds(),
                createdUser.getId(),
                createdUser.getTenantId(),
                tenant.getSlug(),
                createdUser.getEmail(),
                effectiveRole
        );
        if (passwordResetService != null) {
            String recKey = passwordResetService.createRecoveryKey(createdUser.getId(), rawPassword).get("recoveryKey");
            response = response.withRecoveryKey(recKey);
        }

        auditLogService.record(
                tenantId,
                createdUser.getId(),
                "TENANT_INVITATION_ACCEPTED",
                "TENANT_INVITATION",
                invitationId.toString(),
                Map.of("role", role.name())
        );
        insertSanitizedTelemetry(
                tenantId,
                createdUser.getId(),
                tenant.getProfile() != null ? tenant.getProfile().name() : "GENERAL",
                "TEAM_INVITATION_ACCEPTED",
                Map.of("role", role.name())
        );
        return response;
    }

    private boolean trySendInvitationEmail(String email, String tenantName, String role, String rawToken) {
        if (mailSender == null || smtpHost == null || smtpHost.isBlank() || smtpFrom == null || smtpFrom.isBlank()) {
            return false;
        }
        try {
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, true, StandardCharsets.UTF_8.name());
            helper.setFrom(smtpFrom.trim(), "OMEGA Security");
            helper.setTo(email);
            helper.setSubject("Invitación al espacio " + tenantName + " en OMEGA");
            String plainText = "Te invitaron al espacio " + tenantName + " en OMEGA.\n"
                    + "Rol asignado: " + role + " (válido por 72 horas).\n"
                    + "Código de invitación: " + rawToken + "\n";
            String html = OmegaEmailTemplate.Spec.builder("Invitación a " + tenantName)
                    .preheader("Te invitaron al espacio " + tenantName + " en OMEGA con rol " + role + ".")
                    .addParagraph("Para activar tu cuenta sin compartir contraseñas, abre OMEGA, elige \"Unirme con código de invitación\" y pega el código siguiente.")
                    .addMetadata("Espacio", tenantName)
                    .addMetadata("Rol asignado", role)
                    .addMetadata("Vigencia", "72 horas")
                    .verificationCode(rawToken, "Código de invitación")
                    .recipientEmail(email)
                    .supportEmail(smtpFrom.trim())
                    .render();
            helper.setText(plainText, html);
            OmegaEmailTemplate.attachMark(helper);
            mailSender.send(msg);
            return true;
        } catch (Exception ex) {
            log.warn("No se pudo enviar invitación por SMTP (se entrega enlace manual al admin): {}", ex.getClass().getSimpleName());
            return false;
        }
    }

    // =========================================================================
    // FASE 3.2: Botón «Reportar un problema» con Contexto Saneado
    // =========================================================================

    @Transactional
    public SupportTicketCreatedResponse createSupportTicket(
            OmegaPrincipal principal,
            String rawCategory,
            String rawSummary,
            String rawCurrentView,
            String rawLastErrorCode
    ) {
        String category = rawCategory == null ? "" : rawCategory.trim().toUpperCase(Locale.ROOT);
        if (!ALLOWED_SUPPORT_CATEGORIES.contains(category)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Categoría inválida. Usa BUG, FALSE_POSITIVE, UX o BILLING."
            );
        }
        String summary = sanitizeSupportText(rawSummary, 2000);
        if (summary.length() < 5) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Describe el problema en al menos 5 caracteres."
            );
        }
        String currentView = sanitizeSupportText(rawCurrentView, 120);
        String lastErrorCode = sanitizeSupportText(rawLastErrorCode, 64);

        TenantEntity tenant = tenantRepository.findById(principal.tenantId()).orElse(null);
        String profile = tenant != null && tenant.getProfile() != null ? tenant.getProfile().name() : "GENERAL";
        String planCode = resolvePlanCode(principal.tenantId());
        boolean retentionEnabled = storageProperties != null && storageProperties.isRetentionEnabled();

        Map<String, Object> contextMap = new LinkedHashMap<>();
        contextMap.put("profile", profile);
        contextMap.put("planCode", planCode);
        contextMap.put("role", principal.role().name());
        contextMap.put("retentionEnabled", retentionEnabled);
        if (!lastErrorCode.isEmpty()) {
            contextMap.put("lastErrorCode", lastErrorCode);
        }

        String contextJson;
        try {
            contextJson = objectMapper.writeValueAsString(contextMap);
        } catch (Exception ex) {
            contextJson = "{}";
        }

        UUID ticketId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update(
                """
                INSERT INTO omega_rag.support_tickets
                    (id, tenant_id, user_id, category, summary, current_view, context_json, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'OPEN', ?)
                """,
                ticketId,
                principal.tenantId(),
                principal.userId(),
                category,
                summary,
                currentView,
                contextJson,
                Timestamp.from(now)
        );

        auditLogService.record(
                principal.tenantId(),
                principal.userId(),
                "SUPPORT_TICKET_CREATED",
                "SUPPORT_TICKET",
                ticketId.toString(),
                Map.of("category", category, "currentView", currentView, "profile", profile)
        );
        insertSanitizedTelemetry(
                principal.tenantId(),
                principal.userId(),
                profile,
                "SUPPORT_TICKET_CREATED",
                Map.of("category", category)
        );

        if (alertDispatcherService != null) {
            try {
                alertDispatcherService.dispatchCriticalAlert(
                        principal.tenantId(),
                        principal.userId(),
                        "HIGH",
                        "[Soporte Piloto OMEGA · " + category + "] Vista: " + (currentView.isEmpty() ? "general" : currentView),
                        summary + " | Perfil: " + profile + " | Plan: " + planCode,
                        ""
                );
            } catch (RuntimeException ignored) {
                // El despacho externo no interrumpe el guardado del ticket en BD
            }
        }

        return new SupportTicketCreatedResponse(
                ticketId,
                category,
                "OPEN",
                now,
                contextMap
        );
    }

    @Transactional(readOnly = true)
    public List<SupportTicketSummaryView> listSupportTickets(OmegaPrincipal principal) {
        return jdbc.query(
                """
                SELECT id, category, summary, current_view, status, created_at
                FROM omega_rag.support_tickets
                WHERE tenant_id = ?
                ORDER BY created_at DESC
                LIMIT 30
                """,
                (rs, n) -> new SupportTicketSummaryView(
                        UUID.fromString(rs.getString("id")),
                        rs.getString("category"),
                        rs.getString("summary"),
                        rs.getString("current_view"),
                        rs.getString("status"),
                        rs.getTimestamp("created_at").toInstant()
                ),
                principal.tenantId()
        );
    }

    static String sanitizeSupportText(String raw, int maxLen) {
        if (raw == null) {
            return "";
        }
        String redacted = SECRET_REDACT_PATTERN.matcher(raw.trim()).replaceAll("[REDACTED]");
        String singleSpace = redacted.replaceAll("[\\r\\n\\t]+", " ").trim();
        return singleSpace.length() > maxLen ? singleSpace.substring(0, maxLen) : singleSpace;
    }

    // =========================================================================
    // FASE 4: Estado Público del Sistema, Planes y Postura Zero-Retention
    // =========================================================================

    @Transactional(readOnly = true)
    public Map<String, Object> getPublicStatusAndPlans() {
        boolean dbUp = false;
        try {
            Integer one = jdbc.queryForObject("SELECT 1", Integer.class);
            dbUp = one != null && one == 1;
        } catch (Exception ignored) {
            dbUp = false;
        }
        boolean retentionEnabled = storageProperties != null && storageProperties.isRetentionEnabled();

        List<Map<String, Object>> plans = dbUp ? jdbc.queryForList("""
                SELECT plan_code AS "planCode",name AS label,credits AS "monthlyCredits",
                       max_devices AS "maxDevices",max_users AS "maxUsers",price,currency
                FROM omega_rag.billing_plans WHERE interval='MONTHLY' AND active ORDER BY price
                """) : List.of();
        for(Map<String,Object> plan:plans) {
            String code=plan.get("planCode").toString();
            var limits=legalQuotaProperties!=null ? legalQuotaProperties.forPlan(code) : null;
            plan.put("maxDocumentsPerCase","FREE".equals(code)?0:limits!=null?limits.getMaxDocumentsPerCase():25);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", dbUp ? "UP" : "DEGRADED");
        out.put("database", dbUp ? "UP" : "DOWN");
        out.put("version", "2.1.0");
        out.put("zeroRetentionDefault", !retentionEnabled);
        out.put("retentionMode", retentionEnabled ? "ENCRYPTED_VAULT_OPTIONAL" : "STRICT_RAM_ZERO_RETENTION");
        out.put("checkedAt", Instant.now().toString());
        out.put("plans", plans);
        return out;
    }

    private String resolvePlanCode(UUID tenantId) {
        if (commercialSaasService == null) {
            return "PERSONAL";
        }
        try {
            var sub = commercialSaasService.getOrProvisionSubscription(tenantId);
            return sub != null && sub.getPlanCode() != null ? sub.getPlanCode() : "PERSONAL";
        } catch (Exception ex) {
            return "PERSONAL";
        }
    }

    private static void requireAdmin(OmegaPrincipal principal) {
        if (principal == null || principal.role() != Role.ADMIN) {
            throw new AccessDeniedException("Solo un administrador del espacio puede gestionar invitaciones.");
        }
    }

    public static String sha256Hex(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible", ex);
        }
    }

    public record FunnelMilestone(
            String id,
            String label,
            boolean completed,
            int currentCount,
            int targetCount
    ) {}

    public record PilotFunnelResponse(
            UUID tenantId,
            String profile,
            boolean activated,
            List<FunnelMilestone> milestones,
            Map<String, Object> metrics
    ) {}

    public record InvitationCreatedResponse(
            UUID id,
            String email,
            String role,
            Instant expiresAt,
            String deliveryChannel,
            String inviteToken
    ) {}

    public record InvitationSummaryView(
            UUID id,
            String email,
            String role,
            String status,
            Instant expiresAt,
            Instant createdAt
    ) {}

    public record SupportTicketCreatedResponse(
            UUID id,
            String category,
            String status,
            Instant createdAt,
            Map<String, Object> sanitizedContext
    ) {}

    public record SupportTicketSummaryView(
            UUID id,
            String category,
            String summary,
            String currentView,
            String status,
            Instant createdAt
    ) {}
}
