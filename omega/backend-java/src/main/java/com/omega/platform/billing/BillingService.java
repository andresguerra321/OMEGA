package com.omega.platform.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.omega.platform.security.OmegaPrincipal;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class BillingService {
    private static final Logger log = LoggerFactory.getLogger(BillingService.class);
    private final JdbcTemplate jdbc;
    private final CreditService credits;
    private final MercadoPagoClient mp;
    private final AccountAccessService access;
    private final TransactionTemplate tx;
    public BillingService(JdbcTemplate jdbc, CreditService credits, MercadoPagoClient mp, AccountAccessService access, PlatformTransactionManager manager) {
        this.jdbc = jdbc; this.credits = credits; this.mp = mp; this.access = access; this.tx = new TransactionTemplate(manager);
    }
    public List<Map<String,Object>> plans() { return jdbc.queryForList("SELECT * FROM omega_rag.billing_plans WHERE active ORDER BY price"); }

    public Map<String,Object> checkout(OmegaPrincipal actor, String plan, String interval, boolean topup, String payerEmail) {
        access.requireManager(actor); mp.requireEnabled();
        mp.validateSeller();
        credits.subscription(actor.tenantId());
        Map<String,Object> offer;
        if (topup) {
            credits.requirePaid(actor.tenantId());
            offer = Map.of("price", new BigDecimal("29900"), "credits", 200, "name", "200 créditos OMEGA");
        } else {
            if (plan==null || interval==null || !Set.of("PRO","ENTERPRISE").contains(plan) || !Set.of("MONTHLY","ANNUAL").contains(interval))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Selecciona un plan y un período válidos.");
            offer = jdbc.queryForMap("SELECT * FROM omega_rag.billing_plans WHERE plan_code=? AND interval=? AND active", plan, interval);
        }
        UUID id = tx.execute(s -> {
            credits.lock(actor.tenantId());
            // One recurring subscription at a time prevents accidental overlapping charges.
            if (!topup && !jdbc.queryForList("SELECT id FROM omega_rag.billing_checkouts WHERE tenant_id=? AND kind='SUBSCRIPTION' AND status IN ('CREATING','PENDING','ACTIVE','PAUSED','CANCEL_REQUESTED')",actor.tenantId()).isEmpty())
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Ya tienes una suscripción o un pago pendiente. Cancélalo antes de crear otro.");
            if (!topup && !"FREE".equals(CreditService.effectivePlan(jdbc.queryForMap("SELECT * FROM omega_rag.subscriptions WHERE tenant_id=?",actor.tenantId()),OffsetDateTime.now(ZoneOffset.UTC))))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Tu período pagado sigue activo. Puedes renovar o cambiar de plan al finalizar.");
            UUID key = UUID.randomUUID();
            jdbc.update("INSERT INTO omega_rag.billing_checkouts(id,tenant_id,actor_user_id,kind,plan_code,interval,amount,credits) VALUES (?,?,?,?,?,?,?,?)", key,actor.tenantId(),actor.userId(),topup?"TOPUP":"SUBSCRIPTION",plan,interval,offer.get("price"),offer.get("credits"));
            return key;
        });
        try {
            JsonNode response;
            if (topup) {
                response = mp.post("/checkout/preferences",Map.of("external_reference",id.toString(),
                        "items",List.of(Map.of("title",offer.get("name"),"quantity",1,"currency_id","COP","unit_price",offer.get("price"))),
                        "notification_url",mp.publicBaseUrl+"/api/v1/billing/webhooks/mercadopago",
                        "back_urls",Map.of("success",mp.returnUrl,"pending",mp.returnUrl,"failure",mp.returnUrl)),id);
            } else {
                response = mp.post("/preapproval",Map.of("reason","OMEGA "+offer.get("name"),"external_reference",id.toString(),
                        "payer_email",payerEmail == null || payerEmail.isBlank() ? actor.email() : payerEmail,
                        "auto_recurring",Map.of("frequency","ANNUAL".equals(interval)?12:1,"frequency_type","months","transaction_amount",offer.get("price"),"currency_id","COP"),
                        "back_url",mp.returnUrl,"status","pending"),id);
            }
            String url = response.path("init_point").asText();
            if (topup && "test".equals(mp.mode)) url = response.path("sandbox_init_point").asText(url);
            java.net.URI checkoutUri = java.net.URI.create(url);
            if (!"https".equals(checkoutUri.getScheme()) || checkoutUri.getHost()==null
                    || !(checkoutUri.getHost().equals("mercadopago.com.co") || checkoutUri.getHost().endsWith(".mercadopago.com.co") || checkoutUri.getHost().endsWith(".mercadopago.com")))
                throw new IllegalStateException("Mercado Pago devolvió una URL de pago inválida");
            jdbc.update("UPDATE omega_rag.billing_checkouts SET mp_id=?,checkout_url=?,status=CASE WHEN status IN ('CANCEL_REQUESTED','CANCELLED','ACTIVE') THEN status ELSE 'PENDING' END WHERE id=?",response.path("id").asText(),url,id);
            return Map.of("checkoutUrl",url,"checkoutId",id,"mode",mp.mode);
        } catch (org.springframework.web.client.RestClientResponseException ex) {
            if(ex.getStatusCode().is4xxClientError()) jdbc.update("UPDATE omega_rag.billing_checkouts SET status='FAILED' WHERE id=?",id);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, checkoutFailure(ex.getResponseBodyAsString()));
        } catch (RuntimeException ex) {
            // A timeout can mean Mercado Pago created the subscription. Keep CREATING for reconciliation.
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"No se pudo confirmar la creación del pago. Actualiza el estado antes de reintentar.");
        }
    }

    static String checkoutFailure(String response) {
        String reason = response.toLowerCase(java.util.Locale.ROOT);
        if (reason.contains("payer") && (reason.contains("test") || reason.contains("real")))
            return "Mercado Pago requiere un comprador y un vendedor del mismo entorno. Usa el correo de una cuenta compradora de prueba distinta del vendedor.";
        if (reason.contains("payer") && (reason.contains("email") || reason.contains("invalid")))
            return "Mercado Pago rechazó el correo del comprador. Revisa el correo en Opciones de suscripción.";
        if (reason.contains("currency"))
            return "Mercado Pago rechazó la moneda de la suscripción. Verifica que la cuenta vendedora permita suscripciones en COP.";
        return "Mercado Pago no pudo preparar el pago. Revisa los datos y actualiza su estado.";
    }

    public void cancel(OmegaPrincipal actor) {
        access.requireManager(actor); mp.requireEnabled();
        List<Map<String,Object>> rows = jdbc.queryForList("SELECT * FROM omega_rag.billing_checkouts WHERE tenant_id=? AND kind='SUBSCRIPTION' AND status IN ('CREATING','PENDING','ACTIVE','PAUSED','CANCEL_REQUESTED')",actor.tenantId());
        for (Map<String,Object> checkout : rows) {
            jdbc.update("UPDATE omega_rag.billing_checkouts SET status='CANCEL_REQUESTED' WHERE id=?",checkout.get("id"));
            if(checkout.get("mp_id")==null) { recoverCheckout(checkout); continue; }
            mp.cancel(checkout.get("mp_id").toString());
            jdbc.update("UPDATE omega_rag.billing_checkouts SET status='CANCELLED' WHERE id=?",checkout.get("id"));
        }
        jdbc.update("UPDATE omega_rag.subscriptions SET cancel_at_period_end=true WHERE tenant_id=?",actor.tenantId());
        for(var checkout:rows) notifyPayment(checkout,checkout.get("id").toString(),"cancelled-renewal","OMEGA · Renovación cancelada",
                "La renovación automática fue cancelada. El acceso ya pagado se conserva hasta el final de su período. Puedes consultar la fecha en Cuenta · Mi plan y créditos.");
    }

    public void reconcile(UUID tenant) {
        if (!mp.enabled()) return;
        for(Map<String,Object> checkout:jdbc.queryForList("SELECT * FROM omega_rag.billing_checkouts WHERE tenant_id=? AND kind='SUBSCRIPTION' AND mp_id IS NULL AND status IN ('CREATING','CANCEL_REQUESTED')",tenant)) recoverCheckout(checkout);
        for (Map<String,Object> checkout : jdbc.queryForList("SELECT * FROM omega_rag.billing_checkouts WHERE tenant_id=? AND kind='SUBSCRIPTION' AND mp_id IS NOT NULL ORDER BY created_at DESC LIMIT 20",tenant)) {
            String id = checkout.get("mp_id").toString();
            if("CANCEL_REQUESTED".equals(checkout.get("status"))) {
                mp.cancel(id);
                jdbc.update("UPDATE omega_rag.billing_checkouts SET status='CANCELLED' WHERE id=?",checkout.get("id"));
            }
            processResource("subscription_preapproval",id);
            for (int offset=0; offset<100;) {
                // This endpoint rejects our explicit limit; use its page size and supported offset.
                JsonNode invoices = mp.get("/authorized_payments/search?preapproval_id="+id
                        +(offset==0 ? "" : "&offset="+offset));
                JsonNode results = invoices.path("results");
                for (JsonNode invoice : results) processInvoice(invoice);
                if (results.isEmpty()) break;
                offset += results.size();
                if (offset>=invoices.path("paging").path("total").asInt(offset)) break;
            }
        }
        for(Map<String,Object> checkout:jdbc.queryForList("SELECT id FROM omega_rag.billing_checkouts WHERE tenant_id=? AND kind='TOPUP' AND created_at>now()-interval '365 days' ORDER BY created_at DESC LIMIT 50",tenant)) {
            JsonNode payments=mp.get("/v1/payments/search?sort=date_created&criteria=desc&external_reference="+checkout.get("id")+"&limit=100");
            for(JsonNode payment:payments.path("results")) processPayment(mp.get("/v1/payments/"+payment.path("id").asText()),null);
        }
        for (Map<String,Object> payment : jdbc.queryForList("SELECT mp_payment_id FROM omega_rag.billing_payments WHERE tenant_id=? AND updated_at>now()-interval '400 days' ORDER BY updated_at DESC LIMIT 100",tenant))
            processPayment(mp.get("/v1/payments/"+payment.get("mp_payment_id")),null);
    }

    private void recoverCheckout(Map<String,Object> checkout) {
        // Bound recovery work per pass; an unresolved checkout stays blocked against duplicate subscriptions.
        for(int offset=0;offset<1000;offset+=100) {
            JsonNode page=mp.get("/preapproval/search?limit=100&offset="+offset);
            for(JsonNode remote:page.path("results")) {
                if(!checkout.get("id").toString().equals(remote.path("external_reference").asText())) continue;
                String id=remote.path("id").asText();
                if(!id.matches("[a-zA-Z0-9_-]{1,100}")) throw new IllegalStateException("Suscripción remota inválida");
                jdbc.update("UPDATE omega_rag.billing_checkouts SET mp_id=?,checkout_url=?,status=CASE WHEN status='CANCEL_REQUESTED' THEN status ELSE 'PENDING' END WHERE id=?",id,remote.path("init_point").asText(),checkout.get("id"));
                if("CANCEL_REQUESTED".equals(checkout.get("status"))) {
                    mp.cancel(id);jdbc.update("UPDATE omega_rag.billing_checkouts SET status='CANCELLED' WHERE id=?",checkout.get("id"));
                }
                return;
            }
            if(page.path("results").size()<100) return;
        }
        log.warn("Creación de suscripción pendiente de revisión: {}",checkout.get("id"));
    }

    public void processResource(String topic,String id) {
        if ("payment".equals(topic)) processPayment(mp.get("/v1/payments/"+id),null);
        else if ("subscription_authorized_payment".equals(topic)) processInvoice(mp.get("/authorized_payments/"+id));
        else if ("subscription_preapproval".equals(topic)) {
            JsonNode sub = mp.get("/preapproval/"+id);
            String state = sub.path("status").asText();
            if (Set.of("cancelled","canceled","paused").contains(state)) {
                jdbc.update("UPDATE omega_rag.billing_checkouts SET status=? WHERE mp_id=? AND kind='SUBSCRIPTION' AND status<>'CANCEL_REQUESTED'","paused".equals(state)?"PAUSED":"CANCELLED",id);
                jdbc.update("UPDATE omega_rag.subscriptions SET cancel_at_period_end=true WHERE mp_preapproval_id=?",id);
            } else if("authorized".equals(state)) {
                jdbc.update("UPDATE omega_rag.billing_checkouts SET status=CASE WHEN status='ACTIVE' THEN status ELSE 'PENDING' END WHERE mp_id=? AND kind='SUBSCRIPTION' AND status IN ('PENDING','PAUSED','ACTIVE')",id);
                jdbc.update("UPDATE omega_rag.subscriptions SET cancel_at_period_end=false WHERE mp_preapproval_id=? AND NOT EXISTS (SELECT 1 FROM omega_rag.billing_checkouts c WHERE c.mp_id=? AND c.status IN ('CANCEL_REQUESTED','CANCELLED'))",id,id);
            }
            // Authorization alone never grants access.
        }
    }

    private void processInvoice(JsonNode invoice) {
        String paymentId = invoice.path("payment").path("id").asText();
        if (!paymentId.matches("[0-9]+")) return;
        processPayment(mp.get("/v1/payments/"+paymentId),invoice.path("preapproval_id").asText());
    }

    public void processPayment(JsonNode payment,String preapprovalId) {
        mp.validatePayment(payment);
        String id=payment.path("id").asText(), state=payment.path("status").asText();
        List<Map<String,Object>> checkouts;
        if (preapprovalId != null) checkouts=jdbc.queryForList("SELECT * FROM omega_rag.billing_checkouts WHERE mp_id=? AND kind='SUBSCRIPTION'",preapprovalId);
        else {
            UUID reference;
            try { reference=UUID.fromString(payment.path("external_reference").asText()); }
            catch (IllegalArgumentException ex) { return; }
            checkouts=jdbc.queryForList("SELECT * FROM omega_rag.billing_checkouts WHERE id=?",reference);
            if (!checkouts.isEmpty() && "SUBSCRIPTION".equals(checkouts.getFirst().get("kind"))) {
                // A recurring payment must be tied to a verified subscription invoice.
                JsonNode invoices=mp.get("/authorized_payments/search?payment_id="+id);
                for(JsonNode invoice:invoices.path("results")) {
                    if (id.equals(invoice.path("payment").path("id").asText())) {
                        processPayment(payment,invoice.path("preapproval_id").asText()); return;
                    }
                }
                return;
            }
        }
        if(checkouts.isEmpty()) return;
        Map<String,Object> checkout=checkouts.getFirst();
        if(new BigDecimal(payment.path("transaction_amount").asText("0")).compareTo((BigDecimal)checkout.get("amount"))!=0
                || !checkout.get("currency").equals(payment.path("currency_id").asText())) throw new IllegalStateException("El importe o la moneda no coinciden");
        UUID tenant=(UUID)checkout.get("tenant_id");
        credits.subscription(tenant);
        tx.executeWithoutResult(s -> {
            credits.lock(tenant);
            jdbc.update("INSERT INTO omega_rag.billing_payments(mp_payment_id,checkout_id,tenant_id,amount,currency,status) VALUES (?,?,?,?,?,?) ON CONFLICT(mp_payment_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now()",id,checkout.get("id"),tenant,checkout.get("amount"),checkout.get("currency"),state);
            Map<String,Object> previous=jdbc.queryForMap("SELECT * FROM omega_rag.billing_payments WHERE mp_payment_id=? FOR UPDATE",id);
            if (Set.of("refunded","charged_back").contains(state) || payment.path("transaction_amount_refunded").decimalValue().signum()>0) {
                jdbc.update("UPDATE omega_rag.credit_grants SET remaining=0,expires_at=now() WHERE tenant_id=? AND (grant_key=? OR grant_key LIKE ?)",tenant,"topup:"+id,"subscription:"+id+":%");
                jdbc.update("UPDATE omega_rag.subscriptions SET paid_verified=false,status='CANCELED' WHERE tenant_id=? AND source_payment_id=?",tenant,id);
                notifyPayment(checkout,id,"reversed","OMEGA · Actualización de tu pago",
                        "El pago " + id + " registra una devolución o reversión. Consulta el estado de tu membresía en OMEGA. Si corresponde una nota crédito fiscal, se tramita por separado.");
                return;
            }
            if(Set.of("rejected","cancelled").contains(state)) notifyPayment(checkout,id,state,"OMEGA · No se confirm? el pago",
                    "No se confirm? el pago " + id + ". Consulta el estado en OMEGA y revisa el medio de pago en Mercado Pago antes de reintentar.");
            if(!"approved".equals(state) || Boolean.TRUE.equals(previous.get("applied"))) return;
            OffsetDateTime approved=OffsetDateTime.parse(payment.path("date_approved").asText());
            if("TOPUP".equals(checkout.get("kind"))) {
                credits.grant(tenant,"topup:"+id,"TOPUP",((Number)checkout.get("credits")).intValue(),approved.plusYears(1));
                jdbc.update("UPDATE omega_rag.billing_checkouts SET status='COMPLETED' WHERE id=?",checkout.get("id"));
            } else {
                OffsetDateTime end=approved.plusMonths("ANNUAL".equals(checkout.get("interval"))?12:1);
                Map<String,Object> existing=jdbc.queryForMap("SELECT * FROM omega_rag.subscriptions WHERE tenant_id=?",tenant);
                if (!Boolean.TRUE.equals(existing.get("paid_verified")) || approved.isAfter(CreditService.time(existing.get("current_period_start")))) {
                    jdbc.update("UPDATE omega_rag.credit_grants SET remaining=0,expires_at=now() WHERE tenant_id=? AND source='SUBSCRIPTION' AND expires_at>now()",tenant);
                    Map<String,Object> limits=jdbc.queryForMap("SELECT * FROM omega_rag.billing_plans WHERE plan_code=? AND interval=?",checkout.get("plan_code"),checkout.get("interval"));
                    String checkoutState=jdbc.queryForObject("SELECT status FROM omega_rag.billing_checkouts WHERE id=?",String.class,checkout.get("id"));
                    jdbc.update("UPDATE omega_rag.subscriptions SET plan_code=?,status='ACTIVE',paid_verified=true,billing_interval=?,mp_preapproval_id=?,source_payment_id=?,max_devices=?,monthly_ai_quota=?,current_period_start=?,current_period_end=?,cancel_at_period_end=?,updated_at=now() WHERE tenant_id=?",
                        checkout.get("plan_code"),checkout.get("interval"),checkout.get("mp_id"),id,limits.get("max_devices"),limits.get("credits"),approved,end,Set.of("CANCELLED","CANCEL_REQUESTED","PAUSED").contains(checkoutState),tenant);
                }
                jdbc.update("UPDATE omega_rag.billing_checkouts SET status=CASE WHEN status IN ('CANCELLED','CANCEL_REQUESTED','PAUSED') THEN status ELSE 'ACTIVE' END WHERE id=?",checkout.get("id"));
            }
            jdbc.update("UPDATE omega_rag.billing_payments SET applied=true,approved_at=? WHERE mp_payment_id=?",approved,id);
            notifyPayment(checkout,id,"approved","OMEGA · Pago confirmado",
                    "Confirmamos tu pago de " + checkout.get("amount") + " " + checkout.get("currency")
                    + ". Referencia de Mercado Pago: " + id + ". Consulta tu plan y el comprobante en Cuenta · Documentos y facturación. El comprobante de pago no sustituye una factura electrónica de venta.");
        });
    }

    private void notifyPayment(Map<String,Object> checkout,String id,String state,String subject,String body) {
        jdbc.update("INSERT INTO omega_rag.transactional_mail(tenant_id,actor_user_id,event_key,subject,body) VALUES (?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING",
                checkout.get("tenant_id"),checkout.get("actor_user_id"),"payment:"+id+":"+state,subject,body);
    }

    @Scheduled(fixedDelayString="${omega.billing.reconcile-delay-ms:300000}")
    public void processPending() {
        if (!mp.enabled()) return;
        for(Map<String,Object> event:jdbc.queryForList("SELECT * FROM omega_rag.billing_events WHERE NOT processed AND next_attempt_at<=now() ORDER BY next_attempt_at,received_at LIMIT 50")) {
            try {
                processResource(event.get("topic").toString(),event.get("resource_id").toString());
                jdbc.update("UPDATE omega_rag.billing_events SET processed=true WHERE id=?",event.get("id"));
            } catch(Exception ex) {
                jdbc.update("UPDATE omega_rag.billing_events SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=?",event.get("id"));
                log.warn("No se pudo conciliar evento de facturación {}",event.get("id"));
            }
        }
        for(UUID tenant:jdbc.queryForList("SELECT DISTINCT tenant_id FROM omega_rag.billing_checkouts WHERE status IN ('CREATING','ACTIVE','PENDING','PAUSED','CANCEL_REQUESTED') OR created_at>now()-interval '400 days'",UUID.class)) {
            try { reconcile(tenant); } catch(Exception ex) { log.warn("Conciliación de facturación pendiente para cuenta {}",tenant); }
        }
    }
}
