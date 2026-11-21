package com.omega.platform.storage;

import com.omega.platform.service.ResourceNotFoundException;
import java.io.InputStream;
import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Adaptador No-Op por defecto para modo Zero-Retention y entornos de prueba sin MinIO.
 * Conserva todas las validaciones de aislamiento de tenant y formato de claves.
 */
@Component
@ConditionalOnProperty(name = "omega.storage.provider", havingValue = "noop", matchIfMissing = true)
public class NoOpObjectStorageAdapter implements ObjectStoragePort {

    private final StorageKeyGenerator keyGenerator;

    public NoOpObjectStorageAdapter(StorageKeyGenerator keyGenerator) {
        this.keyGenerator = keyGenerator;
    }

    @Override
    public void putObject(String bucket, String objectKey, InputStream data, long size, String contentType) {
        keyGenerator.validateBucket(bucket);
        keyGenerator.validateKeyForCurrentTenant(objectKey);
    }

    @Override
    public InputStream getObjectStream(String bucket, String objectKey) {
        keyGenerator.validateBucket(bucket);
        keyGenerator.validateKeyForCurrentTenant(objectKey);
        throw new ResourceNotFoundException("Almacenamiento de objetos deshabilitado (modo zero-retention / noop).");
    }

    @Override
    public void deleteObject(String bucket, String objectKey) {
        keyGenerator.validateBucket(bucket);
        keyGenerator.validateKeyForCurrentTenant(objectKey);
    }

    @Override
    public boolean exists(String bucket, String objectKey) {
        keyGenerator.validateBucket(bucket);
        keyGenerator.validateKeyForCurrentTenant(objectKey);
        return false;
    }

    @Override
    public String generatePresignedDownloadUrl(String bucket, String objectKey, Duration ttl) {
        keyGenerator.validateBucket(bucket);
        keyGenerator.validateKeyForCurrentTenant(objectKey);
        throw new UnsupportedOperationException("URLs prefirmadas no disponibles con el proveedor noop.");
    }
}
