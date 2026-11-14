package com.omega.platform.rag;

/**
 * Error controlado al generar embeddings o sintetizar respuestas RAG.
 */
public class EmbeddingException extends RuntimeException {

    public EmbeddingException(String message) {
        super(message);
    }

    public EmbeddingException(String message, Throwable cause) {
        super(message, cause);
    }
}
