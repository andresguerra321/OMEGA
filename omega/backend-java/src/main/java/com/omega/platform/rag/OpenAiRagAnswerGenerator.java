package com.omega.platform.rag;

import com.omega.platform.config.OmegaProperties;
import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Generador grounded para respuestas RAG con formato obligatorio de citas probatorias.
 * Si no existe clave API remota configurada o falla el endpoint de chat, sintetiza una respuesta
 * determinista estrictamente anclada a los fragmentos recuperados sin inventar hechos.
 */
@Service
public class OpenAiRagAnswerGenerator implements RagAnswerGenerator {

    private static final Logger log = LoggerFactory.getLogger(OpenAiRagAnswerGenerator.class);

    private final RestClient openAiRestClient;
    private final OmegaProperties properties;

    public OpenAiRagAnswerGenerator(
            @Qualifier("openAiRestClient") RestClient openAiRestClient,
            OmegaProperties properties
    ) {
        this.openAiRestClient = openAiRestClient;
        this.properties = properties;
    }

    @Override
    public String generateGroundedAnswer(String question, List<RankedChunk> chunks) {
        if (chunks == null || chunks.isEmpty()) {
            return "No se encontró evidencia indexada suficiente en este expediente para responder la consulta.";
        }

        String apiKey = properties.rag().openAiApiKey();
        if (apiKey != null && !apiKey.isBlank()) {
            try {
                String llmAnswer = callChatCompletions(question, chunks, apiKey.trim());
                if (llmAnswer != null && !llmAnswer.isBlank()) {
                    return ensureAllMandatoryCitationsPresent(llmAnswer, chunks);
                }
            } catch (Exception ex) {
                log.warn("Fallo invocando Chat Completions remoto; usando síntesis determinista grounded: {}", ex.getMessage());
            }
        }

        return buildDeterministicGroundedSummary(chunks);
    }

    private String callChatCompletions(String question, List<RankedChunk> chunks, String apiKey) {
        String context = chunks.stream()
                .map(c -> c.citationLabel() + "\n" + c.content())
                .collect(Collectors.joining("\n\n---\n\n"));

        String systemPrompt = """
                Eres el analista forense de OMEGA. Responde únicamente usando los fragmentos del expediente proporcionados.
                No inventes datos ni extrapoles fuera de la evidencia. Cada afirmación clave DEBE incluir su cita literal
                exactamente con el formato: [Documento: <nombre> | Pág. <numero> | Sección: <seccion>].
                """;

        ChatRequest req = new ChatRequest(
                properties.rag().chatModel(),
                0.1,
                List.of(
                        new ChatMessage("system", systemPrompt),
                        new ChatMessage("user", "Pregunta:\n" + question + "\n\nEvidencia del expediente:\n" + context)
                )
        );

        ChatResponse resp = openAiRestClient.post()
                .uri("/chat/completions")
                .header("Authorization", "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(req)
                .retrieve()
                .body(ChatResponse.class);

        if (resp == null || resp.choices() == null || resp.choices().isEmpty() || resp.choices().get(0).message() == null) {
            return "";
        }
        return resp.choices().get(0).message().content();
    }

    private String ensureAllMandatoryCitationsPresent(String llmAnswer, List<RankedChunk> chunks) {
        List<String> missing = chunks.stream()
                .map(RankedChunk::citationLabel)
                .distinct()
                .filter(label -> !llmAnswer.contains(label))
                .toList();
        if (missing.isEmpty()) {
            return llmAnswer;
        }
        return llmAnswer + "\n\nFuentes verificadas:\n- " + String.join("\n- ", missing);
    }

    private String buildDeterministicGroundedSummary(List<RankedChunk> chunks) {
        StringBuilder sb = new StringBuilder();
        sb.append("Evidencia localizada en el expediente:\n\n");
        for (RankedChunk chunk : chunks) {
            String excerpt = chunk.content().replaceAll("\\s+", " ").trim();
            if (excerpt.length() > 360) {
                excerpt = excerpt.substring(0, 357) + "...";
            }
            sb.append("- ")
                    .append(excerpt)
                    .append(" ")
                    .append(chunk.citationLabel())
                    .append('\n');
        }
        return sb.toString().trim();
    }

    record ChatRequest(String model, double temperature, List<ChatMessage> messages) {
    }

    record ChatMessage(String role, String content) {
    }

    record ChatResponse(List<Choice> choices) {
    }

    record Choice(ChatMessage message) {
    }
}
