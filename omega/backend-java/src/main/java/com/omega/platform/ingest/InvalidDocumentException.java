package com.omega.platform.ingest;

/**
 * Excepción para documentos vacíos, corruptos, sobredimensionados o con magic bytes inválidos.
 */
public class InvalidDocumentException extends RuntimeException {

    public InvalidDocumentException(String message) {
        super(message);
    }

    public InvalidDocumentException(String message, Throwable cause) {
        super(message, cause);
    }
}
