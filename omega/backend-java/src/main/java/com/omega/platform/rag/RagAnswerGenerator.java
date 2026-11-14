package com.omega.platform.rag;

import java.util.List;

/**
 * Genera respuestas estrictamente fundamentadas en fragmentos recuperados del expediente.
 */
public interface RagAnswerGenerator {

    String generateGroundedAnswer(String question, List<RankedChunk> chunks);

    record RankedChunk(
            java.util.UUID documentId,
            String originalFilename,
            String sha256Hash,
            int pageNumber,
            String sectionTitle,
            int chunkOrder,
            String content,
            double vectorScore,
            double lexicalScore,
            double rrfScore
    ) {
        public String citationLabel() {
            String safeSection = (sectionTitle == null || sectionTitle.isBlank())
                    ? "Pág. " + pageNumber
                    : sectionTitle;
            return "[Documento: " + originalFilename + " | Pág. " + pageNumber + " | Sección: " + safeSection + "]";
        }
    }
}
