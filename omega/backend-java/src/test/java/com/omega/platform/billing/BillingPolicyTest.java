package com.omega.platform.billing;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.assertj.core.api.Assertions.assertThat;

class BillingPolicyTest {
    @Test void disablingPaymentsDoesNotGrantPaidAccess() {
        assertThat(new BillingPolicy(new MockEnvironment()).enforced()).isTrue();
        assertThat(new BillingPolicy(new MockEnvironment().withProperty("OMEGA_MP_MODE", "disabled")
                .withProperty("OMEGA_BILLING_ENFORCE", "false")).enforced()).isTrue();
    }

    @Test void onlyIndividualGeneralHasAFreeWorkspace() {
        for (String type : new String[]{"INDIVIDUAL", "ORGANIZATION", "UNCLASSIFIED"})
            for (String profile : new String[]{"GENERAL", "DEVELOPER", "LEGAL"})
                assertThat(BillingPolicy.freeWorkspace(type, profile))
                        .isEqualTo("INDIVIDUAL".equals(type) && "GENERAL".equals(profile));
        assertThat(BillingPolicy.freeWorkspace(null, null)).isFalse();
    }

    @Test void productionCannotDisableCommercialRestrictions() {
        for (String profile : new String[]{"prod", "production"}) {
            var environment = new MockEnvironment().withProperty("OMEGA_BILLING_ENFORCE", "false");
            environment.setActiveProfiles(profile);
            assertThat(new BillingPolicy(environment).enforced()).isTrue();
        }
    }

    @Test void paymentTestsAndLiveAlwaysEnforceEntitlements() {
        for (String mode : new String[]{"test", "live"})
            assertThat(new BillingPolicy(new MockEnvironment().withProperty("OMEGA_MP_MODE", mode)
                    .withProperty("OMEGA_BILLING_ENFORCE", "false")).enforced()).isTrue();
        assertThat(new BillingPolicy(new MockEnvironment().withProperty("OMEGA_BILLING_ENFORCE", "true")).enforced()).isTrue();
    }
}
