package com.omega.platform.storage;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Propiedades de almacenamiento de objetos S3-compatible (MinIO / fallback noop / memory).
 * Por defecto mantiene modo zero-retention (`retentionEnabled = false`) y proveedor `noop`.
 */
@Component
@ConfigurationProperties(prefix = "omega.storage")
public class StorageProperties {

    private String provider = "noop";
    private boolean retentionEnabled = false;
    private int defaultRetentionDays = 365;
    private Minio minio = new Minio();

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public boolean isRetentionEnabled() {
        return retentionEnabled;
    }

    public void setRetentionEnabled(boolean retentionEnabled) {
        this.retentionEnabled = retentionEnabled;
    }

    public int getDefaultRetentionDays() {
        return defaultRetentionDays;
    }

    public void setDefaultRetentionDays(int defaultRetentionDays) {
        this.defaultRetentionDays = Math.max(1, defaultRetentionDays);
    }

    public Minio getMinio() {
        return minio;
    }

    public void setMinio(Minio minio) {
        this.minio = minio != null ? minio : new Minio();
    }

    public static class Minio {
        private String endpoint = "http://localhost:9000";
        private String accessKey = "";
        private String secretKey = "";
        private String vaultBucket = "omega-vault";
        private String stagingBucket = "omega-staging";
        private int presignTtlSeconds = 90;

        public String getEndpoint() {
            return endpoint;
        }

        public void setEndpoint(String endpoint) {
            this.endpoint = endpoint;
        }

        public String getAccessKey() {
            return accessKey;
        }

        public void setAccessKey(String accessKey) {
            this.accessKey = accessKey;
        }

        public String getSecretKey() {
            return secretKey;
        }

        public void setSecretKey(String secretKey) {
            this.secretKey = secretKey;
        }

        public String getVaultBucket() {
            return vaultBucket;
        }

        public void setVaultBucket(String vaultBucket) {
            this.vaultBucket = vaultBucket;
        }

        public String getStagingBucket() {
            return stagingBucket;
        }

        public void setStagingBucket(String stagingBucket) {
            this.stagingBucket = stagingBucket;
        }

        public int getPresignTtlSeconds() {
            return presignTtlSeconds;
        }

        public void setPresignTtlSeconds(int presignTtlSeconds) {
            this.presignTtlSeconds = Math.max(1, presignTtlSeconds);
        }
    }
}
