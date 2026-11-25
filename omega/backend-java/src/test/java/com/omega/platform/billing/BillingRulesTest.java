package com.omega.platform.billing;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class BillingRulesTest {
    @Test void checkoutErrorsExplainKnownFailuresWithoutEchoingProviderData() {
        assertThat(BillingService.checkoutFailure("Both payer and collector must be real or test users"))
                .contains("cuenta compradora de prueba");
        assertThat(BillingService.checkoutFailure("invalid payer email: private@example.invalid"))
                .contains("correo").doesNotContain("private@example.invalid");
        assertThat(BillingService.checkoutFailure("Invalid currency_id"))
                .contains("COP");
        assertThat(BillingService.checkoutFailure("Unknown error with secret-key"))
                .doesNotContain("secret-key");
    }
    @Test void signatureBindsIdRequestAndTimestamp() throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec("secret".getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
        String digest=HexFormat.of().formatHex(mac.doFinal("id:abc;request-id:request;ts:1700000000;".getBytes(StandardCharsets.UTF_8)));
        String signature="ts=1700000000,v1="+digest;
        assertThat(MercadoPagoSignature.valid("secret",signature,"request","ABC")).isTrue();
        assertThat(MercadoPagoSignature.valid("secret",signature,"request","other")).isFalse();
        assertThat(MercadoPagoSignature.valid("secret",signature,"other","ABC")).isFalse();
        assertThat(MercadoPagoSignature.valid("secret",signature+",ts=1700000000","request","ABC")).isFalse();
        assertThat(MercadoPagoSignature.valid("",signature,"request","ABC")).isFalse();
    }
    @Test void pageBlocksAndArchiveSizesHaveBoundaries() {
        assertThat(CreditOperation.pageCredits(24,false)).isEqualTo(3);
        assertThat(CreditOperation.pageCredits(24,true)).isEqualTo(9);
        assertThat(CreditOperation.repositoryCredits(5*1024*1024)).isEqualTo(10);
        assertThat(CreditOperation.repositoryCredits(5*1024*1024+1)).isEqualTo(25);
        assertThatThrownBy(()->CreditOperation.pageCredits(0,false)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->CreditOperation.repositoryCredits(26L*1024*1024)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void testPaymentsRequireVerifiedTestSellerRegardlessOfLiveModeFlag() {
        var provider=org.mockito.Mockito.spy(new MercadoPagoClient("test","token","123","secret","https://backend.invalid","https://app.invalid"));
        var mapper=new com.fasterxml.jackson.databind.ObjectMapper();
        org.mockito.Mockito.doReturn(mapper.valueToTree(java.util.Map.of("id",123,"tags",java.util.List.of("test_user"))))
                .when(provider).get("/users/me");
        provider.validatePayment(mapper.valueToTree(java.util.Map.of("collector_id",123,"live_mode",false)));
        provider.validatePayment(mapper.valueToTree(java.util.Map.of("collector_id",123,"live_mode",true)));
        assertThatThrownBy(()->provider.validatePayment(mapper.valueToTree(java.util.Map.of("collector_id",999,"live_mode",false))))
            .isInstanceOf(IllegalStateException.class);
        org.mockito.Mockito.doReturn(mapper.valueToTree(java.util.Map.of("id",123,"tags",java.util.List.of())))
                .when(provider).get("/users/me");
        for (boolean live : new boolean[]{true,false})
            assertThatThrownBy(()->provider.validatePayment(mapper.valueToTree(java.util.Map.of("collector_id",123,"live_mode",live))))
                    .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }

    @Test void livePaymentsRejectTestCredentialsAndTestSeller() {
        var provider=org.mockito.Mockito.spy(new MercadoPagoClient("live","token","123","secret","https://backend.invalid","https://app.invalid"));
        var mapper=new com.fasterxml.jackson.databind.ObjectMapper();
        org.mockito.Mockito.doReturn(mapper.valueToTree(java.util.Map.of("id",123,"tags",java.util.List.of())))
                .when(provider).get("/users/me");
        provider.validatePayment(mapper.valueToTree(java.util.Map.of("collector_id",123,"live_mode",true)));
        assertThatThrownBy(()->provider.validatePayment(mapper.valueToTree(java.util.Map.of("collector_id",123,"live_mode",false))))
                .isInstanceOf(IllegalStateException.class);
        org.mockito.Mockito.doReturn(mapper.valueToTree(java.util.Map.of("id",123,"tags",java.util.List.of("test_user"))))
                .when(provider).get("/users/me");
        assertThatThrownBy(()->provider.validatePayment(mapper.valueToTree(java.util.Map.of("collector_id",123,"live_mode",true))))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
}
