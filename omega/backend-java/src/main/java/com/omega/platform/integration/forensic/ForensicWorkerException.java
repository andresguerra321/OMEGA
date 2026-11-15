package com.omega.platform.integration.forensic;

/**
 * Error controlado al invocar el microservicio forense interno `omega/api`.
 */
public class ForensicWorkerException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public ForensicWorkerException(String message, Throwable cause) {
        super(message, cause);
    }
}
