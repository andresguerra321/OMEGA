package com.omega.platform.security;

/**
 * Excepción lanzada cuando una dirección IP o combinación IP+correo supera el
 * umbral
 * de intentos fallidos de autenticación dentro de la ventana temporal
 * configurada.
 */
public class TooManyLoginAttemptsException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final long retryAfterSeconds;

    public TooManyLoginAttemptsException(String message, long retryAfterSeconds) {
        super(message);
        this.retryAfterSeconds = Math.max(1L, retryAfterSeconds);
    }

    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
