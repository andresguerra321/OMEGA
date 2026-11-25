package com.omega.platform.billing;

import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.repository.TenantRepository;
import com.omega.platform.service.ApiTokenService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/billing")
public class BillingController {
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private com.omega.platform.service.CommercialDocuments commercialDocuments;
    private final BillingService billing;
    private final CreditService credits;
    private final MercadoPagoClient mp;
    private final JdbcTemplate jdbc;
    private final AccountAccessService access;
    private final TenantRepository tenants;
    public BillingController(BillingService billing,CreditService credits,MercadoPagoClient mp,JdbcTemplate jdbc,AccountAccessService access,TenantRepository tenants) {
        this.billing=billing;this.credits=credits;this.mp=mp;this.jdbc=jdbc;this.access=access;this.tenants=tenants;
    }
    @GetMapping("/plans")
    public Map<String,Object> plans() {
        return Map.of("plans",billing.plans(),"mode",mp.mode,"enforced",credits.enforced(),"operations",Arrays.stream(CreditOperation.values()).map(op -> Map.of("code",op.name(),"label",op.label,"credits",op.credits,"paidOnly",op.paidOnly,"scope",op.scope)).toList());
    }
    @GetMapping("/summary")
    public Map<String,Object> summary(@AuthenticationPrincipal OmegaPrincipal actor) {
        Map<String,Object> result = credits.summary(actor.tenantId());
        var tenant=tenants.findByIdAndActiveTrue(actor.tenantId()).orElseThrow();
        result.put("accountType",tenant.getAccountType());
        result.put("profile",tenant.getProfile());
        result.put("workspaceAccess", BillingPolicy.freeWorkspace(tenant.getAccountType(), tenant.getProfile().name())
                || !"FREE".equals(result.get("planCode")));
        boolean canManage=access.canManage(actor.tenantId(),actor.userId(),actor.role());
        result.put("canManage",canManage);
        result.put("mode",mp.mode);
        result.put("checkouts",canManage ? jdbc.queryForList("SELECT id,kind,status,checkout_url,created_at FROM omega_rag.billing_checkouts WHERE tenant_id=? ORDER BY created_at DESC LIMIT 10",actor.tenantId()) : List.of());
        return result;
    }
    @GetMapping("/history")
    public List<Map<String,Object>> history(@AuthenticationPrincipal OmegaPrincipal actor) {
        access.requireManager(actor);
        return jdbc.queryForList("SELECT mp_payment_id,amount,currency,status,approved_at FROM omega_rag.billing_payments WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 100",actor.tenantId());
    }
    public record CheckoutRequest(String planCode,String interval,boolean topup,@Email @Size(max=255) String payerEmail) {}
    @PostMapping("/subscribe")
    public Map<String,Object> subscribe(@AuthenticationPrincipal OmegaPrincipal actor,@Valid @RequestBody CheckoutRequest request) {
        if(commercialDocuments!=null) commercialDocuments.requireCheckout(actor,"live".equals(mp.mode));
        return billing.checkout(actor,request.planCode(),request.interval(),request.topup(),request.payerEmail());
    }
    @PostMapping("/cancel")
    public Map<String,Object> cancel(@AuthenticationPrincipal OmegaPrincipal actor) { billing.cancel(actor); return Map.of("ok",true); }
    @PostMapping("/refresh")
    public Map<String,Object> refresh(@AuthenticationPrincipal OmegaPrincipal actor) {
        access.requireManager(actor);billing.reconcile(actor.tenantId());return summary(actor);
    }
    @PostMapping("/webhooks/mercadopago")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void webhook(HttpServletRequest request) {
        mp.requireEnabled();
        String id=request.getParameter("data.id"), topic=request.getParameter("type");
        if (id==null || !id.matches("[a-zA-Z0-9_-]{1,100}")
                || !MercadoPagoSignature.valid(mp.webhookSecret,request.getHeader("x-signature"),request.getHeader("x-request-id"),id))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Firma de notificación inválida");
        if (!Set.of("payment","subscription_authorized_payment","subscription_preapproval").contains(topic==null?"":topic)) return;
        String key=ApiTokenService.sha256Hex(topic+":"+id+":"+request.getHeader("x-signature")+":"+request.getHeader("x-request-id"));
        jdbc.update("INSERT INTO omega_rag.billing_events(id,dedup_key,topic,resource_id) VALUES (?,?,?,?) ON CONFLICT(dedup_key) DO NOTHING",UUID.randomUUID(),key,topic,id);
    }
}
