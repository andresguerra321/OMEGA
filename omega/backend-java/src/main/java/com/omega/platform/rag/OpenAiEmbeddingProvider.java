package com.omega.platform.rag;

import com.omega.platform.config.OmegaProperties;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Proveedor OpenAI para embeddings vectoriales (`text-embedding-3-small`, 1536 dimensiones)
 * con soporte de batching, validación dimensional estricta y reintentos ante fallos transitorios.
 */
@Service
@ConditionalOnProperty(prefix = "omega.rag", name = "embedding-provider", havingValue = "openai", matchIfMissing = true)
public class OpenAiEmbeddingProvider implements EmbeddingProvider {

    private final RestClient openAiRestClient;
    private final OmegaProperties properties;

    public OpenAiEmbeddingProvider(
            @Qualifier("openAiRestClient") RestClient openAiRestClient,
            OmegaProperties properties
    ) {
        this.openAiRestClient = openAiRestClient;
        this.properties = properties;
    }

    @Override
    public String modelName() {
        return properties.rag().embeddingModel();
    }

    @Override
    public int dimensions() {
        return properties.rag().embeddingDimensions();
    }

    @Override
    public List<float[]> embedBatch(List<String> texts) {
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }
        String apiKey = properties.rag().openAiApiKey();
        if (apiKey == null || apiKey.isBlank()) {
            throw new EmbeddingException("OPENAI_API_KEY no configurada para el proveedor OpenAiEmbeddingProvider.");
        }

        int batchSize = Math.max(1, properties.rag().openAiBatchSize());
        List<float[]> vectors = new ArrayList<>(texts.size());

        for (int start = 0; start < texts.size(); start += batchSize) {
            int end = Math.min(texts.size(), start + batchSize);
            List<String> slice = texts.subList(start, end);
            vectors.addAll(requestSliceWithRetry(slice, apiKey.trim()));
        }
        return vectors;
    }

    private List<float[]> requestSliceWithRetry(List<String> slice, String apiKey) {
        int maxRetries = Math.max(0, properties.rag().openAiMaxRetries());
        RuntimeException lastError = null;

        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                EmbeddingsResponse response = openAiRestClient.post()
                        .uri("/embeddings")
                        .header("Authorization", "Bearer " + apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(new EmbeddingsRequest(modelName(), slice, dimensions()))
                        .retrieve()
                        .body(EmbeddingsResponse.class);

                return parseAndValidateEmbeddings(response, slice.size());
            } catch (RestClientResponseException ex) {
                int code = ex.getStatusCode().value();
                boolean retryable = code == 429 || code >= 500;
                lastError = new EmbeddingException("Error HTTP de OpenAI Embeddings (" + code + ")", ex);
                if (!retryable || attempt == maxRetries) {
                    throw lastError;
                }
            } catch (ResourceAccessException ex) {
                lastError = new EmbeddingException("Fallo de red comunicando con OpenAI Embeddings", ex);
                if (attempt == maxRetries) {
                    throw lastError;
                }
            }
            sleepBackoff(attempt);
        }
        throw lastError != null ? lastError : new EmbeddingException("Fallo desconocido invocando OpenAI Embeddings");
    }

    private List<float[]> parseAndValidateEmbeddings(EmbeddingsResponse response, int expectedCount) {
        if (response == null || response.data() == null || response.data().size() != expectedCount) {
            throw new EmbeddingException("Respuesta incompleta de OpenAI Embeddings respecto al lote enviado.");
        }
        int expectedDims = dimensions();
        List<EmbeddingDatum> sorted = response.data().stream()
                .sorted(Comparator.comparingInt(EmbeddingDatum::index))
                .toList();

        List<float[]> out = new ArrayList<>(expectedCount);
        for (EmbeddingDatum datum : sorted) {
            List<Double> raw = datum.embedding();
            if (raw == null || raw.size() != expectedDims) {
                throw new EmbeddingException("Dimensión de embedding inválida; esperada=" + expectedDims);
            }
            float[] arr = new float[expectedDims];
            for (int i = 0; i < expectedDims; i++) {
                arr[i] = raw.get(i).floatValue();
            }
            out.add(arr);
        }
        return out;
    }

    private void sleepBackoff(int attempt) {
        try {
            Thread.sleep(250L * (1L << Math.min(attempt, 4)));
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new EmbeddingException("Interrupción durante reintento de OpenAI Embeddings", ie);
        }
    }

    record EmbeddingsRequest(String model, List<String> input, int dimensions) {
    }

    record EmbeddingsResponse(List<EmbeddingDatum> data, String model) {
    }

    record EmbeddingDatum(int index, List<Double> embedding) {
    }
}
