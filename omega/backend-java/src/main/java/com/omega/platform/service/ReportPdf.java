package com.omega.platform.service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.util.List;
import org.openpdf.text.*;
import org.openpdf.text.pdf.*;

/** Shared paginated renderer. Text outside WinAnsi is spelled out rather than silently lost. */
public final class ReportPdf {
    private ReportPdf() {}
    public record Section(String title, List<String> paragraphs) {}

    public static byte[] render(String title, String reference, List<Section> sections) {
        var output = new ByteArrayOutputStream();
        var document = new Document(PageSize.A4, 44, 44, 48, 48);
        var writer = PdfWriter.getInstance(document, output);
        writer.setPageEvent(new PdfPageEventHelper() {
            @Override public void onEndPage(PdfWriter w, Document d) {
                ColumnText.showTextAligned(w.getDirectContent(), Element.ALIGN_RIGHT,
                        new Phrase("OMEGA · " + w.getPageNumber(), font(8, false)), 550, 26, 0);
            }
        });
        document.addTitle(safe(title));
        document.addCreator("OMEGA");
        document.open();
        try {
            document.add(new Paragraph(safe(title), font(19, true)));
            document.add(new Paragraph(safe(reference), font(9, false)));
            for (Section section : sections) {
                var heading = new Paragraph(safe(section.title()), font(13, true));
                heading.setSpacingBefore(16); heading.setSpacingAfter(7); heading.setKeepTogether(true);
                document.add(heading);
                for (String text : section.paragraphs()) {
                    var paragraph = new Paragraph(safe(text), font(10, false));
                    paragraph.setLeading(14); paragraph.setSpacingAfter(6);
                    document.add(paragraph);
                }
            }
        } finally { document.close(); }
        return output.toByteArray();
    }

    private static Font font(int size, boolean bold) {
        return FontFactory.getFont(FontFactory.HELVETICA, size, bold ? Font.BOLD : Font.NORMAL);
    }
    static String safe(String input) {
        if (input == null) return "No consta";
        var encoder = Charset.forName("windows-1252").newEncoder();
        var out = new StringBuilder();
        input.codePoints().forEach(cp -> {
            String value = new String(Character.toChars(cp));
            if (cp == '\n' || cp == '\t' || (cp >= 32 && encoder.canEncode(value))) out.append(value);
            else if (cp >= 32) out.append("[U+").append(Integer.toHexString(cp).toUpperCase()).append(']');
        });
        return out.toString();
    }
}
