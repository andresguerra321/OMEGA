package com.omega.platform.config;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuración del planificador de monitoreo continuo de dependencias DEVELOPER (Bloque DG).
 * Permite ajustar la frecuencia por plan (PERSONAL, PRO, ENTERPRISE) y el umbral de aviso por feed desactualizado.
 */
@Component
@ConfigurationProperties(prefix = "omega.dev.monitoring")
public class DevMonitoringProperties {

    private boolean enabled = true;
    private long pollIntervalMs = 300_000L;
    private int staleFeedThresholdHours = 48;
    private Map<String, Integer> planFrequencyHours = new LinkedHashMap<>(Map.of(
            "PERSONAL", 24,
            "PRO", 6,
            "ENTERPRISE", 1
    ));

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public long getPollIntervalMs() {
        return pollIntervalMs;
    }

    public void setPollIntervalMs(long pollIntervalMs) {
        this.pollIntervalMs = pollIntervalMs;
    }

    public int getStaleFeedThresholdHours() {
        return staleFeedThresholdHours;
    }

    public void setStaleFeedThresholdHours(int staleFeedThresholdHours) {
        this.staleFeedThresholdHours = staleFeedThresholdHours;
    }

    public Map<String, Integer> getPlanFrequencyHours() {
        return planFrequencyHours;
    }

    public void setPlanFrequencyHours(Map<String, Integer> planFrequencyHours) {
        if (planFrequencyHours != null && !planFrequencyHours.isEmpty()) {
            this.planFrequencyHours = new LinkedHashMap<>(planFrequencyHours);
        }
    }

    public int frequencyHoursForPlan(String rawPlanCode) {
        String key = rawPlanCode == null || rawPlanCode.isBlank()
                ? "PERSONAL"
                : rawPlanCode.trim().toUpperCase(Locale.ROOT);
        Integer configured = planFrequencyHours.get(key);
        if (configured != null && configured > 0) {
            return configured;
        }
        return switch (key) {
            case "ENTERPRISE" -> 1;
            case "PRO" -> 6;
            default -> 24;
        };
    }
}
