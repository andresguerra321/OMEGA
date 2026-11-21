package com.omega.platform.config;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Q8: Cuotas y límites configurables por plan (PERSONAL / PRO / ENTERPRISE) para el módulo LEGAL.
 * Ningún límite se hardcodea en la lógica de negocio; todos pueden ajustarse por application.yml o variables de entorno.
 */
@Component
@ConfigurationProperties(prefix = "omega.legal.quotas")
public class LegalQuotaProperties {

    private int stuckProcessingMinutes = 15;
    private Map<String, PlanQuota> plans = defaultPlans();

    public static Map<String, PlanQuota> defaultPlans() {
        Map<String, PlanQuota> map = new LinkedHashMap<>();
        map.put("PERSONAL", new PlanQuota(50, 250L * 1024 * 1024, 100, 2, 10, 20));
        map.put("PRO", new PlanQuota(500, 2_000L * 1024 * 1024, 1_000, 5, 30, 60));
        map.put("ENTERPRISE", new PlanQuota(5_000, 20_000L * 1024 * 1024, 10_000, 16, 120, 240));
        return map;
    }

    public int getStuckProcessingMinutes() {
        return stuckProcessingMinutes;
    }

    public void setStuckProcessingMinutes(int stuckProcessingMinutes) {
        this.stuckProcessingMinutes = stuckProcessingMinutes;
    }

    public Map<String, PlanQuota> getPlans() {
        return plans;
    }

    public void setPlans(Map<String, PlanQuota> plans) {
        if (plans != null && !plans.isEmpty()) {
            this.plans = plans;
        }
    }

    public PlanQuota forPlan(String planCode) {
        String key = planCode == null ? "PERSONAL" : planCode.trim().toUpperCase(java.util.Locale.ROOT);
        PlanQuota found = plans.get(key);
        if (found != null) return found;
        return plans.getOrDefault("PERSONAL", new PlanQuota(50, 250L * 1024 * 1024, 100, 2, 10, 20));
    }

    public static class PlanQuota {
        private int maxDocumentsPerCase;
        private long maxTotalBytesPerCase;
        private int monthlyQueries;
        private int maxConcurrentIndexing;
        private int uploadPerMinute;
        private int queryPerMinute;

        public PlanQuota() {}

        public PlanQuota(int maxDocumentsPerCase, long maxTotalBytesPerCase, int monthlyQueries,
                int maxConcurrentIndexing, int uploadPerMinute, int queryPerMinute) {
            this.maxDocumentsPerCase = maxDocumentsPerCase;
            this.maxTotalBytesPerCase = maxTotalBytesPerCase;
            this.monthlyQueries = monthlyQueries;
            this.maxConcurrentIndexing = maxConcurrentIndexing;
            this.uploadPerMinute = uploadPerMinute;
            this.queryPerMinute = queryPerMinute;
        }

        public int getMaxDocumentsPerCase() { return maxDocumentsPerCase; }
        public void setMaxDocumentsPerCase(int maxDocumentsPerCase) { this.maxDocumentsPerCase = maxDocumentsPerCase; }
        public long getMaxTotalBytesPerCase() { return maxTotalBytesPerCase; }
        public void setMaxTotalBytesPerCase(long maxTotalBytesPerCase) { this.maxTotalBytesPerCase = maxTotalBytesPerCase; }
        public int getMonthlyQueries() { return monthlyQueries; }
        public void setMonthlyQueries(int monthlyQueries) { this.monthlyQueries = monthlyQueries; }
        public int getMaxConcurrentIndexing() { return maxConcurrentIndexing; }
        public void setMaxConcurrentIndexing(int maxConcurrentIndexing) { this.maxConcurrentIndexing = maxConcurrentIndexing; }
        public int getUploadPerMinute() { return uploadPerMinute; }
        public void setUploadPerMinute(int uploadPerMinute) { this.uploadPerMinute = uploadPerMinute; }
        public int getQueryPerMinute() { return queryPerMinute; }
        public void setQueryPerMinute(int queryPerMinute) { this.queryPerMinute = queryPerMinute; }
    }
}
