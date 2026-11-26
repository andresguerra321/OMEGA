package com.omega.platform.web;

import com.omega.platform.billing.AccountAccessService;
import com.omega.platform.billing.BillingAccountResolver;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.service.CommercialDocuments;
import com.omega.platform.service.ReportPdf;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/commercial/billing")
public class CommercialBillingController {
    @Value("${OMEGA_TRANSACTIONAL_MAIL_ENABLED:false}")
    private boolean mailEnabled;
    private final JdbcTemplate jdbc;
    private final AccountAccessService access;
    private final BillingAccountResolver resolver;
    private final CommercialDocuments documents;
    private final String mode;

    @Autowired
    public CommercialBillingController(
            JdbcTemplate jdbc,
            AccountAccessService access,
            BillingAccountResolver resolver,
            CommercialDocuments documents,
            @Value("${OMEGA_MP_MODE:disabled}") String mode
    ) {
        this.jdbc=jdbc; this.access=access; this.resolver=resolver; this.documents=documents; this.mode=mode;
    }

    public record CustomerDetails(@NotBlank @Size(max=200) String legalName,
        @Pattern(regexp="CC|NIT|CE|PASSPORT") @NotNull String documentType,
        @NotBlank @Size(max=40) String documentNumber,@NotBlank @Email @Size(max=255) String billingEmail,
        @NotBlank @Size(max=300) String address,@NotBlank @Size(max=100) String city) {}

    @GetMapping public Map<String,Object> summary(@AuthenticationPrincipal OmegaPrincipal actor) {
        access.requireBillingManager(actor);
        UUID billingTenant = resolver.resolveBillingTenantId(actor.tenantId());
        var details=jdbc.queryForList("SELECT * FROM omega_rag.billing_customer_details WHERE tenant_id=?",billingTenant);
        return Map.of("customer",details.isEmpty()?Map.of():details.getFirst(),"invoiceStatus","NOT_CONFIGURED","mailEnabled",mailEnabled,
            "payments",jdbc.queryForList("SELECT mp_payment_id,amount,currency,status,approved_at FROM omega_rag.billing_payments WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 100",billingTenant),
            "notifications",jdbc.queryForList("SELECT id,subject,status,attempts,created_at,sent_at,next_attempt_at FROM omega_rag.transactional_mail WHERE tenant_id=? AND actor_user_id=? ORDER BY created_at DESC LIMIT 30",billingTenant,actor.userId()));
    }

    @PostMapping("/notifications/{id}/retry") public Map<String,Object> retry(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable UUID id) {
        access.requireBillingManager(actor);
        if(!mailEnabled) throw new ResponseStatusException(HttpStatus.CONFLICT,"El envío de correo está desactivado en esta instalación.");
        UUID billingTenant = resolver.resolveBillingTenantId(actor.tenantId());
        int changed=jdbc.update("UPDATE omega_rag.transactional_mail SET status='PENDING',attempts=0,next_attempt_at=now() WHERE tenant_id=? AND actor_user_id=? AND id=? AND status='FAILED' AND next_attempt_at<=now()",billingTenant,actor.userId(),id);
        if(changed==0) throw new ResponseStatusException(HttpStatus.CONFLICT,"La notificación no está disponible para reintentar todavía.");
        return Map.of("queued",true);
    }

    @PutMapping("/customer") public Map<String,Object> update(@AuthenticationPrincipal OmegaPrincipal actor,@Valid @RequestBody CustomerDetails request) {
        access.requireBillingManager(actor);
        UUID billingTenant = resolver.resolveBillingTenantId(actor.tenantId());
        jdbc.update("""
            INSERT INTO omega_rag.billing_customer_details(tenant_id,legal_name,document_type,document_number,billing_email,address,city)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET legal_name=EXCLUDED.legal_name,document_type=EXCLUDED.document_type,
            document_number=EXCLUDED.document_number,billing_email=EXCLUDED.billing_email,address=EXCLUDED.address,city=EXCLUDED.city,updated_at=now()
            """,billingTenant,request.legalName(),request.documentType(),request.documentNumber(),request.billingEmail(),request.address(),request.city());
        return Map.of("saved",true);
    }

    @GetMapping("/receipts/{paymentId}") public ResponseEntity<byte[]> receipt(@AuthenticationPrincipal OmegaPrincipal actor,@PathVariable String paymentId) {
        access.requireBillingManager(actor);
        UUID billingTenant = resolver.resolveBillingTenantId(actor.tenantId());
        var payments=jdbc.queryForList("SELECT * FROM omega_rag.billing_payments WHERE tenant_id=? AND mp_payment_id=? AND approved_at IS NOT NULL",billingTenant,paymentId);
        if(payments.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Comprobante no disponible");
        var payment=payments.getFirst();
        @SuppressWarnings("unchecked") var seller=(Map<String,String>)documents.configuration().get("seller");
        byte[] bytes=ReportPdf.render("OMEGA · Comprobante de pago" + ("test".equals(mode)?" · PRUEBA":""),"Referencia Mercado Pago: " + paymentId,List.of(
            new ReportPdf.Section("Pago registrado",List.of("Importe: " + payment.get("amount") + " " + payment.get("currency"),
                "Aprobación registrada: " + payment.get("approved_at"),"Estado actual del pago: " + payment.get("status"))),
            new ReportPdf.Section("Prestador",List.of("Nombre: " + seller.get("name"),"NIT: " + seller.get("nit"),"Contacto: " + seller.get("supportEmail"))),
            new ReportPdf.Section("Alcance del comprobante",List.of("Este documento acredita el registro de un pago en OMEGA. No es una factura electrónica de venta, no contiene CUFE ni certifica validación DIAN.",
                "La factura fiscal, cuando corresponda, se expide por el proceso de facturación habilitado. Cancelar la renovación y solicitar una devolución son trámites diferentes."))));
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).cacheControl(CacheControl.noStore())
            .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"omega-payment.pdf\"").body(bytes);
    }
}
