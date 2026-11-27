package com.omega.platform.service;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Normalización única en Java para nombres de partes jurídicas y consultas de conflicto.
 * Convierte a minúsculas, elimina marcas diacríticas Unicode (tildes, diéresis y ñ -> n),
 * reemplaza separadores por espacio, descarta signos de puntuación y colapsa espacios.
 */
public final class LegalNameNormalizer {

    private static final int MAX_NORMALIZED_LENGTH = 200;
    private static final Pattern COMBINING_MARKS = Pattern.compile("\\p{M}+");
    private static final Pattern WORD_SEPARATORS = Pattern.compile("[-/\\\\_]+");
    private static final Pattern NON_ALPHANUMERIC_OR_SPACE = Pattern.compile("[^a-z0-9\\s]+");
    private static final Pattern MULTI_WHITESPACE = Pattern.compile("\\s+");

    private LegalNameNormalizer() {
    }

    public static String normalize(String raw) {
        if (raw == null) {
            return "";
        }
        String stripped = raw.strip();
        if (stripped.isEmpty()) {
            return "";
        }
        String decomposed = Normalizer.normalize(stripped, Normalizer.Form.NFD);
        String withoutMarks = COMBINING_MARKS.matcher(decomposed).replaceAll("");
        String folded = withoutMarks
                .replace("ß", "ss")
                .replace("Æ", "ae")
                .replace("æ", "ae")
                .replace("Œ", "oe")
                .replace("œ", "oe")
                .toLowerCase(Locale.ROOT);
        String separated = WORD_SEPARATORS.matcher(folded).replaceAll(" ");
        String clean = NON_ALPHANUMERIC_OR_SPACE.matcher(separated).replaceAll("");
        String collapsed = MULTI_WHITESPACE.matcher(clean).replaceAll(" ").strip();
        if (collapsed.length() > MAX_NORMALIZED_LENGTH) {
            return collapsed.substring(0, MAX_NORMALIZED_LENGTH).stripTrailing();
        }
        return collapsed;
    }

    public static String escapeLikeLiteral(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return value
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }
}
