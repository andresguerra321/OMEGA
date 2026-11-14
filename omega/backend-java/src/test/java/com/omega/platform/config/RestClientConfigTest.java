package com.omega.platform.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.client.RestClient;

class RestClientConfigTest {

    @Test
    void rejectsDefaultOrShortInternalServiceTokenInProdProfile() {
        RestClientConfig config = new RestClientConfig();
        MockEnvironment prodEnv = new MockEnvironment();
        prodEnv.setActiveProfiles("prod");

        OmegaProperties devTokenProps = buildProps("omega-dev-internal-service-token-change-in-prod");
        assertThatThrownBy(() -> config.forensicWorkerRestClient(devTokenProps, prodEnv))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("INTERNAL_SERVICE_TOKEN");

        OmegaProperties shortTokenProps = buildProps("too-short-secret-token");
        assertThatThrownBy(() -> config.forensicWorkerRestClient(shortTokenProps, prodEnv))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32");

        OmegaProperties strongProdProps = buildProps("prod-rotated-internal-service-token-min-32-bytes");
        RestClient client = config.forensicWorkerRestClient(strongProdProps, prodEnv);
        assertThat(client).isNotNull();
    }

    private static OmegaProperties buildProps(String internalServiceToken) {
        return new OmegaProperties(
                new OmegaProperties.Security(
                        "prod-jwt-hmac-sha256-secret-key-min-32-chars",
                        3600,
                        "omega-rag-core",
                        false,
                        "",
                        internalServiceToken
                ),
                new OmegaProperties.Ingest("/tmp/omega_ingest", 26214400L, "/usr/share/tesseract-ocr/4.00/tessdata"),
                new OmegaProperties.Rag(
                        "openai",
                        "text-embedding-3-small",
                        1536,
                        "https://api.openai.com/v1",
                        "",
                        32,
                        2,
                        "gpt-4o-mini",
                        60,
                        1.0,
                        1.0,
                        500,
                        1000,
                        120
                ),
                new OmegaProperties.ForensicWorker("http://forensic-worker:8000", 5000, 120000),
                new OmegaProperties.Cti("/app/corpus_mvp/iocs")
        );
    }
}
