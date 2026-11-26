package com.omega.platform.service;

import com.omega.platform.security.OmegaPrincipal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CommercialDocuments {
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.omega.platform.billing.BillingAccountResolver billingResolver;

    private final JdbcTemplate jdbc;
    private final Map<String,String> documents;
    private final Map<String,String> seller;
    private final boolean published;
    private final String version;
    public CommercialDocuments(JdbcTemplate jdbc,Environment env) {
        this.jdbc=jdbc;
        seller=new LinkedHashMap<>();
        seller.put("name",env.getProperty("OMEGA_SELLER_LEGAL_NAME",""));
        seller.put("nit",env.getProperty("OMEGA_SELLER_NIT",""));
        seller.put("address",env.getProperty("OMEGA_SELLER_ADDRESS",""));
        seller.put("supportEmail",env.getProperty("OMEGA_SUPPORT_EMAIL",""));
        seller.put("privacyEmail",env.getProperty("OMEGA_PRIVACY_EMAIL",""));
        String reviewedDirectory=env.getProperty("OMEGA_COMMERCIAL_DOCUMENTS_DIR","");
        published=Boolean.parseBoolean(env.getProperty("OMEGA_COMMERCIAL_DOCUMENTS_PUBLISHED","false"))
                && !reviewedDirectory.isBlank() && seller.values().stream().allMatch(v -> !v.isBlank());
        documents=new LinkedHashMap<>();
        try {
            for(String name:List.of("terms","privacy")) {
                String text=published ? java.nio.file.Files.readString(java.nio.file.Path.of(reviewedDirectory).resolve(name+".txt"),StandardCharsets.UTF_8)
                        : new ClassPathResource("commercial/"+name+".txt").getContentAsString(StandardCharsets.UTF_8);
                for(var entry:seller.entrySet()) text=text.replace("{{"+entry.getKey()+"}}",entry.getValue().isBlank()?"Pendiente de completar":entry.getValue());
                documents.put(name,text);
            }
            version=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(documents.toString().getBytes(StandardCharsets.UTF_8))).substring(0,24);
        } catch(Exception ex) { throw new IllegalStateException("No se pudieron cargar los documentos comerciales",ex); }
    }
    public Map<String,Object> configuration() {
        return Map.of("published",published,"status",published?"PUBLISHED":"DRAFT","version",version,
                "seller",seller,"documents",documents,"invoiceStatus","NOT_CONFIGURED");
    }
    public boolean accepted(OmegaPrincipal actor) {
        UUID billingTenant = billingResolver != null ? billingResolver.resolveBillingTenantId(actor.tenantId()) : actor.tenantId();
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM omega_rag.commercial_acceptances WHERE tenant_id=? AND user_id=? AND version=?)",
                Boolean.class,billingTenant,actor.userId(),version));
    }
    public void accept(OmegaPrincipal actor,String requestedVersion) {
        if(!published) throw new ResponseStatusException(HttpStatus.CONFLICT,"Los documentos comerciales siguen en revisión; no se registra una aceptación definitiva.");
        if(!version.equals(requestedVersion)) throw new ResponseStatusException(HttpStatus.CONFLICT,"Los documentos cambiaron. Vuelve a revisarlos.");
        UUID billingTenant = billingResolver != null ? billingResolver.resolveBillingTenantId(actor.tenantId()) : actor.tenantId();
        jdbc.update("INSERT INTO omega_rag.commercial_acceptances(tenant_id,user_id,version) VALUES (?,?,?) ON CONFLICT DO NOTHING",billingTenant,actor.userId(),version);
    }
    public void requireRegistration(String requestedVersion) {
        if(published && !version.equals(requestedVersion)) throw new ResponseStatusException(HttpStatus.CONFLICT,"Debes revisar y aceptar la versión vigente de términos y tratamiento de datos antes de registrarte.");
    }
    public void recordRegistration(com.omega.platform.web.dto.AuthDtos.AuthTokenResponse response,String requestedVersion) {
        if(published) accept(new OmegaPrincipal(response.userId(),response.tenantId(),response.email(),response.role(),true),requestedVersion);
    }
    public void requireCheckout(OmegaPrincipal actor,boolean live) {
        if(live && !published) throw new ResponseStatusException(HttpStatus.CONFLICT,"Completa y publica los documentos comerciales antes de habilitar ventas reales.");
        if(published && !accepted(actor)) throw new ResponseStatusException(HttpStatus.CONFLICT,"Revisa y acepta los términos y el tratamiento de datos en Documentos y facturación antes de pagar.");
    }
}
