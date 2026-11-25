package com.omega.platform.billing;

import com.fasterxml.jackson.databind.*;
import com.omega.platform.security.*;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.mockito.Mockito.*;

@SpringBootTest(properties = "OMEGA_BILLING_ENFORCE=true")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BillingIntegrationTest {
    private static PostgreSQLContainer<?> container;
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String external=System.getenv("OMEGA_TEST_DB_URL");
        if(external!=null && !external.isBlank()) {
            registry.add("spring.datasource.url",()->external);
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
    @Autowired CreditService credits;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @Autowired AccountAccessService access;
    @Autowired com.omega.platform.repository.DocumentRepository documents;

    JsonNode register(String profile) throws Exception {
        String email="billing"+Long.toUnsignedString(System.nanoTime())+"@example.invalid";
        JsonNode account=mapper.readTree(mvc.perform(post("/api/v1/auth/register").with(csrf())
                .with(request -> { request.setRemoteAddr("198.18."+ThreadLocalRandom.current().nextInt(256)+"."+ThreadLocalRandom.current().nextInt(1,255));return request; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("fullName","Persona Pruebas","email",email,"password","OmegaBilling!2026","profile",profile))))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        return account;
    }
    String bearer(JsonNode account) { return "Bearer "+account.path("accessToken").asText(); }
    UUID tenant(JsonNode account) { return UUID.fromString(account.path("tenantId").asText()); }
    UUID user(JsonNode account) { return UUID.fromString(account.path("userId").asText()); }

    @Test void reconciliationUsesSupportedInvoiceSearchAndAppliesApprovedPaymentOnce() throws Exception {
        JsonNode account=register("LEGAL");
        UUID tenant=tenant(account), checkout=UUID.randomUUID();
        String remote="subscription-"+checkout, paymentId=Long.toUnsignedString(System.nanoTime());
        jdbc.update("INSERT INTO omega_rag.billing_checkouts(id,tenant_id,actor_user_id,kind,plan_code,interval,amount,credits,mp_id,status) VALUES (?,?,?,'SUBSCRIPTION','PRO','MONTHLY',59900,500,?,'PENDING')",
                checkout, tenant, user(account), remote);
        MercadoPagoClient provider=mock(MercadoPagoClient.class);
        when(provider.enabled()).thenReturn(true);
        when(provider.get("/preapproval/"+remote)).thenReturn(mapper.valueToTree(Map.of("status","authorized")));
        JsonNode page=mapper.valueToTree(Map.of("paging",Map.of("total",2),
                "results",List.of(Map.of("payment",Map.of("id",paymentId),"preapproval_id",remote))));
        when(provider.get("/authorized_payments/search?preapproval_id="+remote)).thenReturn(page);
        when(provider.get("/authorized_payments/search?preapproval_id="+remote+"&offset=1")).thenReturn(page);
        when(provider.get("/v1/payments/"+paymentId)).thenReturn(mapper.valueToTree(Map.of(
                "id",paymentId,"status","approved","transaction_amount",59900,"currency_id","COP",
                "date_approved",OffsetDateTime.now().toString())));
        BillingService service=new BillingService(jdbc,credits,provider,access,transactions);
        service.reconcile(tenant);
        service.reconcile(tenant);
        assertThat(credits.summary(tenant).get("planCode")).isEqualTo("PRO");
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(530L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.billing_payments WHERE tenant_id=?",Integer.class,tenant)).isEqualTo(1);
        verify(provider,times(2)).get("/authorized_payments/search?preapproval_id="+remote+"&offset=1");
    }

    @Test void individualProfileRemainsVisibleWhilePaidActionsAreRestricted() throws Exception {
        JsonNode account=register("DEVELOPER");
        assertThat(account.path("role").asText()).isEqualTo("ANALYST");
        assertThat(account.path("accountType").asText()).isEqualTo("INDIVIDUAL");
        assertThat(account.path("canManageAccount").asBoolean()).isTrue();
        mvc.perform(get("/api/v1/public/status")).andExpect(status().isOk())
            .andExpect(jsonPath("$.plans[0].planCode").value("FREE")).andExpect(jsonPath("$.plans[0].monthlyCredits").value(30));
        mvc.perform(get("/api/v1/profile/config").header("Authorization",bearer(account))).andExpect(status().isOk())
            .andExpect(jsonPath("$.profile").value("DEVELOPER"))
            .andExpect(jsonPath("$.defaultView").value("repo_scanner"));
        mvc.perform(get("/api/v1/dev/projects").header("Authorization",bearer(account))).andExpect(status().isPaymentRequired());
        mvc.perform(get("/api/v1/legal/document-ai/policy").header("Authorization",bearer(account))).andExpect(status().isPaymentRequired());
        mvc.perform(put("/api/v1/profile").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content("{\"profile\":\"GENERAL\",\"confirmed\":true}")).andExpect(status().isOk());
        mvc.perform(put("/api/v1/profile").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content("{\"profile\":\"LEGAL\",\"confirmed\":true}")).andExpect(status().isPaymentRequired());
        assertThat(credits.summary(tenant(account)).get("balance")).isEqualTo(30L);
        assertThat(credits.summary(tenant(account)).get("balance")).isEqualTo(30L);
        JsonNode legal=register("LEGAL");
        mvc.perform(get("/api/v1/profile/config").header("Authorization",bearer(legal)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.profile").value("LEGAL"))
            .andExpect(jsonPath("$.defaultView").value("expedientes"));
        mvc.perform(get("/api/v1/legal/document-ai/policy").header("Authorization",bearer(legal)))
            .andExpect(status().isPaymentRequired());
    }

    @Test void reservationsAreAtomicSharedAndReleasedExactlyOnce() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account),user=user(account);
        try(var pool=Executors.newFixedThreadPool(8)) {
            var start=new CountDownLatch(1);List<Future<UUID>> futures=new ArrayList<>();
            for(int i=0;i<20;i++) futures.add(pool.submit(()-> { start.await();try{return credits.reserve(tenant,user,CreditOperation.AI_QUERY,3,null);}catch(org.springframework.web.server.ResponseStatusException ex){return null;} }));
            start.countDown();List<UUID> accepted=new ArrayList<>();
            for(var future:futures) { UUID id=future.get(15,TimeUnit.SECONDS);if(id!=null)accepted.add(id); }
            assertThat(accepted).hasSize(10);
            assertThat(credits.summary(tenant).get("balance")).isEqualTo(0L);
            for(UUID id:accepted) { credits.settle(tenant,id,0);credits.settle(tenant,id,0); }
            assertThat(credits.summary(tenant).get("balance")).isEqualTo(30L);
        }
    }

    @Test void confirmedPaymentGrantsOnceAndRefundRevokesAccess() throws Exception {
        JsonNode account=register("DEVELOPER");UUID tenant=tenant(account),checkout=UUID.randomUUID();
        String remoteId="sub-"+checkout;
        jdbc.update("INSERT INTO omega_rag.billing_checkouts(id,tenant_id,actor_user_id,kind,plan_code,interval,amount,credits,mp_id,status) VALUES (?,?,?,'SUBSCRIPTION','PRO','ANNUAL',599000,500,?,'PENDING')",checkout,tenant,user(account),remoteId);
        MercadoPagoClient provider=mock(MercadoPagoClient.class);
        BillingService service=new BillingService(jdbc,credits,provider,access,transactions);
        JsonNode payment=mapper.valueToTree(Map.of("id",Long.toUnsignedString(System.nanoTime()),"status","approved","transaction_amount",599000,"currency_id","COP","date_approved",OffsetDateTime.now().minusMonths(2).toString()));
        service.processPayment(payment,remoteId);service.processPayment(payment,remoteId);
        assertThat(credits.summary(tenant).get("planCode")).isEqualTo("PRO");
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(530L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.credit_grants WHERE tenant_id=? AND source='SUBSCRIPTION'",Integer.class,tenant)).isEqualTo(1);
        mvc.perform(get("/api/v1/profile/config").header("Authorization",bearer(account))).andExpect(status().isOk()).andExpect(jsonPath("$.profile").value("DEVELOPER"));
        ((com.fasterxml.jackson.databind.node.ObjectNode)payment).put("status","refunded");service.processPayment(payment,remoteId);
        assertThat(credits.summary(tenant).get("planCode")).isEqualTo("FREE");
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(30L);
    }

    @Test void tenantCannotSpendAnotherTenantsReservation() throws Exception {
        JsonNode first=register("GENERAL"),second=register("GENERAL");
        UUID reservation=credits.reserve(tenant(first),user(first),CreditOperation.AI_QUERY,5,null);
        assertThatThrownBy(()->credits.settle(tenant(second),reservation,0)).isInstanceOf(org.springframework.dao.EmptyResultDataAccessException.class);
        assertThat(credits.summary(tenant(first)).get("balance")).isEqualTo(25L);
        assertThat(credits.summary(tenant(second)).get("balance")).isEqualTo(30L);
    }

    @Test void cloudQueriesActuallyPassThroughMeteringAdvisorAndFailuresReleaseBalance() throws Exception {
        JsonNode account=register("GENERAL");
        mvc.perform(post("/api/v1/cti/query").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content("{\"question\":\"Explica spyware\"}"))
            .andExpect(status().isOk());
        // Empty corpus is a result without a generated answer; the reserve is released.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.credit_reservations WHERE tenant_id=? AND operation='AI_QUERY'",Integer.class,tenant(account))).isEqualTo(1);
        assertThat(credits.summary(tenant(account)).get("balance")).isEqualTo(30L);
    }

    @Test void expensiveOperationsQuoteBeforeExecutingAndFailedWorkerRefunds() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account);
        credits.subscription(tenant);
        jdbc.update("UPDATE omega_rag.subscriptions SET plan_code='PRO',paid_verified=true,source_payment_id=?,current_period_start=now(),current_period_end=now()+interval '1 month' WHERE tenant_id=?","quote-"+tenant,tenant);
        var file=new org.springframework.mock.web.MockMultipartFile("files","sample.txt","text/plain","test artifact".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/v1/forensics/yara/scan").file(file).header("Authorization",bearer(account)))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("OMEGA_CREDIT_QUOTE:5:YARA_SCAN")));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.credit_reservations WHERE tenant_id=?",Integer.class,tenant)).isZero();
        mvc.perform(multipart("/api/v1/forensics/yara/scan").file(file).header("Authorization",bearer(account)).header("X-Omega-Credit-Limit","5"))
            .andExpect(status().is5xxServerError());
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(530L);
    }

    @Test void partialSettlementReturnsOnlyTheUnusedOcrReserve() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account);
        UUID id=credits.reserve(tenant,user(account),CreditOperation.AI_QUERY,9,null);
        credits.settle(tenant,id,3);credits.settle(tenant,id,0);
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(27L);
        assertThat(jdbc.queryForObject("SELECT charged FROM omega_rag.credit_reservations WHERE id=?",Integer.class,id)).isEqualTo(3);
    }

    @Test void oldAmbiguousAccountCanConfirmIndividualWithoutLosingData() throws Exception {
        JsonNode account=register("GENERAL");
        jdbc.update("UPDATE omega_rag.tenants SET account_type='UNCLASSIFIED' WHERE id=?",tenant(account));
        jdbc.update("UPDATE omega_rag.users SET role='ADMIN' WHERE id=?",user(account));
        mvc.perform(post("/api/v1/account/type").header("Authorization",bearer(account)).contentType(MediaType.APPLICATION_JSON).content("{\"accountType\":\"INDIVIDUAL\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("ANALYST"));
        mvc.perform(get("/api/v1/auth/me").header("Authorization",bearer(account)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.accountType").value("INDIVIDUAL")).andExpect(jsonPath("$.canManageAccount").value(true));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.expedientes WHERE tenant_id=?",Integer.class,tenant(account))).isEqualTo(1);
    }

    @Test void rejectedPaymentCannotGrantCreditsOrProfessionalAccess() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account),checkout=UUID.randomUUID();
        jdbc.update("INSERT INTO omega_rag.billing_checkouts(id,tenant_id,actor_user_id,kind,plan_code,interval,amount,credits,mp_id) VALUES (?,?,?,'SUBSCRIPTION','PRO','MONTHLY',59900,500,?)",checkout,tenant,user(account),checkout.toString());
        BillingService service=new BillingService(jdbc,credits,mock(MercadoPagoClient.class),access,transactions);
        service.processPayment(mapper.valueToTree(Map.of("id","rejected-"+checkout,"status","rejected","transaction_amount",59900,"currency_id","COP")),checkout.toString());
        assertThat(credits.summary(tenant).get("planCode")).isEqualTo("FREE");
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(30L);
    }

    @Test void asyncDocumentReconciliationChargesTextInsteadOfTheOcrMaximum() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account);
        credits.subscription(tenant);
        jdbc.update("UPDATE omega_rag.subscriptions SET plan_code='PRO',paid_verified=true,source_payment_id=?,current_period_start=now(),current_period_end=now()+interval '1 month' WHERE tenant_id=?","document-test-"+tenant,tenant);
        UUID caseId=jdbc.queryForObject("SELECT id FROM omega_rag.expedientes WHERE tenant_id=?",UUID.class,tenant);
        var document=new com.omega.platform.domain.DocumentEntity(tenant,caseId,user(account),"paper.pdf","a".repeat(64),24,"test-model",false,com.omega.platform.domain.DocumentStatus.INDEXED);
        documents.saveAndFlush(document);
        UUID reservation=credits.reserve(tenant,user(account),CreditOperation.LEGAL_INDEX,9,null);
        credits.attachReference(tenant,reservation,"document:"+document.getId());
        credits.reconcileDocuments();credits.reconcileDocuments();
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(527L);
        assertThat(jdbc.queryForObject("SELECT charged FROM omega_rag.credit_reservations WHERE id=?",Integer.class,reservation)).isEqualTo(3);
    }

    @Test void lostProcessDoesNotReserveCreditsForever() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account);
        UUID reservation=credits.reserve(tenant,user(account),CreditOperation.AI_QUERY,4,null);
        jdbc.update("UPDATE omega_rag.credit_reservations SET created_at=now()-interval '25 hours' WHERE id=?",reservation);
        credits.reconcileDocuments();
        assertThat(credits.summary(tenant).get("balance")).isEqualTo(30L);
        assertThat(jdbc.queryForObject("SELECT status FROM omega_rag.credit_reservations WHERE id=?",String.class,reservation)).isEqualTo("RELEASED");
    }

    @Test void uncertainCheckoutCannotCreateAnotherRecurringCharge() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account);
        var provider=spy(new MercadoPagoClient("test","token","123","secret","https://backend.invalid","https://app.invalid"));
        doNothing().when(provider).validateSeller();
        doThrow(new org.springframework.web.client.ResourceAccessException("timeout")).when(provider).post(anyString(),anyMap(),any(UUID.class));
        BillingService service=new BillingService(jdbc,credits,provider,access,transactions);
        var actor=new OmegaPrincipal(user(account),tenant,account.path("email").asText(),Role.ANALYST,true);
        assertThatThrownBy(()->service.checkout(actor,"PRO","MONTHLY",false,null))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThatThrownBy(()->service.checkout(actor,"PRO","MONTHLY",false,null))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class).hasMessageContaining("409");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM omega_rag.billing_checkouts WHERE tenant_id=?",Integer.class,tenant)).isEqualTo(1);
        verify(provider,times(1)).post(anyString(),anyMap(),any(UUID.class));
    }

    @Test void checkoutResponseDoesNotOverwriteAConcurrentCancellation() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account);
        var provider=spy(new MercadoPagoClient("test","token","123","secret","https://backend.invalid","https://app.invalid"));
        doNothing().when(provider).validateSeller();
        doAnswer(call -> {
            UUID id=call.getArgument(2);
            jdbc.update("UPDATE omega_rag.billing_checkouts SET status='CANCEL_REQUESTED' WHERE id=?",id);
            return mapper.valueToTree(Map.of("id","sub-"+id,"init_point","https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id="+id));
        }).when(provider).post(anyString(),anyMap(),any(UUID.class));
        BillingService service=new BillingService(jdbc,credits,provider,access,transactions);
        service.checkout(new OmegaPrincipal(user(account),tenant,account.path("email").asText(),Role.ANALYST,true),"PRO","MONTHLY",false,null);
        assertThat(jdbc.queryForObject("SELECT status FROM omega_rag.billing_checkouts WHERE tenant_id=?",String.class,tenant)).isEqualTo("CANCEL_REQUESTED");
        assertThat(credits.isPaid(tenant)).isFalse();
    }

    @Test void authorizedSubscriptionIsNotProofOfPaymentAndPausedSubscriptionBlocksDuplicates() throws Exception {
        JsonNode account=register("GENERAL");UUID tenant=tenant(account),checkout=UUID.randomUUID();
        String remote="state-"+checkout;
        jdbc.update("INSERT INTO omega_rag.billing_checkouts(id,tenant_id,actor_user_id,kind,plan_code,interval,amount,credits,mp_id,status) VALUES (?,?,?,'SUBSCRIPTION','PRO','MONTHLY',59900,500,?,'PENDING')",checkout,tenant,user(account),remote);
        var provider=spy(new MercadoPagoClient("test","token","123","secret","https://backend.invalid","https://app.invalid"));
        doNothing().when(provider).validateSeller();
        doReturn(mapper.valueToTree(Map.of("status","authorized"))).when(provider).get("/preapproval/"+remote);
        BillingService service=new BillingService(jdbc,credits,provider,access,transactions);
        service.processResource("subscription_preapproval",remote);
        assertThat(credits.isPaid(tenant)).isFalse();
        doReturn(mapper.valueToTree(Map.of("status","paused"))).when(provider).get("/preapproval/"+remote);
        service.processResource("subscription_preapproval",remote);
        assertThat(jdbc.queryForObject("SELECT status FROM omega_rag.billing_checkouts WHERE id=?",String.class,checkout)).isEqualTo("PAUSED");
        assertThatThrownBy(()->service.checkout(new OmegaPrincipal(user(account),tenant,account.path("email").asText(),Role.ANALYST,true),"PRO","MONTHLY",false,null))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class).hasMessageContaining("409");
    }
}
