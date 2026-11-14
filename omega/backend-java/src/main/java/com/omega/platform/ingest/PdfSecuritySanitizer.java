package com.omega.platform.ingest;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.cos.COSObject;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.springframework.stereotype.Component;

/**
 * Escáner estructural con Apache PDFBox para rechazar PDFs con /JavaScript, /Launch,
 * disparadores /AA, /OpenAction ejecutables o contenedores embebidos maliciosos antes del pipeline async.
 */
@Component
public class PdfSecuritySanitizer {

    private static final int MAX_COS_NODES = 250_000;

    private static final Set<String> FORBIDDEN_DICTIONARY_KEYS = Set.of(
            "JavaScript",
            "JS",
            "Launch",
            "SubmitForm",
            "ImportData",
            "EmbeddedFiles",
            "RichMedia",
            "RichMediaExecute"
    );

    private static final Set<String> FORBIDDEN_ACTION_SUBTYPES = Set.of(
            "JavaScript",
            "JS",
            "Launch",
            "SubmitForm",
            "ImportData",
            "GoToE",
            "GoToR",
            "RichMediaExecute",
            "Rendition",
            "Sound",
            "Movie"
    );

    public PdfInspectionResult validateCleanPdf(Path pdfPath) {
        try (PDDocument document = Loader.loadPDF(pdfPath.toFile())) {
            if (document.isEncrypted()) {
                throw new UnsafeDocumentException("Se rechazan PDFs cifrados por política de inspección estructural Zero-Retention.");
            }
            int pages = document.getNumberOfPages();
            if (pages <= 0) {
                throw new InvalidDocumentException("El PDF no contiene páginas válidas.");
            }

            inspectCosGraph(document.getDocument().getTrailer());
            return new PdfInspectionResult(pages);
        } catch (UnsafeDocumentException | InvalidDocumentException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new InvalidDocumentException("No se pudo parsear el archivo como un PDF válido.", ex);
        }
    }

    private void inspectCosGraph(COSDictionary root) {
        if (root == null) {
            return;
        }
        IdentityHashMap<COSBase, Boolean> visited = new IdentityHashMap<>();
        Deque<COSBase> stack = new ArrayDeque<>();
        stack.push(root);
        int count = 0;

        while (!stack.isEmpty()) {
            COSBase current = stack.pop();
            if (current instanceof COSObject ref) {
                current = ref.getObject();
            }
            if (current == null || visited.containsKey(current)) {
                continue;
            }
            visited.put(current, Boolean.TRUE);
            if (++count > MAX_COS_NODES) {
                throw new UnsafeDocumentException("PDF bloqueado por complejidad estructural anómala.");
            }

            if (current instanceof COSDictionary dict) {
                inspectDictionary(dict);
                for (Map.Entry<COSName, COSBase> entry : dict.entrySet()) {
                    if (entry.getValue() != null) {
                        stack.push(entry.getValue());
                    }
                }
            } else if (current instanceof COSArray array) {
                for (COSBase item : array) {
                    if (item != null) {
                        stack.push(item);
                    }
                }
            }
        }
    }

    private void inspectDictionary(COSDictionary dict) {
        for (COSName key : dict.keySet()) {
            String name = key.getName();
            if (FORBIDDEN_DICTIONARY_KEYS.contains(name)) {
                throw new UnsafeDocumentException("PDF rechazado por contener elemento peligroso: /" + name);
            }
            if ("AA".equals(name)) {
                COSBase aaVal = dict.getDictionaryObject(key);
                if (aaVal instanceof COSDictionary aaDict && aaDict.size() > 0) {
                    throw new UnsafeDocumentException("PDF rechazado por contener acciones automáticas embebidas (/AA).");
                }
            }
            if ("OpenAction".equals(name)) {
                COSBase openVal = dict.getDictionaryObject(key);
                if (openVal instanceof COSDictionary actionDict) {
                    String subtype = actionDict.getNameAsString(COSName.S);
                    if (subtype != null && !"GoTo".equals(subtype)) {
                        throw new UnsafeDocumentException("PDF rechazado por /OpenAction potencialmente ejecutable: /" + subtype);
                    }
                }
            }
        }

        String actionSubtype = dict.getNameAsString(COSName.S);
        if (actionSubtype != null && FORBIDDEN_ACTION_SUBTYPES.contains(actionSubtype)) {
            throw new UnsafeDocumentException("PDF rechazado por tipo de acción prohibida: /" + actionSubtype);
        }

        String genericSubtype = dict.getNameAsString(COSName.SUBTYPE);
        if (genericSubtype != null && FORBIDDEN_ACTION_SUBTYPES.contains(genericSubtype)) {
            throw new UnsafeDocumentException("PDF rechazado por subtipo incrustado prohibido: /" + genericSubtype);
        }
    }

    public record PdfInspectionResult(int totalPages) {
    }
}
