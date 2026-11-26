package com.omega.platform.service;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.ClassificationLevel;
import com.omega.platform.domain.ExpedienteEntity;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.ExpedienteRepository;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.JwtService;
import com.omega.platform.security.LoginRateLimiter;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.security.TooManyLoginAttemptsException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import com.omega.platform.web.dto.AuthDtos.CreateTenantUserRequest;
import com.omega.platform.web.dto.AuthDtos.LoginRequest;
import com.omega.platform.web.dto.AuthDtos.PrincipalMeResponse;
import com.omega.platform.web.dto.AuthDtos.RegisterAccountRequest;
import com.omega.platform.web.dto.AuthDtos.RegisterTenantRequest;
import com.omega.platform.web.dto.AuthDtos.SwitchWorkspaceRequest;
import com.omega.platform.web.dto.AuthDtos.UserSummaryResponse;
import com.omega.platform.security.WorkspaceMfaPolicyService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.AccountSeatService seats;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.CreditService credits;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private AuditLogService auditLogService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private WorkspaceMfaPolicyService mfaPolicy;


    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final ExpedienteRepository expedienteRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final OmegaProperties properties;
    private final LoginRateLimiter loginRateLimiter;
    private final TwoFactorService twoFactorService;

    public AuthService(
            TenantRepository tenantRepository,
            UserRepository userRepository,
            ExpedienteRepository expedienteRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            OmegaProperties properties,
            LoginRateLimiter loginRateLimiter) {
        this(tenantRepository, userRepository, expedienteRepository, passwordEncoder, jwtService,
                properties, loginRateLimiter, null);
    }

    @Autowired
    public AuthService(
            TenantRepository tenantRepository,
            UserRepository userRepository,
            ExpedienteRepository expedienteRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            OmegaProperties properties,
            LoginRateLimiter loginRateLimiter,
            @Autowired(required = false) TwoFactorService twoFactorService) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.expedienteRepository = expedienteRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.properties = properties;
        this.loginRateLimiter = loginRateLimiter;
        this.twoFactorService = twoFactorService;
    }

    @Transactional
    public AuthTokenResponse registerAccount(RegisterAccountRequest request, String bootstrapHeader) {
        verifyTenantRegistrationAllowed(bootstrapHeader);
        return createAccount(request);
    }

    public boolean googleRegistrationAllowed() {
        String bootstrapSecret = properties.security().bootstrapSecret();
        return properties.security().allowTenantSelfRegistration()
                && (bootstrapSecret == null || bootstrapSecret.isBlank());
    }

    @Transactional
    public AuthTokenResponse registerGoogleAccount(RegisterAccountRequest request) {
        if (!googleRegistrationAllowed()) {
            throw new AccessDeniedException("El registro con Google no está habilitado en este servidor.");
        }
        return createAccount(request);
    }

    private AuthTokenResponse createAccount(RegisterAccountRequest request) {
        String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);
        if (userRepository.existsAnyByEmailIgnoreCase(normalizedEmail)) {
            throw new ConflictException("Ya existe una cuenta registrada con este correo electrónico");
        }

        boolean hasOrganization = request.organizationName() != null && !request.organizationName().isBlank();
        if (hasOrganization && Boolean.FALSE.equals(request.organizationAdminConfirmed())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Debes confirmar que eres administrador de la organización para registrar este espacio");
        }

        String orgSource = hasOrganization
                ? request.organizationName().trim()
                : request.fullName().trim();
        String orgName = orgSource.length() > 200 ? orgSource.substring(0, 200) : orgSource;
        String uniqueSlug = allocateUniqueTenantSlug(orgSource);

        TenantProfile selectedProfile = request.profile() != null ? request.profile() : TenantProfile.GENERAL;
        TenantEntity tenant = tenantRepository.save(new TenantEntity(uniqueSlug, orgName, selectedProfile));
        tenant.setAccountType(hasOrganization ? "ORGANIZATION" : "INDIVIDUAL");
        Role assignedRole = hasOrganization ? Role.ADMIN : Role.ANALYST;
        UserEntity adminUser = userRepository.saveAndFlush(new UserEntity(
                tenant.getId(),
                normalizedEmail,
                passwordEncoder.encode(request.password()),
                request.fullName().trim(),
                assignedRole));
        tenant.setOwnerUserId(adminUser.getId());
        tenantRepository.save(tenant);

        expedienteRepository.save(new ExpedienteEntity(
                tenant.getId(),
                adminUser.getId(),
                "Espacio personal",
                ClassificationLevel.CONFIDENTIAL));

        Role effectiveRole = userRepository.findActiveWorkspaceRole(adminUser.getId(), tenant.getId())
                .orElse(assignedRole);
        return issueTokenResponse(adminUser, tenant, effectiveRole);
    }

    @Transactional
    public AuthTokenResponse loginWithGoogle(UUID userId) {
        UserEntity user = userRepository.findById(userId).filter(UserEntity::isActive)
                .orElseThrow(() -> new BadCredentialsException("La cuenta de OMEGA no está disponible."));
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(user.getTenantId())
                .orElseThrow(() -> new BadCredentialsException("La cuenta de OMEGA no está disponible."));
        Role effectiveRole = userRepository.findActiveWorkspaceRole(userId, tenant.getId())
                .orElseThrow(() -> new BadCredentialsException("La cuenta de OMEGA no está disponible."));
        return finishLoginOrMfaChallenge(user, tenant, effectiveRole, null);
    }

    public void verifyPasswordForGoogleLink(OmegaPrincipal actor, String password) {
        UserEntity user = userRepository.findById(actor.userId()).filter(UserEntity::isActive)
                .orElseThrow(() -> new BadCredentialsException("La cuenta de OMEGA no está disponible."));
        if (password == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new BadCredentialsException("La contraseña de OMEGA es incorrecta.");
        }
    }

    @Transactional
    public AuthTokenResponse registerTenant(RegisterTenantRequest request, String bootstrapHeader) {
        verifyTenantRegistrationAllowed(bootstrapHeader);

        String normalizedSlug = request.tenantSlug().trim().toLowerCase(Locale.ROOT);
        if (tenantRepository.existsBySlug(normalizedSlug)) {
            throw new ConflictException("Ya existe un tenant registrado con ese slug");
        }

        TenantProfile selectedProfile = request.profile() != null ? request.profile() : TenantProfile.GENERAL;
        TenantEntity tenant = tenantRepository.save(
                new TenantEntity(normalizedSlug, request.tenantName().trim(), selectedProfile));
        tenant.setAccountType("ORGANIZATION");
        String normalizedEmail = request.adminEmail().trim().toLowerCase(Locale.ROOT);
        UserEntity adminUser = userRepository.saveAndFlush(new UserEntity(
                tenant.getId(),
                normalizedEmail,
                passwordEncoder.encode(request.adminPassword()),
                request.adminFullName().trim(),
                Role.ADMIN));
        tenant.setOwnerUserId(adminUser.getId());
        tenantRepository.save(tenant);

        Role effectiveRole = userRepository.findActiveWorkspaceRole(adminUser.getId(), tenant.getId())
                .orElse(Role.ADMIN);
        return issueTokenResponse(adminUser, tenant, effectiveRole);
    }

    @Transactional
    public AuthTokenResponse login(LoginRequest request) {
        return login(request, "local", null);
    }

    @Transactional
    public AuthTokenResponse login(LoginRequest request, String clientIp) {
        return login(request, clientIp, null);
    }

    @Transactional
    public AuthTokenResponse login(LoginRequest request, String clientIp, String trustedDeviceToken) {
        String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);
        String rawSlug = request.tenantSlug() == null ? "" : request.tenantSlug().trim().toLowerCase(Locale.ROOT);
        String resolvedIp = (clientIp == null || clientIp.isBlank()) ? "unknown" : clientIp.trim();

        try {
            loginRateLimiter.assertAllowed(resolvedIp, normalizedEmail);
        } catch (TooManyLoginAttemptsException ex) {
            log.warn(
                    "Login bloqueado por rate limit: ip={} email={} retryAfterSeconds={}",
                    sanitizeForLog(resolvedIp),
                    maskEmail(normalizedEmail),
                    ex.getRetryAfterSeconds());
            throw ex;
        }

        try {
            AuthTokenResponse response = authenticateLogin(
                    normalizedEmail,
                    rawSlug,
                    request.password(),
                    trustedDeviceToken);
            loginRateLimiter.reset(resolvedIp, normalizedEmail);
            return response;
        } catch (BadCredentialsException ex) {
            LoginRateLimiter.FailureStatus status = loginRateLimiter.recordFailure(resolvedIp, normalizedEmail);
            log.warn(
                    "Intento de login fallido: ip={} email={} accountFailures={} ipFailures={} locked={}",
                    sanitizeForLog(resolvedIp),
                    maskEmail(normalizedEmail),
                    status.accountFailures(),
                    status.ipFailures(),
                    status.locked());
            throw ex;
        }
    }

    private AuthTokenResponse authenticateLogin(
            String normalizedEmail,
            String rawSlug,
            String rawPassword,
            String trustedDeviceToken) {
        if (!rawSlug.isBlank()) {
            TenantEntity tenant = tenantRepository.findBySlugAndActiveTrue(rawSlug)
                    .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));

            UserEntity user = userRepository.findActiveMemberUserByTenantIdAndEmailIgnoreCase(tenant.getId(), normalizedEmail)
                    .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));

            if (!passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
                throw new BadCredentialsException("Credenciales inválidas");
            }

            Role effectiveRole = userRepository.findActiveWorkspaceRole(user.getId(), tenant.getId())
                    .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));
            return finishLoginOrMfaChallenge(user, tenant, effectiveRole, trustedDeviceToken);
        }

        List<UserEntity> matches = userRepository.findAllActiveByEmailIgnoreCase(normalizedEmail).stream()
                .filter(u -> passwordEncoder.matches(rawPassword, u.getPasswordHash()))
                .filter(u -> userRepository.findActiveWorkspaceRole(u.getId(), u.getTenantId()).isPresent())
                .toList();

        if (matches.isEmpty()) {
            throw new BadCredentialsException("Credenciales inválidas");
        }
        if (matches.size() > 1) {
            throw new ConflictException(
                    "Tu correo pertenece a más de una organización; especifica el identificador de organización");
        }

        UserEntity user = matches.get(0);
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(user.getTenantId())
                .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));
        Role effectiveRole = userRepository.findActiveWorkspaceRole(user.getId(), tenant.getId())
                .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));

        return finishLoginOrMfaChallenge(user, tenant, effectiveRole, trustedDeviceToken);
    }

    private AuthTokenResponse finishLoginOrMfaChallenge(
            UserEntity user,
            TenantEntity tenant,
            Role effectiveRole,
            String trustedDeviceToken) {
        boolean orgLegalTarget = WorkspaceMfaPolicyService.isOrganizationalLegalWorkspace(tenant);
        boolean secondaryWorkspace = !tenant.getId().equals(user.getTenantId());
        boolean mandatoryMfa = orgLegalTarget
                || secondaryWorkspace
                || (mfaPolicy != null && mfaPolicy.hasMandatoryMfaObligation(user.getId()));

        if (!user.isMfaEnabled() && (orgLegalTarget || secondaryWorkspace)) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "MFA_REQUIRED: Debes activar la verificación en dos pasos para acceder a este espacio."
            );
        }

        // Un dispositivo de confianza NUNCA suple el segundo factor al entrar a un espacio LEGAL organizacional.
        boolean trustedDevice = !orgLegalTarget
                && trustedDeviceToken != null
                && jwtService.isTrustedDeviceTokenValid(trustedDeviceToken, user.getId());
        if (twoFactorService != null && user.isMfaEnabled() && !trustedDevice) {
            TwoFactorService.LoginChallengeResult challenge = twoFactorService.createLoginChallenge(user, tenant.getId());
            return AuthTokenResponse.mfaChallenge(
                    user.getId(),
                    tenant.getId(),
                    tenant.getSlug(),
                    user.getEmail(),
                    effectiveRole,
                    challenge.challengeToken(),
                    challenge.method(),
                    challenge.maskedEmail(),
                    tenant.getProfile());
        }
        // En logins sin desafío 2FA (p. ej. sin MFA o con dispositivo de confianza), mfa_at se emite nulo.
        if (mandatoryMfa && !user.isMfaEnabled()) {
            log.info("AUTH_LOGIN_MFA_SETUP_NEEDED: userId={} rootTenantId={}", user.getId(), tenant.getId());
        }
        return issueTokenResponse(user, tenant, effectiveRole, null);
    }

    public String issueTrustedDeviceToken(UUID userId, long ttlSeconds) {
        return jwtService.issueTrustedDeviceToken(userId, ttlSeconds);
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public AuthTokenResponse completeMfaLogin(String challengeToken, String code) {
        if (twoFactorService == null) {
            throw new IllegalStateException("Servicio 2FA no disponible");
        }
        TwoFactorService.VerifiedLoginChallenge verified =
                twoFactorService.verifyLoginChallengeWithContext(challengeToken, code);
        UserEntity user = verified.user();
        UUID targetTenantId = verified.targetTenantId() != null ? verified.targetTenantId() : user.getTenantId();
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(targetTenantId)
                .orElseThrow(() -> new BadCredentialsException("Organización no disponible"));
        Role effectiveRole = userRepository.findActiveWorkspaceRole(user.getId(), tenant.getId())
                .orElseThrow(() -> new BadCredentialsException("Organización no disponible"));
        return issueTokenResponse(user, tenant, effectiveRole, Instant.now());
    }

    @Transactional(noRollbackFor = {ResponseStatusException.class, BadCredentialsException.class})
    public AuthTokenResponse switchWorkspace(
            OmegaPrincipal principal,
            SwitchWorkspaceRequest request,
            String clientIp
    ) {
        if (principal == null) {
            throw new AccessDeniedException("Sesión requerida para cambiar de espacio.");
        }
        UserEntity user = userRepository.findById(principal.userId())
                .filter(UserEntity::isActive)
                .orElseThrow(() -> new BadCredentialsException("Tu cuenta ya no se encuentra activa."));

        TenantEntity targetTenant = tenantRepository.findByIdAndActiveTrue(request.targetTenantId())
                .orElseThrow(() -> new AccessDeniedException("No tienes membresía activa en el espacio solicitado."));

        Role targetRole = userRepository.findActiveWorkspaceRole(user.getId(), targetTenant.getId())
                .orElseThrow(() -> new AccessDeniedException("No tienes membresía activa en el espacio solicitado."));

        if (!user.isMfaEnabled()) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "MFA_REQUIRED: Debes activar la verificación en dos pasos antes de cambiar de espacio."
            );
        }

        Instant now = Instant.now();
        Instant currentMfaAt = principal.mfaAt();
        boolean targetOrgLegal = WorkspaceMfaPolicyService.isOrganizationalLegalWorkspace(targetTenant);
        boolean hasProvidedTotp = request.totpCode() != null && !request.totpCode().isBlank();
        boolean requiresStepUp = (currentMfaAt == null)
                || (targetOrgLegal && !WorkspaceMfaPolicyService.isRecentMfa(currentMfaAt, now));

        Instant effectiveMfaAt = currentMfaAt;
        if (requiresStepUp || hasProvidedTotp) {
            if (!hasProvidedTotp) {
                throw new ResponseStatusException(
                        HttpStatus.FORBIDDEN,
                        "MFA_STEP_UP_REQUIRED: Ingresa un código TOTP vigente para confirmar el acceso al espacio."
                );
            }
            if (twoFactorService == null) {
                throw new IllegalStateException("Servicio 2FA no disponible");
            }
            twoFactorService.verifySingleUseTotpStepUp(user.getId(), request.totpCode(), clientIp);
            effectiveMfaAt = Instant.now();
        }

        if (credits != null) {
            credits.requireWorkspaceAccess(targetTenant.getId());
        }

        AuthTokenResponse response = issueTokenResponse(user, targetTenant, targetRole, effectiveMfaAt);
        if (auditLogService != null) {
            Map<String, Object> meta = Map.of(
                    "fromTenantId", principal.tenantId().toString(),
                    "toTenantId", targetTenant.getId().toString(),
                    "targetProfile", targetTenant.getProfile() != null ? targetTenant.getProfile().name() : "GENERAL",
                    "role", targetRole.name()
            );
            auditLogService.record(
                    principal.tenantId(),
                    user.getId(),
                    "WORKSPACE_SWITCHED",
                    "TENANT",
                    targetTenant.getId().toString(),
                    meta
            );
            if (!principal.tenantId().equals(targetTenant.getId())) {
                auditLogService.record(
                        targetTenant.getId(),
                        user.getId(),
                        "WORKSPACE_SWITCHED",
                        "TENANT",
                        targetTenant.getId().toString(),
                        meta
                );
            }
        }
        return response;
    }

    private static String maskEmail(String normalizedEmail) {
        int at = normalizedEmail.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return normalizedEmail.charAt(0) + "***" + sanitizeForLog(normalizedEmail.substring(at));
    }

    private static String sanitizeForLog(String raw) {
        return raw.replace('\r', '_').replace('\n', '_');
    }

    private String allocateUniqueTenantSlug(String rawName) {
        String decomposed = Normalizer.normalize(rawName == null ? "" : rawName, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        String base = decomposed.length() >= 3 ? decomposed : "omega-user";
        if (base.length() > 64) {
            base = base.substring(0, 64).replaceAll("-+$", "");
        }
        if (!tenantRepository.existsBySlug(base)) {
            return base;
        }
        for (int attempt = 0; attempt < 8; attempt++) {
            String suffix = "-" + UUID.randomUUID().toString().substring(0, 6);
            String candidate = (base.length() + suffix.length() > 80 ? base.substring(0, 80 - suffix.length()) : base)
                    + suffix;
            if (!tenantRepository.existsBySlug(candidate)) {
                return candidate;
            }
        }
        return "omega-" + UUID.randomUUID().toString().substring(0, 12);
    }

    @Transactional
    public UserSummaryResponse createUserInCurrentTenant(OmegaPrincipal adminPrincipal,
            CreateTenantUserRequest request) {
        UUID tenantId = adminPrincipal.tenantId();
        if (seats != null) seats.requireAvailableSeat(tenantId, null, request.role());
        String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);
        if (userRepository.existsByTenantIdAndEmailIgnoreCase(tenantId, normalizedEmail)) {
            throw new ConflictException("El correo ya se encuentra registrado en el tenant actual");
        }

        UserEntity saved = userRepository.saveAndFlush(new UserEntity(
                tenantId,
                normalizedEmail,
                passwordEncoder.encode(request.password()),
                request.fullName().trim(),
                request.role()));
        Role effectiveRole = userRepository.findActiveWorkspaceRole(saved.getId(), tenantId)
                .orElse(request.role());

        return new UserSummaryResponse(
                saved.getId(),
                saved.getTenantId(),
                saved.getEmail(),
                saved.getFullName(),
                effectiveRole,
                saved.isActive(),
                saved.getCreatedAt());
    }

    private void verifyTenantRegistrationAllowed(String providedBootstrapHeader) {
        String configuredSecret = properties.security().bootstrapSecret();
        if (configuredSecret != null && !configuredSecret.isBlank()) {
            boolean matches = providedBootstrapHeader != null && MessageDigest.isEqual(
                    configuredSecret.getBytes(StandardCharsets.UTF_8),
                    providedBootstrapHeader.getBytes(StandardCharsets.UTF_8));
            if (!matches) {
                throw new AccessDeniedException("Secreto de aprovisionamiento de tenant inválido");
            }
            return;
        }
        if (!properties.security().allowTenantSelfRegistration()) {
            throw new AccessDeniedException("El auto-registro de tenants está deshabilitado");
        }
    }

    @Transactional(readOnly = true)
    public PrincipalMeResponse resolveCurrentPrincipal(OmegaPrincipal principal) {
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(principal.tenantId()).orElse(null);
        String tenantSlug = tenant != null ? tenant.getSlug() : null;
        TenantProfile profile = tenant != null && tenant.getProfile() != null
                ? tenant.getProfile()
                : TenantProfile.GENERAL;
        return new PrincipalMeResponse(
                principal.userId(),
                principal.tenantId(),
                tenantSlug,
                principal.email(),
                principal.role(),
                profile,
                tenant != null ? tenant.getAccountType() : "UNCLASSIFIED",
                tenant != null && ("INDIVIDUAL".equals(tenant.getAccountType())
                        ? principal.userId().equals(tenant.getOwnerUserId()) : principal.role() == Role.ADMIN));
    }

    public void recordLogout(OmegaPrincipal principal) {
        if (principal == null) {
            return;
        }
        log.info(
                "AUTH_LOGOUT: tenantId={} userId={} email={}",
                principal.tenantId(),
                principal.userId(),
                maskEmail(principal.email().trim().toLowerCase(Locale.ROOT)));
    }

    private AuthTokenResponse issueTokenResponse(UserEntity user, TenantEntity account, Role effectiveRole) {
        return issueTokenResponse(user, account, effectiveRole, null);
    }

    private AuthTokenResponse issueTokenResponse(
            UserEntity user,
            TenantEntity account,
            Role effectiveRole,
            Instant mfaAt
    ) {
        UUID workspaceTenantId = account.getId();
        TenantProfile profile = account.getProfile() != null ? account.getProfile() : TenantProfile.GENERAL;
        String token = jwtService.issueToken(
                user.getId(),
                workspaceTenantId,
                user.getEmail(),
                effectiveRole,
                mfaAt);
        return new AuthTokenResponse(
                token,
                "Bearer",
                jwtService.getExpirationSeconds(),
                user.getId(),
                workspaceTenantId,
                account.getSlug(),
                user.getEmail(),
                effectiveRole,
                false,
                null,
                null,
                null,
                null,
                profile,
                account.getAccountType(),
                "INDIVIDUAL".equals(account.getAccountType())
                        ? user.getId().equals(account.getOwnerUserId()) : effectiveRole == Role.ADMIN);
    }
}
