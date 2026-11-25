package com.omega.platform.billing;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

@SpringBootTest(properties={"OMEGA_BILLING_ENFORCE=false","OMEGA_MP_MODE=disabled"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DevelopmentWorkspaceIntegrationTest {
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) { BillingIntegrationTest.database(registry); }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired CreditService credits;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

    @Test void organizationGeneralAlsoRequiresMembershipAndExistingPaidPeriodsKeepAccess() throws Exception {
        for (boolean organization : new boolean[]{false, true}) {
            var payload = new java.util.HashMap<String,Object>(Map.of("fullName", "Persona General",
                    "email", "general"+System.nanoTime()+"@example.invalid", "password", "OmegaWorkspace!2026", "profile", "GENERAL"));
            if (organization) {
                payload.put("organizationName", "Organizacion Prueba");
                payload.put("organizationAdminConfirmed", true);
            }
            var result=mvc.perform(post("/api/v1/auth/register").with(csrf())
                    .with(request->{request.setRemoteAddr(organization?"198.19.1.20":"198.19.1.21");return request;})
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(payload)))
                    .andExpect(status().isCreated()).andReturn();
            var account=mapper.readTree(result.getResponse().getContentAsString());
            String bearer="Bearer "+account.path("accessToken").asText();
            UUID tenant=UUID.fromString(account.path("tenantId").asText());
            mvc.perform(get("/api/v1/billing/summary").header("Authorization",bearer))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.workspaceAccess").value(!organization));
            if (organization) {
                org.assertj.core.api.Assertions.assertThatThrownBy(()->credits.requireWorkspaceAccess(tenant))
                        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
                mvc.perform(get("/api/v1/saas/summary").header("Authorization",bearer)).andExpect(status().isPaymentRequired());
                jdbc.update("UPDATE omega_rag.subscriptions SET plan_code='PRO',paid_verified=true,current_period_end=now()+interval '1 month' WHERE tenant_id=?", tenant);
                mvc.perform(get("/api/v1/billing/summary").header("Authorization",bearer))
                        .andExpect(status().isOk()).andExpect(jsonPath("$.workspaceAccess").value(true));
            }
            credits.requireWorkspaceAccess(tenant);
        }
    }

    @Test void disabledPaymentsPreserveProfileButRequireMembership() throws Exception {
        assertThat(credits.enforced()).isTrue();
        for(String profile:new String[]{"DEVELOPER","LEGAL"}) {
            var result=mvc.perform(post("/api/v1/auth/register").with(csrf())
                    .with(request->{request.setRemoteAddr("198.19.1."+(profile.equals("LEGAL")?12:13));return request;})
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of(
                        "fullName","Persona Desarrollo","email","workspace"+System.nanoTime()+"@example.invalid",
                        "password","OmegaWorkspace!2026","profile",profile))))
                .andExpect(status().isCreated()).andReturn();
            var account=mapper.readTree(result.getResponse().getContentAsString());
            String bearer="Bearer "+account.path("accessToken").asText();
            mvc.perform(get("/api/v1/profile/config").header("Authorization",bearer))
                .andExpect(status().isOk()).andExpect(jsonPath("$.profile").value(profile));
            mvc.perform(get(profile.equals("LEGAL")?"/api/v1/legal/document-ai/policy":"/api/v1/dev/projects").header("Authorization",bearer))
                .andExpect(status().isPaymentRequired());
            mvc.perform(get("/api/v1/billing/summary").header("Authorization",bearer))
                .andExpect(status().isOk()).andExpect(jsonPath("$.workspaceAccess").value(false));
            mvc.perform(get("/api/v1/billing/plans").header("Authorization",bearer))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enforced").value(true));
            UUID tenant=UUID.fromString(account.path("tenantId").asText());
            assertThat(credits.isPaid(tenant)).isFalse();
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> credits.reserve(tenant,UUID.fromString(account.path("userId").asText()),CreditOperation.AI_QUERY,1,null))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        }
    }
}
