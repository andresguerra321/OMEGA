package com.omega.platform.billing;

public enum CreditOperation {
    LINK_VERIFY("Verificación de enlace", 1, false, "Por enlace"),
    AI_QUERY("Consulta de IA", 1, false, "Por respuesta; Legal: 2 créditos"),
    AI_IMAGE("Análisis de imagen", 3, false, "Por imagen, hasta 10 MB"),
    YARA_SCAN("Escaneo YARA", 5, true, "Hasta 20 archivos y 25 MB en total"),
    FORENSIC_STANDARD("Análisis forense estándar", 15, false, "Hasta 20 archivos y 25 MB en total"),
    FORENSIC_DEEP("Análisis forense profundo", 30, false, "Una ejecución, hasta 25 MB de entrada"),
    REPO_SCAN("Escaneo de repositorio", 10, true, "Hasta 5 MB comprimidos: 10; hasta 25 MB: 25"),
    DEV_AUDIT("Auditoría de estación", 5, true, "Por ejecución"),
    LEGAL_INDEX("Indexación documental", 1, true, "Cada 10 páginas: texto 1; OCR 3; reserva al máximo");

    public final String label;
    public final int credits;
    public final boolean paidOnly;
    public final String scope;
    CreditOperation(String label, int credits, boolean paidOnly, String scope) {
        this.label = label; this.credits = credits; this.paidOnly = paidOnly; this.scope = scope;
    }

    public static int pageCredits(int pages, boolean ocr) {
        if (pages < 1 || pages > 1000) throw new IllegalArgumentException("Documento fuera del límite de 1 a 1.000 páginas");
        return ((pages + 9) / 10) * (ocr ? 3 : 1);
    }

    public static int repositoryCredits(long bytes) {
        if (bytes < 1 || bytes > 25L * 1024 * 1024)
            throw new IllegalArgumentException("El repositorio debe ocupar como máximo 25 MB comprimidos");
        return bytes <= 5L * 1024 * 1024 ? 10 : 25;
    }
}
