package com.omega.platform.billing;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AccountSeatService {
    private final JdbcTemplate jdbc;
    private final BillingPolicy policy;
    public AccountSeatService(JdbcTemplate jdbc, BillingPolicy policy) { this.jdbc=jdbc;this.policy=policy; }
    // The caller keeps this transaction open until the user is inserted.
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void requireAvailableSeat(UUID tenant) {
        Map<String,Object> account=jdbc.queryForMap("SELECT account_type FROM omega_rag.tenants WHERE id=? FOR UPDATE",tenant);
        if("INDIVIDUAL".equals(account.get("account_type"))) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Una cuenta individual no permite agregar miembros.");
        if (!policy.enforced()) return;
        List<Map<String,Object>> subs=jdbc.queryForList("SELECT * FROM omega_rag.subscriptions WHERE tenant_id=?",tenant);
        String plan=subs.isEmpty()?"FREE":CreditService.effectivePlan(subs.getFirst(),OffsetDateTime.now(ZoneOffset.UTC));
        Integer limit=jdbc.queryForObject("SELECT max_users FROM omega_rag.billing_plans WHERE plan_code=? AND interval='MONTHLY'",Integer.class,plan);
        Long used=jdbc.queryForObject("SELECT count(*) FROM omega_rag.users WHERE tenant_id=? AND active",Long.class,tenant);
        if(used>=limit) throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,"Tu plan permite "+limit+" usuario(s). Enterprise incluye 5 puestos.");
    }
}
