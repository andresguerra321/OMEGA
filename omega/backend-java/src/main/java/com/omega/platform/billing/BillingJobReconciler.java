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
                SELECT r.id,
                       r.tenant_id,
                       COALESCE(r.workspace_tenant_id, r.tenant_id) AS workspace_id,
                       r.actor_user_id,
                       r.reference,
                       u.email,
                       u.active AS user_active,
                       t.active AS tenant_active,
                       wm.role AS membership_role,
                       wm.active AS membership_active
                  FROM omega_rag.credit_reservations r
                  LEFT JOIN omega_rag.users u ON u.id = r.actor_user_id
                  LEFT JOIN omega_rag.tenants t ON t.id = COALESCE(r.workspace_tenant_id, r.tenant_id)
                  LEFT JOIN omega_rag.workspace_memberships wm
                         ON wm.tenant_id = COALESCE(r.workspace_tenant_id, r.tenant_id)
                        AND wm.user_id = r.actor_user_id
                 WHERE r.status = 'RESERVED' AND r.reference LIKE 'mobile:%'
                 LIMIT 100
                """)) {
            UUID workspaceTenant=(UUID)row.get("workspace_id"),user=(UUID)row.get("actor_user_id");
            if (!Boolean.TRUE.equals(row.get("user_active"))
                    || !Boolean.TRUE.equals(row.get("tenant_active"))
                    || !Boolean.TRUE.equals(row.get("membership_active"))
                    || row.get("membership_role") == null) {
                credits.settle((UUID)row.get("tenant_id"), (UUID)row.get("id"), 0);
                continue;
            }
            String job=row.get("reference").toString().substring(7);
            try {
                Role role=Role.valueOf(row.get("membership_role").toString());
                TenantContext.set(new TenantScope(workspaceTenant,user,role));
                var result=bridge.getMobileUsbAuditJob(new OmegaPrincipal(user,workspaceTenant,row.get("email").toString(),role,true),job);
                credits.settleMobile(workspaceTenant,job,String.valueOf(result.getOrDefault("status","")));
            } catch(org.springframework.web.server.ResponseStatusException ex) {
                if(ex.getStatusCode().value()==404) credits.settle(workspaceTenant,(UUID)row.get("id"),0);
            } catch(RuntimeException ignored) {
                // Leave the reservation pending while the worker is unavailable.
            } finally { TenantContext.clear(); }
        }
    }
}
