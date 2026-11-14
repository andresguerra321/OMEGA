package com.omega.platform.ingest;

/**
 * Excepción de seguridad al detectar estructuras activas o scripts peligrosos en un PDF (/JavaScript, /Launch, /AA, etc.).
 */
public class UnsafeDocumentException extends RuntimeException {

    public UnsafeDocumentException(String message) {
        super(message);
    }
}
