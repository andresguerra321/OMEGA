package com.omega.platform.service;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.UserEntity;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.repository.UserRepository;
import com.omega.platform.security.JwtService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import com.omega.platform.web.dto.AuthDtos.CreateTenantUserRequest;
import com.omega.platform.web.dto.AuthDtos.LoginRequest;
import com.omega.platform.web.dto.AuthDtos.RegisterTenantRequest;
import com.omega.platform.web.dto.AuthDtos.UserSummaryResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final OmegaProperties properties;

    public AuthService(
            TenantRepository tenantRepository,
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            OmegaProperties properties
    ) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.properties = properties;
    }

    @Transactional
    public AuthTokenResponse registerTenant(RegisterTenantRequest request, String bootstrapHeader) {
        verifyTenantRegistrationAllowed(bootstrapHeader);

        String normalizedSlug = request.tenantSlug().trim().toLowerCase(Locale.ROOT);
        if (tenantRepository.existsBySlug(normalizedSlug)) {
            throw new ConflictException("Ya existe un tenant registrado con ese slug");
        }

        TenantEntity tenant = tenantRepository.save(new TenantEntity(normalizedSlug, request.tenantName().trim()));
        String normalizedEmail = request.adminEmail().trim().toLowerCase(Locale.ROOT);
        UserEntity adminUser = userRepository.save(new UserEntity(
                tenant.getId(),
                normalizedEmail,
                passwordEncoder.encode(request.adminPassword()),
                request.adminFullName().trim(),
                Role.ADMIN
        ));

        return issueTokenResponse(adminUser, tenant.getSlug());
    }

    @Transactional(readOnly = true)
    public AuthTokenResponse login(LoginRequest request) {
        String normalizedSlug = request.tenantSlug().trim().toLowerCase(Locale.ROOT);
        String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);

        TenantEntity tenant = tenantRepository.findBySlugAndActiveTrue(normalizedSlug)
                .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));

        UserEntity user = userRepository.findByTenantIdAndEmailIgnoreCase(tenant.getId(), normalizedEmail)
                .filter(UserEntity::isActive)
                .orElseThrow(() -> new BadCredentialsException("Credenciales inválidas"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new BadCredentialsException("Credenciales inválidas");
        }

        return issueTokenResponse(user, tenant.getSlug());
    }

    @Transactional
    public UserSummaryResponse createUserInCurrentTenant(OmegaPrincipal adminPrincipal, CreateTenantUserRequest request) {
        UUID tenantId = adminPrincipal.tenantId();
        String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);
        if (userRepository.existsByTenantIdAndEmailIgnoreCase(tenantId, normalizedEmail)) {
            throw new ConflictException("El correo ya se encuentra registrado en el tenant actual");
        }

        UserEntity saved = userRepository.save(new UserEntity(
                tenantId,
                normalizedEmail,
                passwordEncoder.encode(request.password()),
                request.fullName().trim(),
                request.role()
        ));

        return new UserSummaryResponse(
                saved.getId(),
                saved.getTenantId(),
                saved.getEmail(),
                saved.getFullName(),
                saved.getRole(),
                saved.isActive(),
                saved.getCreatedAt()
        );
    }

    private void verifyTenantRegistrationAllowed(String providedBootstrapHeader) {
        String configuredSecret = properties.security().bootstrapSecret();
        if (configuredSecret != null && !configuredSecret.isBlank()) {
            boolean matches = providedBootstrapHeader != null && MessageDigest.isEqual(
                    configuredSecret.getBytes(StandardCharsets.UTF_8),
                    providedBootstrapHeader.getBytes(StandardCharsets.UTF_8)
            );
            if (!matches) {
                throw new AccessDeniedException("Secreto de aprovisionamiento de tenant inválido");
            }
            return;
        }
        if (!properties.security().allowTenantSelfRegistration()) {
            throw new AccessDeniedException("El auto-registro de tenants está deshabilitado");
        }
    }

    private AuthTokenResponse issueTokenResponse(UserEntity user, String tenantSlug) {
        String token = jwtService.issueToken(
                user.getId(),
                user.getTenantId(),
                user.getEmail(),
                user.getRole()
        );
        return new AuthTokenResponse(
                token,
                "Bearer",
                jwtService.getExpirationSeconds(),
                user.getId(),
                user.getTenantId(),
                tenantSlug,
                user.getEmail(),
                user.getRole()
        );
    }
}
