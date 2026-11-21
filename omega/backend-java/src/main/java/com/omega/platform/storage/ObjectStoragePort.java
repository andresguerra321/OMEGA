package com.omega.platform.storage;

import java.io.InputStream;
import java.time.Duration;

/**
 * Puerto hexagonal para almacenamiento de objetos S3-compatible (MinIO / memoria / noop).
 * Toda implementación debe validar el aislamiento de tenant y la integridad sintáctica de la clave.
 */
public interface ObjectStoragePort {

    void putObject(String bucket, String objectKey, InputStream data, long size, String contentType);

    InputStream getObjectStream(String bucket, String objectKey);

    void deleteObject(String bucket, String objectKey);

    boolean exists(String bucket, String objectKey);

    String generatePresignedDownloadUrl(String bucket, String objectKey, Duration ttl);
}
