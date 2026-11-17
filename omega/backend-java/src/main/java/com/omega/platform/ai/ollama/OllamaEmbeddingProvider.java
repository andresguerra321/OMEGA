package com.omega.platform.ai.ollama;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.rag.EmbeddingException;
import com.omega.platform.rag.EmbeddingProvider;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
@ConditionalOnProperty(name = "omega.ai.provider", havingValue = "ollama")
public class OllamaEmbeddingProvider implements EmbeddingProvider {
    private final RestClient client;
    private final OmegaProperties properties;

    public OllamaEmbeddingProvider(@Qualifier("ollamaRestClient") RestClient client, OmegaProperties properties) {
        this.client = client;
        this.properties = properties;
    }

    @Override public String modelName() { return "ollama:" + properties.ai().ollama().embedModel(); }
    public String modelVersion() { return modelName(); }
    @Override public int dimensions() { return properties.rag().embeddingDimensions(); }

    @Override public List<float[]> embedBatch(List<String> texts) {
        if (texts == null || texts.isEmpty()) return List.of();
        List<float[]> result = new ArrayList<>(texts.size());
        int batch = Math.max(1, properties.rag().openAiBatchSize());
        for (int offset = 0; offset < texts.size(); offset += batch) {
            List<String> slice = texts.subList(offset, Math.min(offset + batch, texts.size()));
            EmbeddingsResponse response = client.post().uri("/api/embed").contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("model", properties.ai().ollama().embedModel(), "input", slice, "truncate", false))
                    .retrieve().body(EmbeddingsResponse.class);
            if (response == null || response.embeddings() == null || response.embeddings().size() != slice.size()) {
                throw new EmbeddingException("Respuesta incompleta del modelo local; no se guardarán vectores parciales.");
            }
            for (List<Double> raw : response.embeddings()) result.add(normalize(raw));
        }
        return result;
    }

    private float[] normalize(List<Double> raw) {
        if (raw == null || raw.isEmpty() || raw.size() > dimensions()) {
            throw new EmbeddingException("Dimensión local incompatible con pgvector; ajusta el índice y reindexa. No se truncarán vectores.");
        }
        float[] vector = new float[dimensions()];
        double norm = 0;
        for (Double value : raw) {
            if (value == null || !Double.isFinite(value)) throw new EmbeddingException("Vector local no finito.");
            norm = Math.hypot(norm, value);
        }
        if (!Double.isFinite(norm) || norm == 0) throw new EmbeddingException("Vector local vacío o inválido.");
        // Zero padding preserves cosine distances when the local model is smaller than the existing index.
        for (int i = 0; i < raw.size(); i++) vector[i] = (float) (raw.get(i) / norm);
        return vector;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record EmbeddingsResponse(List<List<Double>> embeddings) {}
}
