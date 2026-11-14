package com.omega.platform.ingest;

import com.omega.platform.config.OmegaProperties;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Component;

/**
 * Extrae texto página por página con Apache PDFBox (y fallback OCR en RAM mediante Tess4J cuando la
 * página es imagen escaneada) y segmenta fragmentos entre 500 y 1000 tokens con solapamiento,
 * preservando exactamente page_number y section_title para citas probatorias.
 */
@Component
public class PdfChunkExtractor {

    private static final int MIN_TEXT_LEN_BEFORE_OCR = 40;
    private static final float OCR_DPI = 220f;
    private static final Pattern NUMBERED_HEADER = Pattern.compile(
            "^(?:\\d+(?:\\.\\d+){0,3}[.)]?|#+|SECCI[ÓO]N\\s+\\d+|CAP[ÍI]TULO\\s+\\d+)\\s+(.{3,120})$",
            Pattern.CASE_INSENSITIVE
    );

    private final OcrExtractor ocrExtractor;
    private final OmegaProperties properties;

    public PdfChunkExtractor(OcrExtractor ocrExtractor, OmegaProperties properties) {
        this.ocrExtractor = ocrExtractor;
        this.properties = properties;
    }

    public ExtractionResult extractAndChunk(Path pdfPath) throws IOException {
        try (PDDocument document = Loader.loadPDF(pdfPath.toFile())) {
            int totalPages = document.getNumberOfPages();
            PDFTextStripper stripper = new PDFTextStripper();
            PDFRenderer renderer = new PDFRenderer(document);

            boolean ocrApplied = false;
            List<PageSlice> pages = new ArrayList<>(totalPages);

            for (int pageNum = 1; pageNum <= totalPages; pageNum++) {
                stripper.setStartPage(pageNum);
                stripper.setEndPage(pageNum);
                String extracted = normalizeText(stripper.getText(document));

                if (extracted.length() < MIN_TEXT_LEN_BEFORE_OCR) {
                    BufferedImage pageImage = renderer.renderImageWithDPI(pageNum - 1, OCR_DPI, ImageType.RGB);
                    String ocrText = normalizeText(ocrExtractor.extractText(pageImage));
                    if (ocrText.length() > extracted.length()) {
                        extracted = ocrText;
                        ocrApplied = true;
                    }
                }

                if (!extracted.isBlank()) {
                    String sectionTitle = detectSectionTitle(extracted, pageNum);
                    pages.add(new PageSlice(pageNum, sectionTitle, extracted));
                }
            }

            List<ExtractedChunk> chunks = chunkPages(pages);
            return new ExtractionResult(totalPages, ocrApplied, chunks);
        }
    }

    List<ExtractedChunk> chunkPages(List<PageSlice> pages) {
        int minTokens = properties.rag().minChunkTokens();
        int maxTokens = Math.max(minTokens, properties.rag().maxChunkTokens());
        int overlapTokens = Math.min(properties.rag().chunkOverlapTokens(), maxTokens / 2);

        List<ExtractedChunk> result = new ArrayList<>();
        int chunkOrder = 0;

        for (PageSlice page : pages) {
            String[] words = page.text().split("\\s+");
            if (words.length == 0) {
                continue;
            }

            int maxWords = tokensToApproxWords(maxTokens);
            int overlapWords = tokensToApproxWords(overlapTokens);
            int step = Math.max(1, maxWords - overlapWords);

            for (int start = 0; start < words.length; ) {
                int end = Math.min(words.length, start + maxWords);
                String chunkText = String.join(" ", Arrays.copyOfRange(words, start, end)).trim();
                if (!chunkText.isBlank()) {
                    int estimatedTokens = estimateTokens(chunkText);
                    result.add(new ExtractedChunk(
                            chunkText,
                            page.pageNumber(),
                            page.sectionTitle(),
                            chunkOrder++,
                            estimatedTokens
                    ));
                }
                if (end == words.length) {
                    break;
                }
                start += step;
            }
        }
        return result;
    }

    static int estimateTokens(String text) {
        if (text == null || text.isBlank()) {
            return 1;
        }
        int words = text.trim().split("\\s+").length;
        return Math.max(1, (int) Math.ceil(words * 1.3d));
    }

    static int tokensToApproxWords(int tokens) {
        return Math.max(20, (int) Math.floor(tokens / 1.3d));
    }

    static String detectSectionTitle(String pageText, int pageNumber) {
        String[] lines = pageText.split("\\R");
        for (int i = 0; i < Math.min(lines.length, 6); i++) {
            String line = lines[i].trim();
            if (line.length() < 4 || line.length() > 120) {
                continue;
            }
            Matcher m = NUMBERED_HEADER.matcher(line);
            if (m.matches()) {
                return truncate(line.replaceAll("^#+\\s*", ""), 255);
            }
            if (i == 0 && !line.endsWith(".") && Character.isLetterOrDigit(line.charAt(0))) {
                return truncate(line, 255);
            }
        }
        return "Página " + pageNumber;
    }

    private static String normalizeText(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replace('\u0000', ' ')
                .replaceAll("[\\t\\x0B\\f\\r]+", " ")
                .replaceAll(" +", " ")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();
    }

    private static String truncate(String s, int maxLen) {
        return s.length() <= maxLen ? s : s.substring(0, maxLen);
    }

    public record PageSlice(int pageNumber, String sectionTitle, String text) {
    }

    public record ExtractedChunk(
            String content,
            int pageNumber,
            String sectionTitle,
            int chunkOrder,
            int tokenCount
    ) {
    }

    public record ExtractionResult(int totalPages, boolean ocrApplied, List<ExtractedChunk> chunks) {
    }
}
