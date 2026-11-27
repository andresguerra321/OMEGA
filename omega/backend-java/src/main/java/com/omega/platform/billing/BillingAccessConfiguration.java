package com.omega.platform.billing;

import com.omega.platform.security.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class BillingAccessConfiguration implements WebMvcConfigurer {
    private final org.springframework.beans.factory.ObjectProvider<CreditService> creditProvider;
    public BillingAccessConfiguration(org.springframework.beans.factory.ObjectProvider<CreditService> creditProvider) { this.creditProvider=creditProvider; }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        CreditService credits=creditProvider.getIfAvailable();
        if(credits==null) return; // Controller-only test slices do not load billing persistence.
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler) {
                if(handler instanceof HandlerMethod method && TenantContext.get().isPresent()) {
                    String name=method.getBeanType().getSimpleName();
                    // Account recovery, configuration and checkout remain reachable before subscribing.
                    if (!java.util.Set.of("AuthController", "AccountIdentityController", "BillingController",
                            "ProfileConfigController", "SystemController", "CommercialDocumentsController", "CommercialBillingController", "ProfessionalReportController").contains(name))
                        credits.requireWorkspaceAccess(TenantContext.get().orElseThrow().tenantId());
                    if(name.startsWith("Legal") || name.startsWith("Dev") || name.equals("RepoScannerProxyController")
                            || name.equals("ApiTokenController") || name.equals("GitHubIntegrationController"))
                        credits.requirePaid(TenantContext.get().orElseThrow().tenantId());
                }
                return true;
            }
        }).addPathPatterns("/api/v1/**").order(0);
    }
}
