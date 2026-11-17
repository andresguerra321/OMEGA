package com.omega.platform;

import com.omega.platform.config.OmegaProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(OmegaProperties.class)
public class OmegaBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(OmegaBackendApplication.class, args);
    }
}
