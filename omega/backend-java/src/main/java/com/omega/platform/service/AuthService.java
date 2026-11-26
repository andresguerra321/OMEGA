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
import com.omega.platform.web.dto.AuthDtos.UserSummaryResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
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
        UserEntity adminUser = userRepository.save(new UserEntity(
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

        return issueTokenResponse(adminUser, tenant.getSlug(), tenant.getProfile());
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
        UserEntity adminUser = userRepository.save(new UserEntity(
                tenant.getId(),
                normalizedEmail,
                passwordEncoder.encode(request.adminPassword()),
                request.adminFullName().trim(),
                Role.ADMIN));
        tenant.setOwnerUserId(adminUser.getId());
        tenantRepository.save(tenant);

        return issueTokenResponse(adminUser, tenant.getSlug(), tenant.getProfile());
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

            UserEntity user = userRepository.findByTenantIdAndEmailIgnoreCase(tenant.getId(), normalizedEmail)
                    .filter(UserEntity::isActive)
                    .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));

            if (!passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
                throw new BadCredentialsException("Credenciales inválidas");
            }

            return finishLoginOrMfaChallenge(user, tenant, trustedDeviceToken);
        }

        List<UserEntity> matches = userRepository.findAllActiveByEmailIgnoreCase(normalizedEmail).stream()
                .filter(u -> passwordEncoder.matches(rawPassword, u.getPasswordHash()))
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

        return finishLoginOrMfaChallenge(user, tenant, trustedDeviceToken);
    }

    private AuthTokenResponse finishLoginOrMfaChallenge(
            UserEntity user,
            TenantEntity tenant,
            String trustedDeviceToken) {
        boolean trustedDevice = trustedDeviceToken != null
                && jwtService.isTrustedDeviceTokenValid(trustedDeviceToken, user.getId());
        if (twoFactorService != null && user.isMfaEnabled() && !trustedDevice) {
            TwoFactorService.LoginChallengeResult challenge = twoFactorService.createLoginChallenge(user);
            return AuthTokenResponse.mfaChallenge(
                    user.getId(),
                    user.getTenantId(),
                    tenant.getSlug(),
                    user.getEmail(),
                    user.getRole(),
                    challenge.challengeToken(),
                    challenge.method(),
                    challenge.maskedEmail(),
                    tenant.getProfile());
        }
        return issueTokenResponse(user, tenant.getSlug(), tenant.getProfile());
    }

    public String issueTrustedDeviceToken(UUID userId, long ttlSeconds) {
        return jwtService.issueTrustedDeviceToken(userId, ttlSeconds);
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public AuthTokenResponse completeMfaLogin(String challengeToken, String code) {
        if (twoFactorService == null) {
            throw new IllegalStateException("Servicio 2FA no disponible");
        }
        UserEntity user = twoFactorService.verifyLoginChallenge(challengeToken, code);
        TenantEntity tenant = tenantRepository.findByIdAndActiveTrue(user.getTenantId())
                .orElseThrow(() -> new BadCredentialsException("Organización no disponible"));
        return issueTokenResponse(user, tenant.getSlug(), tenant.getProfile());
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

        UserEntity saved = userRepository.save(new UserEntity(
                tenantId,
                normalizedEmail,
                passwordEncoder.encode(request.password()),
                request.fullName().trim(),
                request.role()));

        return new UserSummaryResponse(
                saved.getId(),
                saved.getTenantId(),
                saved.getEmail(),
                saved.getFullName(),
                saved.getRole(),
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

    private AuthTokenResponse issueTokenResponse(UserEntity user, String tenantSlug, TenantProfile profile) {
        TenantEntity account = tenantRepository.findByIdAndActiveTrue(user.getTenantId()).orElse(null);
        String token = jwtService.issueToken(
                user.getId(),
                user.getTenantId(),
                user.getEmail(),
                user.getRole());
        return new AuthTokenResponse(
                token,
                "Bearer",
                jwtService.getExpirationSeconds(),
                user.getId(),
                user.getTenantId(),
                tenantSlug,
                user.getEmail(),
                user.getRole(),
                false,
                null,
                null,
                null,
                null,
                profile != null ? profile : TenantProfile.GENERAL,
                account != null ? account.getAccountType() : "UNCLASSIFIED",
                account != null && ("INDIVIDUAL".equals(account.getAccountType())
                        ? user.getId().equals(account.getOwnerUserId()) : user.getRole() == Role.ADMIN));
    }
}
