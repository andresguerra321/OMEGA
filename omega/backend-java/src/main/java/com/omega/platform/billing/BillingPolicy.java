package com.omega.platform.billing;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class BillingPolicy {
    public static final int DEFAULT_GRACE_DAYS = 5;
    private static final int MAX_GRACE_DAYS = 14;

    private final boolean enforced;
    private final int graceDays;

    public BillingPolicy(Environment environment) {
        // Disabling the payment gateway must never grant a paid membership.
        enforced = true;
        int parsed = DEFAULT_GRACE_DAYS;
        if (environment != null) {
            String raw = environment.getProperty("OMEGA_BILLING_GRACE_DAYS");
            if (raw != null && !raw.isBlank()) {
                try {
                    parsed = Math.max(0, Math.min(MAX_GRACE_DAYS, Integer.parseInt(raw.trim())));
                } catch (NumberFormatException ignored) {
                    parsed = DEFAULT_GRACE_DAYS;
                }
            }
        }
        this.graceDays = parsed;
    }

    public boolean enforced() { return enforced; }

    public int graceDays() { return graceDays; }

    public static boolean freeWorkspace(String accountType, String profile) {
        return "INDIVIDUAL".equals(accountType) && "GENERAL".equals(profile);
    }
}
