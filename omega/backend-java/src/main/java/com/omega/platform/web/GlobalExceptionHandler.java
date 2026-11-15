package com.omega.platform.web;

import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.ingest.UnsafeDocumentException;
import com.omega.platform.integration.forensic.ForensicWorkerException;
import com.omega.platform.rag.EmbeddingException;
import com.omega.platform.security.TooManyLoginAttemptsException;
import com.omega.platform.service.ConflictException;
import com.omega.platform.service.ResourceNotFoundException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BadCredentialsException.class)
    public ProblemDetail handleBadCredentials(BadCredentialsException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, ex.getMessage());
        pd.setTitle("Autenticación fallida");
        return pd;
    }

    @ExceptionHandler(TooManyLoginAttemptsException.class)
    public ResponseEntity<ProblemDetail> handleTooManyLoginAttempts(TooManyLoginAttemptsException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage());
        pd.setTitle("Demasiados intentos de autenticación");
        pd.setProperty("retryAfterSeconds", ex.getRetryAfterSeconds());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(ex.getRetryAfterSeconds()))
                .body(pd);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ProblemDetail handleAccessDenied(AccessDeniedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, ex.getMessage());
        pd.setTitle("Acceso denegado");
        return pd;
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ProblemDetail handleNotFound(ResourceNotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("Recurso no encontrado");
        return pd;
    }

    @ExceptionHandler(ConflictException.class)
    public ProblemDetail handleConflict(ConflictException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("Conflicto de integridad");
        return pd;
    }

    @ExceptionHandler(InvalidDocumentException.class)
    public ProblemDetail handleInvalidDocument(InvalidDocumentException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("Archivo inválido");
        return pd;
    }

    @ExceptionHandler(UnsafeDocumentException.class)
    public ProblemDetail handleUnsafeDocument(UnsafeDocumentException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("Contenido bloqueado por seguridad");
        return pd;
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ProblemDetail handleMaxUpload(MaxUploadSizeExceededException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(
                HttpStatus.PAYLOAD_TOO_LARGE,
                "El tamaño del archivo enviado excede el límite configurado del servidor.");
        pd.setTitle("Archivo demasiado grande");
        return pd;
    }

    @ExceptionHandler(EmbeddingException.class)
    public ProblemDetail handleEmbeddingError(EmbeddingException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY, ex.getMessage());
        pd.setTitle("Error del proveedor de embeddings");
        return pd;
    }

    @ExceptionHandler(ForensicWorkerException.class)
    public ProblemDetail handleForensicWorkerError(ForensicWorkerException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY, ex.getMessage());
        pd.setTitle("Error del microservicio forense interno");
        return pd;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        var fieldErrors = new java.util.LinkedHashMap<String, String>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            fieldErrors.putIfAbsent(
                    fe.getField(),
                    fe.getDefaultMessage() != null ? fe.getDefaultMessage() : "Valor inválido");
        }
        String summary = fieldErrors.isEmpty()
                ? "Los datos ingresados no son válidos."
                : String.join(" · ", fieldErrors.values().stream().distinct().toList());
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, summary);
        pd.setTitle("Error de validación");
        pd.setProperty("fields", new java.util.ArrayList<>(fieldErrors.keySet()));
        pd.setProperty("fieldErrors", fieldErrors);
        return pd;
    }
}
