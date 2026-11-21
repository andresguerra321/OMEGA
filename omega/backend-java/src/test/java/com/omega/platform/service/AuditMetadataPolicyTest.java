package com.omega.platform.service;

import static org.assertj.core.api.Assertions.*;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AuditMetadataPolicyTest {
    @Test void neverKeepsFilenamesSecretsContentOrRawExceptions() {
        String id = UUID.randomUUID().toString();
        var input = new java.util.LinkedHashMap<String, Object>(Map.of(
                "originalFilename", "synthetic-private.pdf", "content", "SYNTHETIC_PRIVATE",
                "error", "provider response includes synthetic secret", "accessToken", "synthetic-token",
                "documentId", id, "sha256Hash", "a".repeat(64), "totalPages", 2,
                "errorCode", "DOCUMENT_PROCESSING_FAILED", "status", "FAILED"));
        assertThat(AuditMetadataPolicy.sanitize(input)).containsEntry("documentId", id)
                .containsEntry("sha256Hash", "a".repeat(64)).containsEntry("errorCode", "DOCUMENT_PROCESSING_FAILED")
                .doesNotContainKeys("originalFilename", "content", "error", "accessToken");
    }
}
