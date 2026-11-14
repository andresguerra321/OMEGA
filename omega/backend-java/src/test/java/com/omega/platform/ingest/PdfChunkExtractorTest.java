package com.omega.platform.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.ingest.PdfChunkExtractor.ExtractionResult;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PdfChunkExtractorTest {

    @TempDir
    Path tempDir;

    @Test
    void fallsBackToOcrOnBlankImagePageAndChunksLongTextWithinTokenWindow() throws Exception {
        Path pdfPath = tempDir.resolve("mixed.pdf");
        try (PDDocument doc = new PDDocument()) {
            // Página 1: texto digital extenso (> 950 palabras) para validar split 500-1000 tokens + solapamiento
            PDPage page1 = new PDPage();
            doc.addPage(page1);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page1)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 10);
                cs.newLineAtOffset(40, 740);
                cs.showText("1. Análisis Forense Pegasus iOS");
                cs.newLineAtOffset(0, -16);
                String line = "Indicador telemetry-check.example observado en shutdown_log con persistencia iMessage. ";
                for (int i = 0; i < 95; i++) {
                    cs.showText("Bloque " + i + ": " + line);
                    cs.newLineAtOffset(0, -10);
                    if (i % 65 == 64) {
                        cs.newLineAtOffset(0, 650);
                    }
                }
                cs.endText();
            }

            // Página 2: sin texto digital (< 40 chars) para disparar OCR fallback en RAM
            PDPage page2 = new PDPage();
            doc.addPage(page2);
            doc.save(pdfPath.toFile());
        }

        AtomicInteger ocrCalls = new AtomicInteger();
        OcrExtractor stubOcr = image -> {
            ocrCalls.incrementAndGet();
            assertThat(image).isNotNull();
            return "2. Evidencia Escaneada OCR\nCaptura SMS con dominio sospechoso free247downloads.com detectado.";
        };

        PdfChunkExtractor extractor = new PdfChunkExtractor(stubOcr, testProps());
        ExtractionResult result = extractor.extractAndChunk(pdfPath);

        assertThat(result.totalPages()).isEqualTo(2);
        assertThat(result.ocrApplied()).isTrue();
        assertThat(ocrCalls.get()).isEqualTo(1);
        assertThat(result.chunks().size()).isGreaterThanOrEqualTo(2);
        assertThat(result.chunks())
                .anySatisfy(c -> {
                    assertThat(c.pageNumber()).isEqualTo(1);
                    assertThat(c.sectionTitle()).contains("Análisis Forense Pegasus");
                    assertThat(c.tokenCount()).isBetween(100, 1050);
                })
                .anySatisfy(c -> {
                    assertThat(c.pageNumber()).isEqualTo(2);
                    assertThat(c.sectionTitle()).contains("Evidencia Escaneada OCR");
                    assertThat(c.content()).contains("free247downloads.com");
                });
    }

    private static OmegaProperties testProps() {
        return new OmegaProperties(
                new OmegaProperties.Security("omega-unit-test-hmac-sha256-secret-key-32-chars", 3600, "omega-rag-core", true, "", "tok"),
                new OmegaProperties.Ingest("/tmp/omega_ingest", 26214400L, "/usr/share/tesseract-ocr/4.00/tessdata"),
                new OmegaProperties.Rag("openai", "text-embedding-3-small", 1536, "https://api.openai.com/v1", "", 32, 1, "gpt-4o-mini", 60, 1.0, 1.0, 500, 1000, 120),
                new OmegaProperties.ForensicWorker("http://forensic-worker:8000", 5000, 120000),
                new OmegaProperties.Cti("/app/corpus_mvp/iocs")
        );
    }
}
