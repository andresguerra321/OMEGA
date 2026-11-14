package com.omega.platform.config;

import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Pool asíncrono acotado para extracción PDFBox, OCR Tess4J y batching de embeddings en Fase 3.
 */
@Configuration
@EnableAsync
public class AsyncExecutorConfig {

    @Bean(name = "omegaIngestExecutor")
    public Executor omegaIngestExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(6);
        executor.setQueueCapacity(32);
        executor.setThreadNamePrefix("omega-ingest-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
