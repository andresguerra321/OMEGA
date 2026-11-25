package com.omega.platform.billing;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class BillingPolicy {
    private final boolean enforced;

    public BillingPolicy(Environment environment) {
        // Disabling the payment gateway must never grant a paid membership.
        enforced = true;
    }

    public boolean enforced() { return enforced; }

    public static boolean freeWorkspace(String accountType, String profile) {
        return "INDIVIDUAL".equals(accountType) && "GENERAL".equals(profile);
    }
}
