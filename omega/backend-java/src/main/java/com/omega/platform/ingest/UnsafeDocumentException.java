package com.omega.platform.ingest;

/**
 * Excepción de seguridad al detectar estructuras activas o scripts peligrosos en un PDF (/JavaScript, /Launch, /AA, etc.).
 */
public class UnsafeDocumentException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public UnsafeDocumentException(String message) {
        super(message);
    }
}
