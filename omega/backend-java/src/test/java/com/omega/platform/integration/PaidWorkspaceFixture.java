package com.omega.platform.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.billing.CreditService;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;

/** Paid accounts and explicit credit consent for functional suites; billing suites do not import it. */
@TestConfiguration(proxyBeanMethods=false)
public class PaidWorkspaceFixture {
    @Bean MockMvcBuilderCustomizer registeredPaidWorkspace(ObjectMapper mapper,JdbcTemplate jdbc,CreditService credits) {
        return builder -> builder.defaultRequest(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/")
            .header("X-Omega-Credit-Limit","10000")).alwaysDo(result -> {
            String path=result.getRequest().getRequestURI();
            if(result.getResponse().getStatus()!=201 || !(path.equals("/api/v1/auth/register") || path.equals("/api/v1/auth/tenants/register"))) return;
            var response=mapper.readTree(result.getResponse().getContentAsString());
            if(!response.hasNonNull("tenantId")) return;
            UUID tenant=UUID.fromString(response.path("tenantId").asText());
            credits.summary(tenant);
            jdbc.update("UPDATE omega_rag.subscriptions SET plan_code='ENTERPRISE',status='ACTIVE',paid_verified=true,current_period_start=now(),current_period_end=now()+interval '1 month' WHERE tenant_id=?",tenant);
            credits.grant(tenant,"functional-test-fixture","TOPUP",10000,OffsetDateTime.now().plusMonths(1));
        });
    }
}
