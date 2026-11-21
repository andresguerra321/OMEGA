package com.omega.platform.storage;

import com.omega.platform.config.SovereignModePolicy;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.errors.ErrorResponseException;
import io.minio.http.Method;
import java.io.InputStream;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Adaptador S3-compatible respaldado por MinIO.
 * Valida política soberana sobre el endpoint y aislamiento estricto por {@link com.omega.platform.security.TenantContext}.
 */
@Component
@ConditionalOnProperty(name = "omega.storage.provider", havingValue = "minio")
public class MinioObjectStorageAdapter implements ObjectStoragePort {

    private final StorageProperties properties;
    private final StorageKeyGenerator keyGenerator;
    private final SovereignModePolicy sovereignModePolicy;
    private final MinioClient minioClient;

    public MinioObjectStorageAdapter(
            StorageProperties properties,
            StorageKeyGenerator keyGenerator,
            SovereignModePolicy sovereignModePolicy
    ) {
        this.properties = properties;
        this.keyGenerator = keyGenerator;
        this.sovereignModePolicy = sovereignModePolicy;
        StorageProperties.Minio cfg = properties.getMinio();
        this.sovereignModePolicy.requireLocalStorageEndpoint(cfg.getEndpoint());
        this.minioClient = MinioClient.builder()
                .endpoint(cfg.getEndpoint())
                .credentials(cfg.getAccessKey(), cfg.getSecretKey())
                .build();
    }

    @Override
    public void putObject(String bucket, String objectKey, InputStream data, long size, String contentType) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        sovereignModePolicy.requireLocalStorageEndpoint(properties.getMinio().getEndpoint());
        try {
            boolean bucketExists = minioClient.bucketExists(BucketExistsArgs.builder().bucket(validBucket).build());
            if (!bucketExists) {
                minioClient.makeBucket(MakeBucketArgs.builder().bucket(validBucket).build());
            }
            minioClient.putObject(PutObjectArgs.builder()
                    .bucket(validBucket)
                    .object(validKey)
                    .stream(data, size, -1)
                    .contentType(contentType == null || contentType.isBlank() ? "application/octet-stream" : contentType)
                    .build());
        } catch (Exception ex) {
            throw new ObjectStorageException("Error almacenando objeto en MinIO.", ex);
        }
    }

    @Override
    public InputStream getObjectStream(String bucket, String objectKey) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        sovereignModePolicy.requireLocalStorageEndpoint(properties.getMinio().getEndpoint());
        try {
            return minioClient.getObject(GetObjectArgs.builder()
                    .bucket(validBucket)
                    .object(validKey)
                    .build());
        } catch (Exception ex) {
            throw new ObjectStorageException("Error leyendo objeto desde MinIO.", ex);
        }
    }

    @Override
    public void deleteObject(String bucket, String objectKey) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        sovereignModePolicy.requireLocalStorageEndpoint(properties.getMinio().getEndpoint());
        try {
            minioClient.removeObject(RemoveObjectArgs.builder()
                    .bucket(validBucket)
                    .object(validKey)
                    .build());
        } catch (Exception ex) {
            throw new ObjectStorageException("Error eliminando objeto en MinIO.", ex);
        }
    }

    @Override
    public boolean exists(String bucket, String objectKey) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        sovereignModePolicy.requireLocalStorageEndpoint(properties.getMinio().getEndpoint());
        try {
            minioClient.statObject(StatObjectArgs.builder()
                    .bucket(validBucket)
                    .object(validKey)
                    .build());
            return true;
        } catch (ErrorResponseException ex) {
            String code = ex.errorResponse() != null ? ex.errorResponse().code() : "";
            if ("NoSuchKey".equalsIgnoreCase(code) || "NoSuchBucket".equalsIgnoreCase(code) || "NoSuchObject".equalsIgnoreCase(code)) {
                return false;
            }
            throw new ObjectStorageException("Error consultando existencia de objeto en MinIO.", ex);
        } catch (Exception ex) {
            throw new ObjectStorageException("Error consultando existencia de objeto en MinIO.", ex);
        }
    }

    @Override
    public String generatePresignedDownloadUrl(String bucket, String objectKey, Duration ttl) {
        String validBucket = keyGenerator.validateBucket(bucket);
        String validKey = keyGenerator.validateKeyForCurrentTenant(objectKey);
        sovereignModePolicy.requireLocalStorageEndpoint(properties.getMinio().getEndpoint());
        int maxTtl = Math.max(1, properties.getMinio().getPresignTtlSeconds());
        int effectiveSeconds = ttl == null ? maxTtl : (int) Math.max(1, Math.min(maxTtl, ttl.toSeconds()));
        try {
            return minioClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                    .method(Method.GET)
                    .bucket(validBucket)
                    .object(validKey)
                    .expiry(effectiveSeconds, TimeUnit.SECONDS)
                    .build());
        } catch (Exception ex) {
            throw new ObjectStorageException("Error generando URL prefirmada en MinIO.", ex);
        }
    }
}
