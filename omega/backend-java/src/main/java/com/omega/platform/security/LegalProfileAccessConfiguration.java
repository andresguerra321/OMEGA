package com.omega.platform.security;

import com.omega.platform.domain.TenantEntity;
import com.omega.platform.domain.TenantProfile;
import com.omega.platform.repository.TenantRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Único guard centralizado para rutas bajo {@code /api/v1/legal/**}.
 * Se ejecuta inmediatamente después del interceptor de acceso comercial ({@code order = 10})
 * para garantizar que solo espacios activos con perfil {@code LEGAL} accedan al módulo Legal.
 */
@Configuration
public class LegalProfileAccessConfiguration implements WebMvcConfigurer {

    private final ObjectProvider<TenantRepository> tenantRepositoryProvider;

    public LegalProfileAccessConfiguration(ObjectProvider<TenantRepository> tenantRepositoryProvider) {
        this.tenantRepositoryProvider = tenantRepositoryProvider;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        TenantRepository tenantRepository = tenantRepositoryProvider.getIfAvailable();
        if (tenantRepository == null) {
            return;
        }
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                if (!(handler instanceof HandlerMethod)) {
                    return true;
                }
                TenantScope scope = TenantContext.get()
                        .orElseThrow(() -> new AccessDeniedException("Contexto de espacio requerido para acceder al módulo Legal."));
                TenantEntity tenant = tenantRepository.findById(scope.tenantId())
                        .filter(TenantEntity::isActive)
                        .orElseThrow(() -> new AccessDeniedException("El espacio de trabajo no se encuentra activo."));
                if (tenant.getProfile() != TenantProfile.LEGAL) {
                    throw new AccessDeniedException("Esta operación requiere un espacio de trabajo con perfil LEGAL.");
                }
                return true;
            }
        }).addPathPatterns("/api/v1/legal/**").order(10);
    }
}
