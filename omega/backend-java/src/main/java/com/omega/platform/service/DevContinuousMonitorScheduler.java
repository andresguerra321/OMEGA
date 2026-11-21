package com.omega.platform.service;

import com.omega.platform.config.DevMonitoringProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Planificador periódico del monitoreo continuo DEVELOPER (Bloque DG).
 * Evalúa únicamente suscripciones vencidas según la frecuencia del plan del tenant,
 * sobre el SBOM almacenado y sin descargar código fuente.
 */
@Component
public class DevContinuousMonitorScheduler {

    private static final Logger log = LoggerFactory.getLogger(DevContinuousMonitorScheduler.class);

    private final DevMonitoringProperties properties;
    private final DevMonitoringService monitoringService;

    public DevContinuousMonitorScheduler(
            DevMonitoringProperties properties,
            DevMonitoringService monitoringService
    ) {
        this.properties = properties;
        this.monitoringService = monitoringService;
    }

    @Scheduled(fixedDelayString = "${omega.dev.monitoring.poll-interval-ms:300000}", initialDelayString = "${omega.dev.monitoring.initial-delay-ms:60000}")
    public void pollDueSubscriptions() {
        if (!properties.isEnabled()) {
            return;
        }
        DevMonitoringService.ScheduledRunSummary summary = monitoringService.runScheduledEvaluations();
        if (summary.evaluatedCount() > 0 || summary.failedCount() > 0) {
            log.info(
                    "DEV_MONITORING_SCHEDULER_RUN checked={} evaluated={} newAlerts={} failed={}",
                    summary.checkedSubscriptions(),
                    summary.evaluatedCount(),
                    summary.newAlertsTotal(),
                    summary.failedCount()
            );
        }
    }
}
