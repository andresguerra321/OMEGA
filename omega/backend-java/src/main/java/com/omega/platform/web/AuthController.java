package com.omega.platform.web;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.AuthService;
import com.omega.platform.web.dto.AuthDtos.AuthTokenResponse;
import com.omega.platform.web.dto.AuthDtos.CreateTenantUserRequest;
import com.omega.platform.web.dto.AuthDtos.LoginRequest;
import com.omega.platform.web.dto.AuthDtos.PrincipalMeResponse;
import com.omega.platform.web.dto.AuthDtos.RegisterTenantRequest;
import com.omega.platform.web.dto.AuthDtos.UserSummaryResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/tenants/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthTokenResponse registerTenant(
            @Valid @RequestBody RegisterTenantRequest request,
            @RequestHeader(value = "X-Omega-Bootstrap-Secret", required = false) String bootstrapSecret
    ) {
        return authService.registerTenant(request, bootstrapSecret);
    }

    @PostMapping("/login")
    public AuthTokenResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    public UserSummaryResponse createUserInTenant(
            @AuthenticationPrincipal OmegaPrincipal principal,
            @Valid @RequestBody CreateTenantUserRequest request
    ) {
        return authService.createUserInCurrentTenant(principal, request);
    }

    @GetMapping("/me")
    public PrincipalMeResponse me(@AuthenticationPrincipal OmegaPrincipal principal) {
        return new PrincipalMeResponse(
                principal.userId(),
                principal.tenantId(),
                principal.email(),
                principal.role()
        );
    }
}
