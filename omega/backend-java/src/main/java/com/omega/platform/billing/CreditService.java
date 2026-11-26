package com.omega.platform.billing;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CreditService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final BillingPolicy policy;
    private final BillingAccountResolver resolver;

    public CreditService(JdbcTemplate jdbc, PlatformTransactionManager manager, BillingPolicy policy) {
        this(jdbc, manager, policy, new BillingAccountResolver(jdbc));
    }

    @Autowired
    public CreditService(
            JdbcTemplate jdbc,
            PlatformTransactionManager manager,
            BillingPolicy policy,
            BillingAccountResolver resolver
    ) {
        this.jdbc = jdbc;
        this.policy = policy;
        this.resolver = resolver;
        this.tx = new TransactionTemplate(manager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public boolean enforced() { return policy.enforced(); }

    public static String effectivePlan(Map<String, Object> sub, OffsetDateTime now) {
        return effectivePlan(sub, now, 0);
    }

    public static String effectivePlan(Map<String, Object> sub, OffsetDateTime now, int graceDays) {
        if (!Boolean.TRUE.equals(sub.get("paid_verified")) || "FREE".equals(sub.get("plan_code"))) {
            return "FREE";
        }
        OffsetDateTime periodEnd = time(sub.get("current_period_end"));
        if (periodEnd.isAfter(now)) {
            return sub.get("plan_code").toString();
        }
        if (inGracePeriod(sub, now, graceDays)) {
            return sub.get("plan_code").toString();
        }
        return "FREE";
    }

    public static boolean inGracePeriod(Map<String, Object> sub, OffsetDateTime now, int graceDays) {
        if (graceDays <= 0 || !Boolean.TRUE.equals(sub.get("paid_verified")) || "FREE".equals(sub.get("plan_code"))) {
            return false;
        }
        if (Boolean.TRUE.equals(sub.get("cancel_at_period_end"))) {
            return false;
        }
        OffsetDateTime periodEnd = time(sub.get("current_period_end"));
        return !periodEnd.isAfter(now) && periodEnd.plusDays(graceDays).isAfter(now);
    }

    public static OffsetDateTime graceUntil(Map<String, Object> sub, int graceDays) {
        if (graceDays <= 0 || !Boolean.TRUE.equals(sub.get("paid_verified")) || "FREE".equals(sub.get("plan_code"))) {
            return null;
        }
        if (Boolean.TRUE.equals(sub.get("cancel_at_period_end"))) {
            return null;
        }
        return time(sub.get("current_period_end")).plusDays(graceDays);
    }

    public static OffsetDateTime time(Object value) {
        if (value instanceof OffsetDateTime date) return date;
        if (value instanceof java.sql.Timestamp date) return date.toInstant().atOffset(ZoneOffset.UTC);
        throw new IllegalStateException("Fecha de facturación inválida");
    }

    public Map<String, Object> subscription(UUID workspaceTenant) {
        UUID billingTenant = resolver.resolveBillingTenantId(workspaceTenant);
        return tx.execute(s -> { lockBillingTenant(billingTenant); return provision(billingTenant); });
    }

    public boolean isPaid(UUID workspaceTenant) {
        return !"FREE".equals(effectivePlan(subscription(workspaceTenant), OffsetDateTime.now(ZoneOffset.UTC), policy.graceDays()));
    }

    public void requirePaid(UUID workspaceTenant) {
        if (!enforced()) return;
        if (!isPaid(workspaceTenant)) throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                "Esta función requiere Pro o Enterprise. Revisa Mi plan y créditos.");
    }

    public void requireWorkspaceAccess(UUID workspaceTenant) {
        BillingAccountResolver.ResolvedBillingAccount account = resolver.resolve(workspaceTenant);
        boolean free = !account.belongsToOrganization()
                && BillingPolicy.freeWorkspace(account.workspaceAccountType(), account.workspaceProfile());
        if (!free) {
            requirePaid(account.billingTenantId());
        }
    }

    public <T> T execute(UUID workspaceTenant, UUID actor, CreditOperation operation, int amount, java.util.function.Supplier<T> work) {
        UUID reservation = reserve(workspaceTenant, actor, operation, amount, null);
        T result;
        try { result = work.get(); }
        catch (RuntimeException ex) { settle(workspaceTenant, reservation, 0); throw ex; }
        settle(workspaceTenant, reservation, amount);
        return result;
    }

    public Map<String, Object> summary(UUID workspaceTenant) {
        UUID billingTenant = resolver.resolveBillingTenantId(workspaceTenant);
        return tx.execute(s -> {
            lockBillingTenant(billingTenant);
            Map<String, Object> sub = provision(billingTenant);
            ensureGrants(billingTenant, sub);
            OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
            int graceDays = policy.graceDays();
            boolean inGrace = inGracePeriod(sub, now, graceDays);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("planCode", effectivePlan(sub, now, graceDays));
            result.put("enforced", enforced());
            result.put("billingInterval", sub.get("billing_interval"));
            result.put("status", inGrace ? "GRACE_PERIOD" : ("FREE".equals(result.get("planCode")) ? "ACTIVE" : sub.get("status")));
            result.put("paidUntil", Boolean.TRUE.equals(sub.get("paid_verified")) ? sub.get("current_period_end") : null);
            result.put("inGracePeriod", inGrace);
            result.put("graceUntil", inGrace ? graceUntil(sub, graceDays) : null);
            result.put("graceDays", graceDays);
            result.put("cancelAtPeriodEnd", sub.get("cancel_at_period_end"));
            result.put("balance", jdbc.queryForObject("SELECT coalesce(sum(remaining),0) FROM omega_rag.credit_grants WHERE tenant_id=? AND expires_at>now()", Long.class, billingTenant));
            result.put("reserved", jdbc.queryForObject("SELECT coalesce(sum(amount),0) FROM omega_rag.credit_reservations WHERE tenant_id=? AND status='RESERVED'", Long.class, billingTenant));
            result.put("buckets", jdbc.queryForList("SELECT source, granted, remaining, expires_at FROM omega_rag.credit_grants WHERE tenant_id=? AND expires_at>now() ORDER BY expires_at", billingTenant));
            result.put("movements", jdbc.queryForList("SELECT operation,amount,charged,status,created_at FROM omega_rag.credit_reservations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30", billingTenant));
            return result;
        });
    }

    public UUID reserve(UUID workspaceTenant, UUID actor, CreditOperation operation, int amount, String reference) {
        return reserve(workspaceTenant, actor, operation, amount, reference, false);
    }

    public UUID reserve(
            UUID workspaceTenant,
            UUID actor,
            CreditOperation operation,
            int amount,
            String reference,
            boolean legacyStandaloneExpedienteQuery
    ) {
        if (!enforced()) return null;
        BillingAccountResolver.ResolvedBillingAccount account = resolver.resolve(workspaceTenant);
        requireMeteredActorAllowed(account.belongsToOrganization(), legacyStandaloneExpedienteQuery);
        boolean free = !account.belongsToOrganization()
                && BillingPolicy.freeWorkspace(account.workspaceAccountType(), account.workspaceProfile());
        if (!free) {
            requirePaid(account.billingTenantId());
        }
        if (amount < 0 || amount > 100000) throw new IllegalArgumentException("Consumo inválido");
        UUID billingTenant = account.billingTenantId();
        return tx.execute(s -> {
            lockBillingTenant(billingTenant);
            Map<String,Object> sub = provision(billingTenant);
            boolean paid = !"FREE".equals(effectivePlan(sub, OffsetDateTime.now(ZoneOffset.UTC), policy.graceDays()));
            if (operation.paidOnly && !paid) throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                    "Esta función requiere un plan de pago.");
            ensureGrants(billingTenant, sub);
            if (reference != null && !jdbc.queryForList("SELECT id FROM omega_rag.credit_reservations WHERE tenant_id=? AND reference=?", billingTenant, reference).isEmpty())
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Esta operación ya fue registrada.");
            List<Map<String,Object>> grants = jdbc.queryForList("SELECT id, remaining FROM omega_rag.credit_grants WHERE tenant_id=? AND expires_at>now() AND remaining>0 ORDER BY expires_at,id FOR UPDATE", billingTenant);
            long available = grants.stream().mapToLong(g -> ((Number)g.get("remaining")).longValue()).sum();
            if (available < amount) throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                    "Créditos insuficientes para \"" + operation.label + "\": requiere " + amount
                            + " créditos y tu saldo disponible es de " + available
                            + ". Recarga créditos o contrata un plan en Mi plan y créditos.");
            requireSpendConsent(operation,amount);
            UUID id = UUID.randomUUID();
            jdbc.update(
                    "INSERT INTO omega_rag.credit_reservations(id,tenant_id,workspace_tenant_id,actor_user_id,operation,amount,reference) VALUES (?,?,?,?,?,?,?)",
                    id, billingTenant, workspaceTenant, actor, operation.name(), amount, reference
            );
            int pending = amount;
            for (Map<String,Object> grant : grants) {
                if (pending == 0) break;
                int take = Math.min(pending, ((Number)grant.get("remaining")).intValue());
                jdbc.update("UPDATE omega_rag.credit_grants SET remaining=remaining-? WHERE id=?", take, grant.get("id"));
                jdbc.update("INSERT INTO omega_rag.credit_allocations VALUES (?,?,?)", id, grant.get("id"), take);
                pending -= take;
            }
            return id;
        });
    }

    public static void requireMeteredActorAllowed(boolean belongsToOrganization, boolean legacyStandaloneExpedienteQuery) {
        if (!belongsToOrganization && legacyStandaloneExpedienteQuery) {
            return;
        }
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof com.omega.platform.security.OmegaPrincipal principal) {
            boolean isScopedMachineToken = !principal.active()
                    && auth.getAuthorities().stream()
                            .anyMatch(a -> "SCOPE_REPO_SCAN".equals(a.getAuthority()));
            if (!isScopedMachineToken && principal.role() == com.omega.platform.security.Role.CLIENT) {
                throw new org.springframework.security.access.AccessDeniedException(
                        "El rol CLIENT es de solo lectura y no puede ejecutar operaciones medidas."
                );
            }
            return;
        }
        var scopeOpt = com.omega.platform.security.TenantContext.get();
        if (scopeOpt.isPresent() && scopeOpt.get().role() == com.omega.platform.security.Role.CLIENT) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "El rol CLIENT es de solo lectura y no puede ejecutar operaciones medidas."
            );
        }
    }

    public static void requireSpendConsent(CreditOperation operation,int amount) {
        if(amount<3) return;
        if(org.springframework.web.context.request.RequestContextHolder.getRequestAttributes() instanceof org.springframework.web.context.request.ServletRequestAttributes attrs) {
            String limit=attrs.getRequest().getHeader("X-Omega-Credit-Limit");
            try { if(limit!=null && Integer.parseInt(limit)>=amount) return; } catch(NumberFormatException ignored) {}
            throw new ResponseStatusException(HttpStatus.CONFLICT,"OMEGA_CREDIT_QUOTE:"+amount+":"+operation.name());
        }
    }

    public void settle(UUID workspaceOrBillingTenant, UUID reservation, int charged) {
        if (reservation == null) return;
        UUID billingTenant = resolver.resolveBillingTenantId(workspaceOrBillingTenant);
        tx.executeWithoutResult(s -> {
            lockBillingTenant(billingTenant);
            Map<String,Object> row = jdbc.queryForMap("""
                    SELECT * FROM omega_rag.credit_reservations
                     WHERE id = ?
                       AND tenant_id = ?
                       AND (workspace_tenant_id IS NULL OR workspace_tenant_id = ? OR ? = tenant_id)
                     FOR UPDATE
                    """, reservation, billingTenant, workspaceOrBillingTenant, workspaceOrBillingTenant);
            if (!"RESERVED".equals(row.get("status"))) return;
            int amount = ((Number)row.get("amount")).intValue();
            if (charged < 0 || charged > amount) throw new IllegalArgumentException("Liquidación inválida");
            int refund = amount - charged;
            for (Map<String,Object> allocation : jdbc.queryForList("SELECT grant_id,amount FROM omega_rag.credit_allocations WHERE reservation_id=? ORDER BY grant_id", reservation)) {
                int giveBack = Math.min(refund, ((Number)allocation.get("amount")).intValue());
                if (giveBack > 0) jdbc.update("UPDATE omega_rag.credit_grants SET remaining=remaining+? WHERE id=?", giveBack, allocation.get("grant_id"));
                refund -= giveBack;
            }
            jdbc.update("UPDATE omega_rag.credit_reservations SET status=?,charged=?,settled_at=now() WHERE id=?",
                    charged == 0 ? "RELEASED" : "CONSUMED", charged, reservation);
        });
    }

    public void attachReference(UUID workspaceTenant, UUID reservation, String reference) {
        UUID billingTenant = resolver.resolveBillingTenantId(workspaceTenant);
        jdbc.update("""
                UPDATE omega_rag.credit_reservations
                   SET reference = ?
                 WHERE id = ?
                   AND tenant_id = ?
                   AND (workspace_tenant_id IS NULL OR workspace_tenant_id = ?)
                   AND status = 'RESERVED'
                """, reference, reservation, billingTenant, workspaceTenant);
    }

    public void settleMobile(UUID workspaceTenant, String job, String status) {
        boolean done="COMPLETED".equalsIgnoreCase(status),failed="FAILED".equalsIgnoreCase(status) || "ERROR".equalsIgnoreCase(status);
        if(!done && !failed) return;
        UUID billingTenant = resolver.resolveBillingTenantId(workspaceTenant);
        for(Map<String,Object> row:jdbc.queryForList("""
                SELECT id, amount
                  FROM omega_rag.credit_reservations
                 WHERE tenant_id = ?
                   AND COALESCE(workspace_tenant_id, tenant_id) = ?
                   AND reference = ?
                   AND status = 'RESERVED'
                """, billingTenant, workspaceTenant, "mobile:"+job))
            settle(workspaceTenant,(UUID)row.get("id"),done?((Number)row.get("amount")).intValue():0);
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelayString="${omega.billing.credit-reconcile-delay-ms:60000}")
    public void reconcileDocuments() {
        for (Map<String,Object> row : jdbc.queryForList("""
                SELECT r.id,r.tenant_id,d.status,d.total_pages,d.ocr_applied FROM omega_rag.credit_reservations r
                JOIN omega_rag.documents d ON r.reference='document:'||d.id::text AND COALESCE(r.workspace_tenant_id, r.tenant_id)=d.tenant_id
                WHERE r.status='RESERVED' AND d.status IN ('INDEXED','FAILED') LIMIT 100
                """)) {
            int charged="INDEXED".equals(row.get("status")) ? CreditOperation.pageCredits(((Number)row.get("total_pages")).intValue(),Boolean.TRUE.equals(row.get("ocr_applied"))) : 0;
            settle((UUID)row.get("tenant_id"),(UUID)row.get("id"),charged);
        }
        // All supported jobs have bounded inputs and timeouts; a lost process must not lock a customer's balance forever.
        for(Map<String,Object> row:jdbc.queryForList("SELECT id,tenant_id FROM omega_rag.credit_reservations WHERE status='RESERVED' AND created_at<now()-interval '24 hours' ORDER BY created_at LIMIT 100"))
            settle((UUID)row.get("tenant_id"),(UUID)row.get("id"),0);
    }

    public void lock(UUID workspaceOrBillingTenant) {
        UUID billingTenant = resolver.resolveBillingTenantId(workspaceOrBillingTenant);
        lockBillingTenant(billingTenant);
    }

    private void lockBillingTenant(UUID billingTenant) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> {}, "billing:" + billingTenant);
    }

    private Map<String,Object> provision(UUID tenant) {
        jdbc.update("""
            INSERT INTO omega_rag.subscriptions(id,tenant_id,plan_code,status,max_devices,monthly_ai_quota)
            VALUES (?,?,'FREE','ACTIVE',1,30) ON CONFLICT(tenant_id) DO NOTHING
            """, UUID.randomUUID(), tenant);
        return jdbc.queryForMap("SELECT * FROM omega_rag.subscriptions WHERE tenant_id=?", tenant);
    }

    private void ensureGrants(UUID tenant, Map<String,Object> sub) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        grant(tenant, "welcome:" + tenant, "WELCOME", 30, now.plusYears(100));
        // No emitir créditos mensuales nuevos si el período pagado ya venció (incluido durante días de gracia).
        if ("FREE".equals(effectivePlan(sub, now, 0))) return;
        OffsetDateTime start = time(sub.get("current_period_start"));
        OffsetDateTime end = time(sub.get("current_period_end"));
        long index = Math.max(0, ChronoUnit.MONTHS.between(start, now));
        while (start.plusMonths(index + 1).isBefore(now) || start.plusMonths(index + 1).isEqual(now)) index++;
        OffsetDateTime expiry = start.plusMonths(index + 1);
        if (expiry.isAfter(end)) expiry = end;
        Integer monthly = jdbc.queryForObject("SELECT credits FROM omega_rag.billing_plans WHERE plan_code=? AND interval=?", Integer.class, sub.get("plan_code"), sub.get("billing_interval"));
        grant(tenant, "subscription:" + sub.get("source_payment_id") + ":" + index, "SUBSCRIPTION", monthly, expiry);
    }

    // Called inside the same billing transaction that applies the verified payment.
    public void grant(UUID tenant, String key, String source, int amount, OffsetDateTime expiry) {
        jdbc.update("INSERT INTO omega_rag.credit_grants(id,tenant_id,grant_key,source,granted,remaining,expires_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(grant_key) DO NOTHING",
                UUID.randomUUID(), tenant, key, source, amount, amount, expiry);
    }
}
