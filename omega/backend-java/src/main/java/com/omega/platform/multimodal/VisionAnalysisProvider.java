package com.omega.platform.multimodal;

import com.omega.platform.multimodal.ImageSecuritySanitizer.SanitizedImage;
import java.util.List;

/**
 * Contrato de análisis visual multimodal en memoria RAM (compatible con OpenAI Vision, Groq Vision
 * u Ollama multimodal en futuros adaptadores).
 */
public interface VisionAnalysisProvider {

    ImageForensicExtraction analyze(SanitizedImage image, String question);

    record ImageForensicExtraction(
            String visualSummary,
            List<String> extractedUrls,
            List<String> extractedIndicators,
            String suspectedVector,
            String providerModel
    ) {
    }
}
