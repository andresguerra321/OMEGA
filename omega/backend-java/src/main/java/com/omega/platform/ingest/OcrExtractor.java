package com.omega.platform.ingest;

import java.awt.image.BufferedImage;

/**
 * Contrato de extracción OCR en memoria RAM sobre páginas rasterizadas.
 */
public interface OcrExtractor {

    String extractText(BufferedImage pageImage);
}
