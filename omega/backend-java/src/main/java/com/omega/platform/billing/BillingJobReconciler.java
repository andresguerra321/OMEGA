package com.omega.platform.billing;

import com.omega.platform.integration.forensic.ForensicBridgeService;
import com.omega.platform.security.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class BillingJobReconciler {
    private final JdbcTemplate jdbc;
    private final CreditService credits;
    private final ForensicBridgeService bridge;
    public BillingJobReconciler(JdbcTemplate jdbc,CreditService credits,ForensicBridgeService bridge) { this.jdbc=jdbc;this.credits=credits;this.bridge=bridge; }
    @Scheduled(fixedDelayString="${omega.billing.job-reconcile-delay-ms:60000}")
    public void reconcileMobileJobs() {
        for(Map<String,Object> row:jdbc.queryForList("""
                SELECT r.*,u.email,u.role FROM omega_rag.credit_reservations r
                JOIN omega_rag.users u ON u.id=r.actor_user_id AND u.tenant_id=r.tenant_id
                WHERE r.status='RESERVED' AND r.reference LIKE 'mobile:%' LIMIT 100
                """)) {
            UUID tenant=(UUID)row.get("tenant_id"),user=(UUID)row.get("actor_user_id");
            String job=row.get("reference").toString().substring(7);
            try {
                Role role=Role.valueOf(row.get("role").toString());
                TenantContext.set(new TenantScope(tenant,user,role));
                var result=bridge.getMobileUsbAuditJob(new OmegaPrincipal(user,tenant,row.get("email").toString(),role,true),job);
                credits.settleMobile(tenant,job,String.valueOf(result.getOrDefault("status","")));
            } catch(org.springframework.web.server.ResponseStatusException ex) {
                if(ex.getStatusCode().value()==404) credits.settle(tenant,(UUID)row.get("id"),0);
            } catch(RuntimeException ignored) {
                // Leave the reservation pending while the worker is unavailable.
            } finally { TenantContext.clear(); }
        }
    }
}
