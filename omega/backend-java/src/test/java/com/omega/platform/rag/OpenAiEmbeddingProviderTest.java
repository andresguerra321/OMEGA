package com.omega.platform.rag;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.client.ExpectedCount.times;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.omega.platform.config.OmegaProperties;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class OpenAiEmbeddingProviderTest {

    @Test
    void batchesInputsRetriesTransientFailuresAndValidatesDimensions() {
        RestClient.Builder builder = RestClient.builder().baseUrl("https://api.openai.com/v1");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        OpenAiEmbeddingProvider provider = new OpenAiEmbeddingProvider(builder.build(), testProps("sk-test-key", 2, 1));

        String vec4 = IntStream.range(0, 4).mapToObj(i -> "0.25").collect(Collectors.joining(","));

        // Lote 1 (2 textos): falla transitoriamente 500 y luego responde HTTP 200
        server.expect(times(1), requestTo("https://api.openai.com/v1/embeddings"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer sk-test-key"))
                .andExpect(jsonPath("$.input.length()").value(2))
                .andRespond(withServerError());

        server.expect(times(1), requestTo("https://api.openai.com/v1/embeddings"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.model").value("text-embedding-3-small"))
                .andRespond(withSuccess(
                        """
                        {"model":"text-embedding-3-small","data":[
                          {"index":1,"embedding":[%s]},
                          {"index":0,"embedding":[%s]}
                        ]}
                        """.formatted(vec4, vec4),
                        MediaType.APPLICATION_JSON
                ));

        // Lote 2 (1 texto restante)
        server.expect(times(1), requestTo("https://api.openai.com/v1/embeddings"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.input.length()").value(1))
                .andRespond(withSuccess(
                        """
                        {"model":"text-embedding-3-small","data":[
                          {"index":0,"embedding":[%s]}
                        ]}
                        """.formatted(vec4),
                        MediaType.APPLICATION_JSON
                ));

        List<float[]> result = provider.embedBatch(List.of("chunk-a", "chunk-b", "chunk-c"));
        server.verify();

        assertThat(result).hasSize(3);
        assertThat(result.get(0)).hasSize(4);
        assertThat(result.get(2)[0]).isEqualTo(0.25f);
    }

    @Test
    void rejectsMissingApiKeyAndMismatchedDimensions() {
        RestClient.Builder builder = RestClient.builder().baseUrl("https://api.openai.com/v1");
        OpenAiEmbeddingProvider noKey = new OpenAiEmbeddingProvider(builder.build(), testProps("", 2, 0));
        assertThatThrownBy(() -> noKey.embedBatch(List.of("hola")))
                .isInstanceOf(EmbeddingException.class)
                .hasMessageContaining("OPENAI_API_KEY");

        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        OpenAiEmbeddingProvider badDims = new OpenAiEmbeddingProvider(builder.build(), testProps("sk-test", 2, 0));
        server.expect(requestTo(containsString("/embeddings")))
                .andRespond(withSuccess(
                        """
                        {"model":"text-embedding-3-small","data":[{"index":0,"embedding":[0.1,0.2]}]}
                        """,
                        MediaType.APPLICATION_JSON
                ));

        assertThatThrownBy(() -> badDims.embedBatch(List.of("texto")))
                .isInstanceOf(EmbeddingException.class)
                .hasMessageContaining("Dimensión");
    }

    private static OmegaProperties testProps(String apiKey, int batchSize, int maxRetries) {
        return new OmegaProperties(
                new OmegaProperties.Security(
                        "omega-unit-test-hmac-sha256-secret-key-32-chars",
                        3600,
                        "omega-rag-core",
                        true,
                        "",
                        "internal-token-test"
                ),
                new OmegaProperties.Ingest("/tmp/omega_ingest", 26214400L, "/usr/share/tesseract-ocr/4.00/tessdata"),
                new OmegaProperties.Rag(
                        "openai",
                        "text-embedding-3-small",
                        4,
                        "https://api.openai.com/v1",
                        apiKey,
                        batchSize,
                        maxRetries,
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
