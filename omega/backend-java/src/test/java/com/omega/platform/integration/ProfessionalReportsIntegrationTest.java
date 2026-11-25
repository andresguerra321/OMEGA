package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import com.fasterxml.jackson.databind.*;
import com.omega.platform.domain.*;
import com.omega.platform.repository.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProfessionalReportsIntegrationTest {
    static PostgreSQLContainer<?> container;
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String url=System.getenv("OMEGA_TEST_DB_URL");
        if(url!=null && !url.isBlank()) {
            registry.add("spring.datasource.url",()->url);
            registry.add("spring.datasource.username",()->System.getenv().getOrDefault("OMEGA_TEST_DB_USER","omega_test"));
            registry.add("spring.datasource.password",()->System.getenv().getOrDefault("OMEGA_TEST_DB_PASSWORD","omega_test_only"));
        } else {
            container=new PostgreSQLContainer<>(DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres"));
            container.start(); registry.add("spring.datasource.url",container::getJdbcUrl);
            registry.add("spring.datasource.username",container::getUsername);registry.add("spring.datasource.password",container::getPassword);
        }
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.omega.platform.billing.CreditService credits;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired ExpedienteRepository cases;
    @Autowired DocumentRepository documents;
    @Autowired DocumentChunkRepository chunks;
    @Autowired DevProjectRepository projects;
    @Autowired DevScanRepository scans;
    @Autowired DevFindingRepository findings;
    @Autowired UserRepository users;
    @Autowired ExpedientePermissionRepository permissions;
    @Autowired com.omega.platform.security.JwtService tokens;

    JsonNode register() throws Exception {
        return mapper.readTree(mvc.perform(post("/api/v1/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("fullName","Persona Pruebas","email","report"+Long.toUnsignedString(System.nanoTime())+"@example.invalid","password","OmegaReport!2026","profile","GENERAL"))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    }
    String bearer(JsonNode account) { return "Bearer "+account.path("accessToken").asText(); }

    @Test void snapshotsAreFreeStableTenantIsolatedAndDeletedWithSourceDocuments() throws Exception {
        var account=register();
        UUID tenant=UUID.fromString(account.path("tenantId").asText()),user=UUID.fromString(account.path("userId").asText());
        var legalCase=cases.saveAndFlush(new ExpedienteEntity(tenant,user,"Caso de prueba",ClassificationLevel.CONFIDENTIAL));
        var doc=documents.saveAndFlush(new DocumentEntity(tenant,legalCase.getId(),user,"prueba.pdf","a".repeat(64),2,"local",false,DocumentStatus.INDEXED));
        credits.summary(tenant);
        int balance=jdbc.queryForObject("SELECT COALESCE(SUM(remaining),0) FROM omega_rag.credit_grants WHERE tenant_id=?",Integer.class,tenant);
        String body=mapper.writeValueAsString(Map.of("profile","GENERAL","expedienteId",legalCase.getId()));
        var report=mapper.readTree(mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.creditsCharged").value(0)).andReturn().getResponse().getContentAsString());
        mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.id").value(report.path("id").asText()));
        String path="/api/v1/reports/"+report.path("id").asText();
        byte[] first=mvc.perform(get(path+"/pdf").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        byte[] second=mvc.perform(get(path+"/pdf").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        assertThat(first).isEqualTo(second);
        assertThat(jdbc.queryForObject("SELECT COALESCE(SUM(remaining),0) FROM omega_rag.credit_grants WHERE tenant_id=?",Integer.class,tenant)).isEqualTo(balance);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.transactional_mail WHERE event_key=?",Integer.class,"report:"+report.path("id").asText())).isEqualTo(1);
        var other=register();
        mvc.perform(get(path+"/json").header("Authorization",bearer(other))).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/reports").header("Authorization",bearer(other))).andExpect(status().isOk()).andExpect(content().json("[]"));
        var delegate=users.saveAndFlush(new UserEntity(tenant,"delegate"+Long.toUnsignedString(System.nanoTime())+"@example.invalid","unused-hash","Persona Delegada",com.omega.platform.security.Role.ANALYST));
        var permission=permissions.saveAndFlush(new ExpedientePermissionEntity(tenant,legalCase.getId(),delegate.getId(),ExpedientePermissionLevel.READ));
        String delegatedBearer="Bearer "+tokens.issueToken(delegate.getId(),tenant,delegate.getEmail(),delegate.getRole());
        mvc.perform(get(path+"/pdf").header("Authorization",delegatedBearer)).andExpect(status().isOk());
        permissions.delete(permission); permissions.flush();
        mvc.perform(get(path+"/pdf").header("Authorization",delegatedBearer)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/reports").header("Authorization",delegatedBearer)).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON)
            .content(body.replace("GENERAL","LEGAL"))).andExpect(status().isPaymentRequired());
        jdbc.update("DELETE FROM omega_rag.documents WHERE id=? AND tenant_id=?",doc.getId(),tenant);
        mvc.perform(get(path+"/pdf").header("Authorization",bearer(account))).andExpect(status().isNotFound());
    }

    @Test void commercialDraftsArePublicButCannotBeAcceptedAsFinalDocuments() throws Exception {
        mvc.perform(get("/api/v1/public/commercial")).andExpect(status().isOk()).andExpect(jsonPath("$.published").value(false));
        var account=register();
        mvc.perform(post("/api/v1/commercial/acceptance").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content("{\"version\":\"wrong\"}"))
            .andExpect(status().isConflict());
        mvc.perform(put("/api/v1/commercial/billing/customer").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("legalName","Persona Pruebas","documentType","CC","documentNumber","12345","billingEmail","billing@example.invalid","address","Dirección de prueba","city","Bogotá"))))
            .andExpect(status().isOk());
        mvc.perform(get("/api/v1/commercial/billing").header("Authorization",bearer(account))).andExpect(status().isOk())
            .andExpect(jsonPath("$.customer.legal_name").value("Persona Pruebas")).andExpect(jsonPath("$.invoiceStatus").value("NOT_CONFIGURED"));
    }

    @Test void paidLegalAndDevelopmentReportsIncludeTheirOwnEvidenceAndDoNotChargeForExport() throws Exception {
        var account=register();
        UUID tenant=UUID.fromString(account.path("tenantId").asText()),user=UUID.fromString(account.path("userId").asText());
        credits.summary(tenant);
        jdbc.update("UPDATE omega_rag.subscriptions SET plan_code='PRO',status='ACTIVE',paid_verified=true,current_period_start=now(),current_period_end=now()+interval '1 month' WHERE tenant_id=?",tenant);
        var legalCase=cases.saveAndFlush(new ExpedienteEntity(tenant,user,"Expediente con citas",ClassificationLevel.CONFIDENTIAL));
        var doc=documents.saveAndFlush(new DocumentEntity(tenant,legalCase.getId(),user,"contrato.pdf","b".repeat(64),3,"local",false,DocumentStatus.INDEXED));
        chunks.saveAndFlush(new DocumentChunkEntity(tenant,doc.getId(),legalCase.getId(),"La contratista deberá entregar el informe. El valor es COP 150000.",new float[1536],3,"Cláusula",0,20,"local"));
        var legal=mapper.readTree(mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("profile","LEGAL","expedienteId",legalCase.getId()))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        mvc.perform(get("/api/v1/reports/"+legal.path("id").asText()+"/json").header("Authorization",bearer(account)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.analysis.documentaryObservations.candidatesFound").value(2))
            .andExpect(jsonPath("$.analysis.documentaryObservations.observations[0].pageNumber").value(3));
        var project=projects.saveAndFlush(new DevProjectEntity(tenant,user,"Proyecto informe","project-report",null,"main","ARCHIVE"));
        var scan=scans.saveAndFlush(new DevScanEntity(tenant,project.getId(),user,"UI","2.0","abc123","main",40,40,false,"[]","{}",1,2,"WARN"));
        findings.saveAndFlush(new DevFindingEntity(tenant,project.getId(),scan.getId(),"c".repeat(64),"SECRET-01","static","HIGH","Credencial expuesta","src/config.js:2","Revisar la credencial registrada",40));
        var dev=mapper.readTree(mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("profile","DEVELOPER","projectId",project.getId()))))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.creditsCharged").value(0)).andReturn().getResponse().getContentAsString());
        mvc.perform(get("/api/v1/reports/"+dev.path("id").asText()+"/json").header("Authorization",bearer(account)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.analysis.projects[0].commitSha").value("abc123"))
            .andExpect(jsonPath("$.analysis.findings[0].location").value("src/config.js:2"));
        assertThat(jdbc.queryForObject("SELECT COALESCE(SUM(remaining),0) FROM omega_rag.credit_grants WHERE tenant_id=?",Integer.class,tenant)).isEqualTo(30);
    }

    @Test void mailFailureRetriesWithoutChangingMembershipAndSuccessClearsMessageContent() throws Exception {
        var account=register();
        UUID tenant=UUID.fromString(account.path("tenantId").asText()),user=UUID.fromString(account.path("userId").asText());
        String key="qa-mail:"+UUID.randomUUID();
        jdbc.update("INSERT INTO omega_rag.transactional_mail(tenant_id,actor_user_id,event_key,subject,body,created_at) VALUES (?,?,?,?,?,'2000-01-01')",
            tenant,user,key,"OMEGA · Informe disponible","Consulta tu cuenta.");
        var sender=org.mockito.Mockito.mock(org.springframework.mail.javamail.JavaMailSender.class);
        @SuppressWarnings("unchecked") org.springframework.beans.factory.ObjectProvider<org.springframework.mail.javamail.JavaMailSender> provider=org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        org.mockito.Mockito.when(provider.getIfAvailable()).thenReturn(sender);
        org.mockito.Mockito.when(provider.getObject()).thenReturn(sender);
        org.mockito.Mockito.when(sender.createMimeMessage()).thenAnswer(invocation -> new jakarta.mail.internet.MimeMessage(jakarta.mail.Session.getInstance(new Properties())));
        org.mockito.Mockito.doThrow(new org.springframework.mail.MailSendException("offline")).doNothing().when(sender).send(org.mockito.ArgumentMatchers.any(jakarta.mail.internet.MimeMessage.class));
        var delivery=new com.omega.platform.service.TransactionalMailService(jdbc,provider,transactions,true,"qa@example.invalid");
        delivery.deliver();
        assertThat(jdbc.queryForObject("SELECT attempts FROM omega_rag.transactional_mail WHERE event_key=?",Integer.class,key)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM omega_rag.transactional_mail WHERE event_key=?",String.class,key)).isEqualTo("PENDING");
        jdbc.update("UPDATE omega_rag.transactional_mail SET next_attempt_at=now() WHERE event_key=?",key);
        delivery.deliver();
        assertThat(jdbc.queryForObject("SELECT status FROM omega_rag.transactional_mail WHERE event_key=?",String.class,key)).isEqualTo("SENT");
        assertThat(jdbc.queryForObject("SELECT body FROM omega_rag.transactional_mail WHERE event_key=?",String.class,key)).isEmpty();
    }
}
