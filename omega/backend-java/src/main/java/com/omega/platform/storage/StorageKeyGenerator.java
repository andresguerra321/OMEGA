package com.omega.platform.storage;

import com.omega.platform.security.TenantContext;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Generador y validador determinístico de claves de objeto S3-compatible.
 * Nunca incorpora nombres de archivo suministrados por el usuario y toma el `tenantId`
 * exclusivamente desde {@link TenantContext}.
 *
 * Formato obligatorio: {@code tenants/{tenantId}/expedientes/{expedienteId}/{documentUuid}.bin}
 */
@Component
public class StorageKeyGenerator {

    private static final Pattern STRICT_OBJECT_KEY = Pattern.compile(
            "^tenants/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
                    + "/expedientes/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
                    + "/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\.bin$"
    );

    private static final Pattern STRICT_BUCKET = Pattern.compile("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$");

    /**
     * Genera la clave determinística tomando {@code tenantId} exclusivamente de {@link TenantContext}.
     */
    public String generateDocumentKey(UUID expedienteId, UUID documentUuid) {
        UUID tenantId = TenantContext.requireTenantId();
        Objects.requireNonNull(expedienteId, "expedienteId es obligatorio");
        Objects.requireNonNull(documentUuid, "documentUuid es obligatorio");
        return "tenants/" + tenantId + "/expedientes/" + expedienteId + "/" + documentUuid + ".bin";
    }

    /**
     * Valida que el bucket sea sintácticamente seguro (sin path traversal ni caracteres especiales).
     */
    public String validateBucket(String bucket) {
        if (bucket == null || !STRICT_BUCKET.matcher(bucket).matches()) {
            throw new ObjectStorageException("Nombre de bucket inválido o no permitido.");
        }
        return bucket;
    }

    /**
     * Valida que la clave cumpla el formato estricto, no contenga path traversal ni nombres arbitrarios,
     * y pertenezca estrictamente al tenant autenticado en {@link TenantContext}.
     */
    public String validateKeyForCurrentTenant(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new ObjectStorageException("Clave de objeto vacía.");
        }
        if (objectKey.contains("..")
                || objectKey.contains("\\")
                || objectKey.contains("\0")
                || objectKey.startsWith("/")
                || objectKey.contains("%")) {
            throw new ObjectStorageException("Clave de objeto rechazada por intento de path traversal o caracteres inválidos.");
        }
        Matcher matcher = STRICT_OBJECT_KEY.matcher(objectKey);
        if (!matcher.matches()) {
            throw new ObjectStorageException("Clave de objeto fuera del formato obligatorio tenants/{tenantId}/expedientes/{expedienteId}/{documentUuid}.bin.");
        }
        UUID keyTenantId = UUID.fromString(matcher.group(1));
        UUID activeTenantId = TenantContext.requireTenantId();
        if (!activeTenantId.equals(keyTenantId)) {
            throw new SecurityException("Acceso denegado: la clave de objeto no pertenece al tenant autenticado.");
        }
        return objectKey;
    }
}
