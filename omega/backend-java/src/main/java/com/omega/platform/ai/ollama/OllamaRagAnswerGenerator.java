package com.omega.platform.ai.ollama;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.rag.OpenAiRagAnswerGenerator;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/** Reuses the same citation, prompt-injection and deterministic fallback guards. */
@Service
@ConditionalOnProperty(name = "omega.ai.provider", havingValue = "ollama")
public class OllamaRagAnswerGenerator extends OpenAiRagAnswerGenerator {
    private final RestClient client;
    private final String model;

    public OllamaRagAnswerGenerator(@Qualifier("ollamaRestClient") RestClient client, OmegaProperties properties) {
        super(client, properties);
        this.client = client;
        this.model = properties.ai().ollama().chatModel();
    }

    @Override protected List<LlmTarget> resolveLlmTargets() {
        return List.of(new LlmTarget("ollama", client, "ollama:" + model, ""));
    }

    @Override protected String requestCompletion(LlmTarget target, String systemPrompt, String userContent, double temperature) {
        ChatResponse response = client.post().uri("/api/chat").contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("model", model, "stream", false, "options", Map.of("temperature", temperature),
                        "messages", List.of(Map.of("role", "system", "content", systemPrompt), Map.of("role", "user", "content", userContent))))
                .retrieve().body(ChatResponse.class);
        return response == null || response.message() == null ? "" : response.message().content();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChatResponse(Message message) {}
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Message(String content) {}
}
