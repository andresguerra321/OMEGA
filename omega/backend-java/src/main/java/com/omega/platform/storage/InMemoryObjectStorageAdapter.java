package com.omega.platform.storage;

import com.omega.platform.service.ResourceNotFoundException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Adaptador de almacenamiento en memoria para pruebas de integración y desarrollo local sin MinIO.
 * Aplica exactamente las mismas validaciones de aislamiento multi-tenant y claves seguras que MinIO.
 */
@Component
@ConditionalOnProperty(name = "omega.storage.provider", havingValue = "memory")
public class InMemoryObjectStorageAdapter implements ObjectStoragePort {

    private record StoredObject(byte[] bytes, String contentType) {}

    private final StorageKeyGenerator keyGenerator;
    private final Map<String, StoredObject> store = new ConcurrentHashMap<>();

    public InMemoryObjectStorageAdapter(StorageKeyGenerator keyGenerator) {
        this.keyGenerator = keyGenerator;
    }

    @Override
    public void putObject(String bucket, String objectKey, InputStream data, long size, String contentType) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        try {
            byte[] payload = data.readAllBytes();
            store.put(composite(validBucket, validKey), new StoredObject(
                    payload,
                    contentType == null || contentType.isBlank() ? "application/octet-stream" : contentType
            ));
        } catch (IOException ex) {
            throw new ObjectStorageException("Error leyendo stream de entrada para almacenamiento en memoria.", ex);
        }
    }

    @Override
    public InputStream getObjectStream(String bucket, String objectKey) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        StoredObject stored = store.get(composite(validBucket, validKey));
        if (stored == null) {
            throw new ResourceNotFoundException("Objeto no encontrado en el almacenamiento.");
        }
        return new ByteArrayInputStream(stored.bytes());
    }

    @Override
    public void deleteObject(String bucket, String objectKey) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        store.remove(composite(validBucket, validKey));
    }

    @Override
    public boolean exists(String bucket, String objectKey) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        return store.containsKey(composite(validBucket, validKey));
    }

    @Override
    public String generatePresignedDownloadUrl(String bucket, String objectKey, Duration ttl) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        if (!store.containsKey(composite(validBucket, validKey))) {
            throw new ResourceNotFoundException("Objeto no encontrado para generar URL prefirmada.");
        }
        long seconds = ttl == null ? 90 : Math.max(1, ttl.toSeconds());
        return "memory://" + validBucket + "/" + validKey + "?ttl=" + seconds;
    }

    public int totalStoredCount() {
        return store.size();
    }

    public void clear() {
        store.clear();
    }

    private static String composite(String bucket, String objectKey) {
        return bucket + "::" + objectKey;
    }
}
