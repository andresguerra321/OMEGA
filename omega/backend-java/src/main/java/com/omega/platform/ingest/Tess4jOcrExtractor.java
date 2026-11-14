package com.omega.platform.ingest;

import com.omega.platform.config.OmegaProperties;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import net.sourceforge.tess4j.ITesseract;
import net.sourceforge.tess4j.Tesseract;
import net.sourceforge.tess4j.TesseractException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Implementación OCR basada en Tess4J. Instancia un objeto Tesseract por invocación
 * porque libtesseract nativo no es seguro para hilos concurrentes.
 */
@Component
public class Tess4jOcrExtractor implements OcrExtractor {

    private static final Logger log = LoggerFactory.getLogger(Tess4jOcrExtractor.class);

    private final OmegaProperties properties;

    public Tess4jOcrExtractor(OmegaProperties properties) {
        this.properties = properties;
    }

    @Override
    public String extractText(BufferedImage pageImage) {
        Path tessdataDir = resolveTessdataDir();
        if (tessdataDir == null) {
            log.warn("No se encontró directorio tessdata válido; OCR omitido para esta página.");
            return "";
        }

        String languages = resolveLanguages(tessdataDir);
        ITesseract tesseract = new Tesseract();
        tesseract.setDatapath(tessdataDir.toAbsolutePath().toString());
        tesseract.setLanguage(languages);
        try {
            String text = tesseract.doOCR(pageImage);
            return text == null ? "" : text;
        } catch (TesseractException | UnsatisfiedLinkError ex) {
            log.warn("Error ejecutando Tesseract OCR ({}): {}", languages, ex.getMessage());
            return "";
        }
    }

    private Path resolveTessdataDir() {
        List<String> candidates = List.of(
                properties.ingest().tesseractDataPath(),
                "/usr/share/tesseract-ocr/4.00/tessdata",
                "/usr/share/tesseract-ocr/5/tessdata"
        );
        for (String candidate : candidates) {
            if (candidate == null || candidate.isBlank()) {
                continue;
            }
            Path dir = Path.of(candidate);
            if (Files.isDirectory(dir)) {
                return dir;
            }
        }
        return null;
    }

    private String resolveLanguages(Path tessdataDir) {
        boolean hasSpa = Files.exists(tessdataDir.resolve("spa.traineddata"));
        boolean hasEng = Files.exists(tessdataDir.resolve("eng.traineddata"));
        if (hasSpa && hasEng) {
            return "spa+eng";
        }
        if (hasSpa) {
            return "spa";
        }
        return "eng";
    }
}
