package com.omega.platform.integration.forensic;

/**
 * Error controlado al invocar el microservicio forense interno `omega/api`.
 */
public class ForensicWorkerException extends RuntimeException {

    public ForensicWorkerException(String message, Throwable cause) {
        super(message, cause);
    }
}
