package com.omega.platform.storage;

/**
 * Excepción de dominio para errores de almacenamiento de objetos, aislamiento multi-tenant
 * o claves inválidas (path traversal / formato no autorizado).
 */
public class ObjectStorageException extends RuntimeException {

    public ObjectStorageException(String message) {
        super(message);
    }

    public ObjectStorageException(String message, Throwable cause) {
        super(message, cause);
    }
}
