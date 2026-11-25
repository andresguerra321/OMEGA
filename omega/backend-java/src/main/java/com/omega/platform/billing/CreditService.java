package com.omega.platform.billing;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;
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

    public CreditService(JdbcTemplate jdbc, PlatformTransactionManager manager, BillingPolicy policy) {
        this.jdbc = jdbc;
        this.policy = policy;
        this.tx = new TransactionTemplate(manager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public boolean enforced() { return policy.enforced(); }

    public static String effectivePlan(Map<String, Object> sub, OffsetDateTime now) {
        return Boolean.TRUE.equals(sub.get("paid_verified"))
                && time(sub.get("current_period_end")).isAfter(now)
                && !"FREE".equals(sub.get("plan_code")) ? sub.get("plan_code").toString() : "FREE";
    }

    public static OffsetDateTime time(Object value) {
        if (value instanceof OffsetDateTime date) return date;
        if (value instanceof java.sql.Timestamp date) return date.toInstant().atOffset(ZoneOffset.UTC);
        throw new IllegalStateException("Fecha de facturación inválida");
    }

    public Map<String, Object> subscription(UUID tenant) {
        return tx.execute(s -> { lock(tenant); return provision(tenant); });
    }

    public boolean isPaid(UUID tenant) {
        return !"FREE".equals(effectivePlan(subscription(tenant), OffsetDateTime.now(ZoneOffset.UTC)));
    }

    public void requirePaid(UUID tenant) {
        if (!enforced()) return;
        if (!isPaid(tenant)) throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                "Esta función requiere Pro o Enterprise. Revisa Mi plan y créditos.");
    }

    public void requireWorkspaceAccess(UUID tenant) {
        Map<String, Object> identity = jdbc.queryForMap(
                "SELECT account_type,profile FROM omega_rag.tenants WHERE id=? AND active", tenant);
        if (!BillingPolicy.freeWorkspace((String) identity.get("account_type"), (String) identity.get("profile")))
            requirePaid(tenant);
    }

    public <T> T execute(UUID tenant, UUID actor, CreditOperation operation, int amount, java.util.function.Supplier<T> work) {
        UUID reservation = reserve(tenant, actor, operation, amount, null);
        T result;
        try { result = work.get(); }
        catch (RuntimeException ex) { settle(tenant, reservation, 0); throw ex; }
        settle(tenant, reservation, amount);
        return result;
    }

    public Map<String, Object> summary(UUID tenant) {
        return tx.execute(s -> {
            lock(tenant);
            Map<String, Object> sub = provision(tenant);
            ensureGrants(tenant, sub);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("planCode", effectivePlan(sub, OffsetDateTime.now(ZoneOffset.UTC)));
            result.put("enforced", enforced());
            result.put("billingInterval", sub.get("billing_interval"));
            result.put("status", "FREE".equals(result.get("planCode")) ? "ACTIVE" : sub.get("status"));
            result.put("paidUntil", Boolean.TRUE.equals(sub.get("paid_verified")) ? sub.get("current_period_end") : null);
            result.put("cancelAtPeriodEnd", sub.get("cancel_at_period_end"));
            result.put("balance", jdbc.queryForObject("SELECT coalesce(sum(remaining),0) FROM omega_rag.credit_grants WHERE tenant_id=? AND expires_at>now()", Long.class, tenant));
            result.put("reserved", jdbc.queryForObject("SELECT coalesce(sum(amount),0) FROM omega_rag.credit_reservations WHERE tenant_id=? AND status='RESERVED'", Long.class, tenant));
            result.put("buckets", jdbc.queryForList("SELECT source, granted, remaining, expires_at FROM omega_rag.credit_grants WHERE tenant_id=? AND expires_at>now() ORDER BY expires_at", tenant));
            result.put("movements", jdbc.queryForList("SELECT operation,amount,charged,status,created_at FROM omega_rag.credit_reservations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30", tenant));
            return result;
        });
    }

    public UUID reserve(UUID tenant, UUID actor, CreditOperation operation, int amount, String reference) {
        if (!enforced()) return null;
        requireWorkspaceAccess(tenant);
        if (amount < 0 || amount > 100000) throw new IllegalArgumentException("Consumo inválido");
        return tx.execute(s -> {
            lock(tenant);
            Map<String,Object> sub = provision(tenant);
            boolean paid = !"FREE".equals(effectivePlan(sub, OffsetDateTime.now(ZoneOffset.UTC)));
            if (operation.paidOnly && !paid) throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                    "Esta función requiere un plan de pago.");
            ensureGrants(tenant, sub);
            if (reference != null && !jdbc.queryForList("SELECT id FROM omega_rag.credit_reservations WHERE tenant_id=? AND reference=?", tenant, reference).isEmpty())
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Esta operación ya fue registrada.");
            List<Map<String,Object>> grants = jdbc.queryForList("SELECT id, remaining FROM omega_rag.credit_grants WHERE tenant_id=? AND expires_at>now() AND remaining>0 ORDER BY expires_at,id FOR UPDATE", tenant);
            long available = grants.stream().mapToLong(g -> ((Number)g.get("remaining")).longValue()).sum();
            if (available < amount) throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                    "Créditos insuficientes. Esta operación requiere " + amount + ". Saldo disponible: " + available + ". Revisa Mi plan y créditos.");
            requireSpendConsent(operation,amount);
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO omega_rag.credit_reservations(id,tenant_id,actor_user_id,operation,amount,reference) VALUES (?,?,?,?,?,?)", id, tenant, actor, operation.name(), amount, reference);
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

    public static void requireSpendConsent(CreditOperation operation,int amount) {
        if(amount<3) return;
        if(org.springframework.web.context.request.RequestContextHolder.getRequestAttributes() instanceof org.springframework.web.context.request.ServletRequestAttributes attrs) {
            String limit=attrs.getRequest().getHeader("X-Omega-Credit-Limit");
            try { if(limit!=null && Integer.parseInt(limit)>=amount) return; } catch(NumberFormatException ignored) {}
            throw new ResponseStatusException(HttpStatus.CONFLICT,"OMEGA_CREDIT_QUOTE:"+amount+":"+operation.name());
        }
    }

    public void settle(UUID tenant, UUID reservation, int charged) {
        if (reservation == null) return;
        tx.executeWithoutResult(s -> {
            lock(tenant);
            Map<String,Object> row = jdbc.queryForMap("SELECT * FROM omega_rag.credit_reservations WHERE id=? AND tenant_id=? FOR UPDATE", reservation, tenant);
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

    public void attachReference(UUID tenant, UUID reservation, String reference) {
        jdbc.update("UPDATE omega_rag.credit_reservations SET reference=? WHERE id=? AND tenant_id=? AND status='RESERVED'",reference,reservation,tenant);
    }

    public void settleMobile(UUID tenant, String job, String status) {
        boolean done="COMPLETED".equalsIgnoreCase(status),failed="FAILED".equalsIgnoreCase(status) || "ERROR".equalsIgnoreCase(status);
        if(!done && !failed) return;
        for(Map<String,Object> row:jdbc.queryForList("SELECT id,amount FROM omega_rag.credit_reservations WHERE tenant_id=? AND reference=? AND status='RESERVED'",tenant,"mobile:"+job))
            settle(tenant,(UUID)row.get("id"),done?((Number)row.get("amount")).intValue():0);
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelayString="${omega.billing.credit-reconcile-delay-ms:60000}")
    public void reconcileDocuments() {
        for (Map<String,Object> row : jdbc.queryForList("""
                SELECT r.id,r.tenant_id,d.status,d.total_pages,d.ocr_applied FROM omega_rag.credit_reservations r
                JOIN omega_rag.documents d ON r.reference='document:'||d.id::text AND r.tenant_id=d.tenant_id
                WHERE r.status='RESERVED' AND d.status IN ('INDEXED','FAILED') LIMIT 100
                """)) {
            int charged="INDEXED".equals(row.get("status")) ? CreditOperation.pageCredits(((Number)row.get("total_pages")).intValue(),Boolean.TRUE.equals(row.get("ocr_applied"))) : 0;
            settle((UUID)row.get("tenant_id"),(UUID)row.get("id"),charged);
        }
        // All supported jobs have bounded inputs and timeouts; a lost process must not lock a customer's balance forever.
        for(Map<String,Object> row:jdbc.queryForList("SELECT id,tenant_id FROM omega_rag.credit_reservations WHERE status='RESERVED' AND created_at<now()-interval '24 hours' ORDER BY created_at LIMIT 100"))
            settle((UUID)row.get("tenant_id"),(UUID)row.get("id"),0);
    }

    public void lock(UUID tenant) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> {}, "billing:" + tenant);
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
        if ("FREE".equals(effectivePlan(sub, now))) return;
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
