package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import com.fasterxml.jackson.databind.*;
import com.omega.platform.domain.*;
import com.omega.platform.repository.*;
import com.omega.platform.security.*;
import com.omega.platform.service.AnalysisEvidenceService;
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

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class RoleEvidenceIntegrationTest {
    static PostgreSQLContainer<?> container;
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String url=System.getenv("OMEGA_TEST_DB_URL");
        if(url!=null && !url.isBlank()) {
            registry.add("spring.datasource.url",()->url);
            registry.add("spring.datasource.username",()->System.getenv().getOrDefault("OMEGA_TEST_DB_USER","omega_test"));
            registry.add("spring.datasource.password",()->System.getenv().getOrDefault("OMEGA_TEST_DB_PASSWORD","omega_test_only"));
        } else {
            container=new PostgreSQLContainer<>(DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres"));
            container.start();registry.add("spring.datasource.url",container::getJdbcUrl);
            registry.add("spring.datasource.username",container::getUsername);registry.add("spring.datasource.password",container::getPassword);
        }
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired AnalysisEvidenceService evidence;
    @Autowired ExpedienteRepository cases;
    @Autowired DocumentRepository documents;
    @Autowired DocumentChunkRepository chunks;
    @Autowired DevProjectRepository projects;
    @Autowired DevScanRepository scans;
    @Autowired DevFindingRepository findings;
    @Autowired UserRepository users;
    @Autowired ExpedientePermissionRepository permissions;
    @Autowired JwtService tokens;
    @Autowired com.omega.platform.billing.CreditService credits;
    @Autowired com.omega.platform.web.CommercialBillingController commercial;
    JsonNode register() throws Exception {
        return mapper.readTree(mvc.perform(post("/api/v1/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("fullName","Persona Pruebas","email","roles"+Long.toUnsignedString(System.nanoTime())+"@example.invalid","password","OmegaRole!2026","profile","GENERAL"))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    }
    OmegaPrincipal actor(JsonNode account) { return new OmegaPrincipal(UUID.fromString(account.path("userId").asText()),UUID.fromString(account.path("tenantId").asText()),account.path("email").asText(),Role.ANALYST,true); }
    String bearer(JsonNode account) { return "Bearer "+account.path("accessToken").asText(); }
    String body(Object value) throws Exception { return mapper.writeValueAsString(value); }
    void paid(OmegaPrincipal actor) { credits.summary(actor.tenantId()); jdbc.update("UPDATE omega_rag.subscriptions SET plan_code='PRO',status='ACTIVE',paid_verified=true,current_period_start=now(),current_period_end=now()+interval '1 month' WHERE tenant_id=?",actor.tenantId()); }

    @Test void generalSavesScopedEvidenceAndDeletionCannotBeReversedByJobPolling() throws Exception {
        var account=register();var actor=actor(account);
        var input=Map.of("total_matches",2,"diagnosis",Map.of("verdict_label","Requiere revisión","confidence","MEDIUM","rationale","Se observaron dos señales verificables","recommended_actions",List.of("Revisar las señales antes de actuar")),
            "raw_payload","PRIVATE_PAYLOAD","hostname","PRIVATE_HOST","password","PRIVATE_PASSWORD");
        UUID id=evidence.record(actor,null,"MOBILE_USB",input,"job-qa-one");
        assertThat(evidence.record(actor,null,"MOBILE_USB",input,"job-qa-one")).isNull();
        UUID caseId=jdbc.queryForObject("SELECT expediente_id FROM omega_rag.analysis_evaluations WHERE id=?",UUID.class,id);
        String history=mvc.perform(get("/api/v1/expedientes/"+caseId+"/evaluations").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(history).contains("Se observaron dos señales verificables").doesNotContain("PRIVATE_PAYLOAD","PRIVATE_HOST","PRIVATE_PASSWORD");
        var other=register();
        mvc.perform(get("/api/v1/expedientes/"+caseId+"/evaluations").header("Authorization",bearer(other))).andExpect(status().isNotFound());
        var report=mapper.readTree(mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON)
            .content(body(Map.of("profile","GENERAL","expedienteId",caseId)))).andExpect(status().isCreated()).andExpect(jsonPath("$.creditsCharged").value(0)).andReturn().getResponse().getContentAsString());
        byte[] pdf=mvc.perform(get("/api/v1/reports/"+report.path("id").asText()+"/pdf").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        try(var parsed=org.apache.pdfbox.Loader.loadPDF(pdf)) { assertThat(new org.apache.pdfbox.text.PDFTextStripper().getText(parsed)).contains("Se consolidan 1 evaluaciones guardadas","Se observaron dos señales verificables","Revisar las señales antes de actuar"); }
        mvc.perform(delete("/api/v1/expedientes/"+caseId+"/evaluations/"+id).header("Authorization",bearer(account))).andExpect(status().isNoContent());
        assertThat(evidence.record(actor,null,"MOBILE_USB",input,"job-qa-one")).isNull();
        mvc.perform(get("/api/v1/reports/"+report.path("id").asText()+"/pdf").header("Authorization",bearer(account))).andExpect(status().isNotFound());
    }

    @Test void legalReviewPreservesQuoteAndExportsReviewedSourcesWithoutChangingOldSnapshots() throws Exception {
        var account=register();var actor=actor(account);paid(actor);
        var legalCase=cases.saveAndFlush(new ExpedienteEntity(actor.tenantId(),actor.userId(),"Caso documental",ClassificationLevel.CONFIDENTIAL));
        var document=documents.saveAndFlush(new DocumentEntity(actor.tenantId(),legalCase.getId(),actor.userId(),"contrato.pdf","a".repeat(64),2,"local",false,DocumentStatus.INDEXED));
        chunks.saveAndFlush(new DocumentChunkEntity(actor.tenantId(),document.getId(),legalCase.getId(),"La parte deberá entregar un informe. El valor es COP 50000.",new float[1536],2,"Contrato",0,30,"local"));
        String path="/api/v1/expedientes/"+legalCase.getId()+"/observations";
        mvc.perform(post(path+"/extract").header("Authorization",bearer(account))).andExpect(status().isOk()).andExpect(jsonPath("$.created").value(2));
        var listing=mapper.readTree(mvc.perform(get(path).header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String id=listing.path("items").get(0).path("id").asText();
        String quote=listing.path("items").get(0).path("excerpt").asText();
        String review=body(Map.of("status","CONFIRMED","note","nota-exclusiva-QA-8031","revision",0));
        mvc.perform(patch(path+"/"+id).header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content(review)).andExpect(status().isOk());
        mvc.perform(patch(path+"/"+id).header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content(review)).andExpect(status().isConflict());
        mvc.perform(post(path+"/extract").header("Authorization",bearer(account))).andExpect(status().isOk()).andExpect(jsonPath("$.created").value(0));
        assertThat(jdbc.queryForObject("SELECT excerpt FROM omega_rag.legal_document_observations WHERE id=?",String.class,UUID.fromString(id))).isEqualTo(quote);
        var reader=users.saveAndFlush(new UserEntity(actor.tenantId(),"reader"+Long.toUnsignedString(System.nanoTime())+"@example.invalid","unused","Persona Lectura",Role.CLIENT));
        permissions.saveAndFlush(new ExpedientePermissionEntity(actor.tenantId(),legalCase.getId(),reader.getId(),ExpedientePermissionLevel.READ));
        String readerToken="Bearer "+tokens.issueToken(reader.getId(),actor.tenantId(),reader.getEmail(),Role.CLIENT);
        mvc.perform(patch(path+"/"+id).header("Authorization",readerToken).contentType(MediaType.APPLICATION_JSON).content(body(Map.of("status","REJECTED","note","No autorizado","revision",1)))).andExpect(status().isForbidden());
        var report=mapper.readTree(mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content(body(Map.of("profile","LEGAL","expedienteId",legalCase.getId())))).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        String reportPath="/api/v1/reports/"+report.path("id").asText();
        String json=mvc.perform(get(reportPath+"/json").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json).contains("nota-exclusiva-QA-8031","reviewedDocumentaryObservations");
        byte[] pdf=mvc.perform(get(reportPath+"/pdf").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        try(var parsed=org.apache.pdfbox.Loader.loadPDF(pdf)) {
            assertThat(new org.apache.pdfbox.text.PDFTextStripper().getText(parsed)).contains("nota-exclusiva-QA-8031",quote,"CONFIRMED",actor.userId().toString(),document.getId().toString(),"Pasajes documentales y cobertura");
        }
        mvc.perform(patch(path+"/"+id).header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON)
            .content(body(Map.of("status","REJECTED","note","Criterio actualizado QA","revision",1)))).andExpect(status().isOk());
        var next=mapper.readTree(mvc.perform(post("/api/v1/reports").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON)
            .content(body(Map.of("profile","LEGAL","expedienteId",legalCase.getId())))).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        assertThat(next.path("id").asText()).isNotEqualTo(report.path("id").asText());
        assertThat(mvc.perform(get(reportPath+"/pdf").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(pdf);
        byte[] updated=mvc.perform(get("/api/v1/reports/"+next.path("id").asText()+"/pdf").header("Authorization",bearer(account))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        try(var parsed=org.apache.pdfbox.Loader.loadPDF(updated)) {
            assertThat(new org.apache.pdfbox.text.PDFTextStripper().getText(parsed)).contains("Criterio actualizado QA","REJECTED").doesNotContain("nota-exclusiva-QA-8031");
        }
    }

    @Test void developerComparesActualScansAndLatestViewDoesNotMixHistoricalFindings() throws Exception {
        var account=register();var actor=actor(account);paid(actor);
        var project=projects.saveAndFlush(new DevProjectEntity(actor.tenantId(),actor.userId(),"Proyecto seguro","role-dev-project",null,"main","ARCHIVE"));
        var before=new DevScanEntity(actor.tenantId(),project.getId(),actor.userId(),"UI","2.0","aaa","main",50,50,false,"[]","{}",2,0,"WARN");
        org.springframework.test.util.ReflectionTestUtils.setField(before,"createdAt",java.time.Instant.now().minusSeconds(60));before=scans.saveAndFlush(before);
        var after=scans.saveAndFlush(new DevScanEntity(actor.tenantId(),project.getId(),actor.userId(),"UI","2.0","bbb","main",40,40,false,"[]","{}",2,0,"WARN"));
        for(var pair:List.of(Map.entry(before.getId(),"a"),Map.entry(before.getId(),"b"),Map.entry(after.getId(),"b"),Map.entry(after.getId(),"c")))
            findings.saveAndFlush(new DevFindingEntity(actor.tenantId(),project.getId(),pair.getKey(),pair.getValue().repeat(64),"NPM-POSTINSTALL-EXEC-01","static","HIGH","Hook de instalación","package.json:scripts.postinstall","Descarga remota durante instalación",20));
        String query="?projectId="+project.getId();
        mvc.perform(get("/api/v1/dev/findings"+query).header("Authorization",bearer(account))).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].remediation.steps[0]").exists());
        mvc.perform(get("/api/v1/dev/findings"+query+"&latestOnly=false").header("Authorization",bearer(account))).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(4));
        mvc.perform(get("/api/v1/dev/reports/export/json"+query).header("Authorization",bearer(account))).andExpect(status().isOk())
            .andExpect(jsonPath("$.comparisons[0].added").value(1)).andExpect(jsonPath("$.comparisons[0].persisting").value(1)).andExpect(jsonPath("$.comparisons[0].notSeen").value(1));
    }
    @Test void failedMailCanBeRequeuedOnlyByItsAccountAndOnlyOnce() throws Exception {
        var account=register();var actor=actor(account);UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO omega_rag.transactional_mail(id,tenant_id,actor_user_id,event_key,subject,body,status,attempts,next_attempt_at) VALUES (?,?,?,?,?,?,'FAILED',5,now()-interval '1 minute')",
            id,actor.tenantId(),actor.userId(),"qa-retry:"+id,"Notificación de prueba","Sin contenido privado");
        org.springframework.test.util.ReflectionTestUtils.setField(commercial,"mailEnabled",true);
        try {
            var other=register();
            mvc.perform(post("/api/v1/commercial/billing/notifications/"+id+"/retry").header("Authorization",bearer(other))).andExpect(status().isConflict());
            mvc.perform(post("/api/v1/commercial/billing/notifications/"+id+"/retry").header("Authorization",bearer(account))).andExpect(status().isOk());
            mvc.perform(post("/api/v1/commercial/billing/notifications/"+id+"/retry").header("Authorization",bearer(account))).andExpect(status().isConflict());
            assertThat(jdbc.queryForObject("SELECT status FROM omega_rag.transactional_mail WHERE id=?",String.class,id)).isEqualTo("PENDING");
        } finally { org.springframework.test.util.ReflectionTestUtils.setField(commercial,"mailEnabled",false); }
    }
}
