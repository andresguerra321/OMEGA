package com.omega.platform.rag;

import java.util.List;

/**
 * Contrato desacoplado de generación de embeddings vectoriales (MVP: OpenAI; Fase posterior: proveedor local).
 * La lógica RAG de negocio nunca depende del SDK HTTP concreto.
 */
public interface EmbeddingProvider {

    /**
     * Identificador exacto del modelo usado (ej. "text-embedding-3-small"), persistido por chunk y documento
     * para garantizar coherencia vectorial en tiempo de consulta y detectar REINDEX_REQUIRED.
     */
    String modelName();

    /**
     * Dimensión esperada del vector (1536 para text-embedding-3-small / índice HNSW en pgvector).
     */
    int dimensions();

    /**
     * Genera vectores normalizados en lotes (batching) para fragmentos de documento.
     */
    List<float[]> embedBatch(List<String> texts);

    /**
     * Genera el vector para la pregunta usando exactamente el mismo modelo del índice.
     */
    default float[] embedQuery(String query) {
        List<float[]> result = embedBatch(List.of(query));
        if (result.isEmpty()) {
            throw new IllegalStateException("EmbeddingProvider no devolvió vector para la consulta");
        }
        return result.getFirst();
    }
}
