package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.config.ProductionSecurityStartupValidator;
import com.omega.platform.ingest.PdfSecuritySanitizer;
import com.omega.platform.ingest.UnsafeDocumentException;
import com.omega.platform.repository.GitHubWebhookDeliveryRepository;
import com.omega.platform.service.GitHubApiClient;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.interactive.action.PDActionURI;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotationLink;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
@ActiveProfiles("test")
class SecurityAuditWave3HardeningTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static org.testcontainers.containers.PostgreSQLContainer<?> pgContainer;

    @DynamicPropertySource
    static void wave3Props(DynamicPropertyRegistry registry) {
        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            @SuppressWarnings("resource")
            var container = new org.testcontainers.containers.PostgreSQLContainer<>(
                    org.testcontainers.utility.DockerImageName.parse("pgvector/pgvector:pg16")
                            .asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_wave3_test")
                    .withUsername("omega_test")
                    .withPassword("omega_test_secret");
            container.start();
            pgContainer = container;
        }
        String baseUrl = pgContainer.getJdbcUrl();
        String sep = baseUrl.contains("?") ? "&" : "?";
        registry.add("spring.datasource.url", () -> baseUrl + sep + "currentSchema=omega_rag,public");
        registry.add("spring.datasource.username", pgContainer::getUsername);
        registry.add("spring.datasource.password", pgContainer::getPassword);
    }

    private static String envOrDefault(String key, String fallback) {
        String val = System.getenv(key);
        return (val == null || val.isBlank()) ? fallback : val;
    }

    @Autowired PdfSecuritySanitizer pdfSecuritySanitizer;
    @Autowired GitHubWebhookDeliveryRepository deliveryRepository;
    @Autowired JdbcTemplate jdbc;

    // -------------------------------------------------------------------------
    // A-03: PdfSecuritySanitizer allows only well-formed https:// /S /URI actions
    // -------------------------------------------------------------------------
    @Test
    void a03_pdfUriActionAllowsOnlyHttpsAndBlocksDangerousSchemes() throws Exception {
        Path safePdf = buildPdfWithUri("https://omega.example.org/docs/report?id=42");
        try {
            assertThatCode(() -> pdfSecuritySanitizer.validateCleanPdf(safePdf)).doesNotThrowAnyException();
        } finally {
            Files.deleteIfExists(safePdf);
        }

        for (String unsafeUri : new String[]{
                "file:///C:/Windows/System32/calc.exe",
                "smb://attacker.invalid/share/leak",
                "javascript:alert(1)",
                "data:text/html,<script>alert(1)</script>",
                "http://insecure.example.org/doc"
        }) {
            Path badPdf = buildPdfWithUri(unsafeUri);
            try {
                assertThatThrownBy(() -> pdfSecuritySanitizer.validateCleanPdf(badPdf))
                        .isInstanceOf(UnsafeDocumentException.class);
            } finally {
                Files.deleteIfExists(badPdf);
            }
        }
    }

    // -------------------------------------------------------------------------
    // B-09: 30-day delivery_id retention (payload purged at 48h), 40-hex refSha,
    //       and tarball URI userInfo / port validation
    // -------------------------------------------------------------------------
    @Test
    void b09_webhookDeliveryRetainsIdFor30DaysWhilePurgingPayloadAfter48h() {
        String deliveryId = "wave3-delivery-" + UUID.randomUUID();
        byte[] payload = "{\"action\":\"opened\"}".getBytes(StandardCharsets.UTF_8);

        assertThat(deliveryRepository.tryRecordDelivery(deliveryId, 30 * 24, "pull_request", payload)).isTrue();
        deliveryRepository.markProcessed(deliveryId);

        // Simulate 72h elapsed since received_at (past 48h payload TTL, well within 30d delivery retention)
        jdbc.update(
                "UPDATE omega_rag.github_webhook_deliveries SET received_at = ? WHERE delivery_id = ?",
                Timestamp.from(Instant.now().minus(72, ChronoUnit.HOURS)),
                deliveryId
        );

        deliveryRepository.purgeExpiredPayloadsAndDeliveries(48);

        // payload_json must be purged (NULL), but delivery_id row MUST still exist to prevent replay
        MapRow row = jdbc.queryForObject(
                "SELECT delivery_id, payload_json FROM omega_rag.github_webhook_deliveries WHERE delivery_id = ?",
                (rs, n) -> new MapRow(rs.getString("delivery_id"), rs.getString("payload_json")),
                deliveryId
        );
        assertThat(row).isNotNull();
        assertThat(row.deliveryId()).isEqualTo(deliveryId);
        assertThat(row.payloadJson()).isNull();

        // Replaying the same deliveryId after 72h MUST still be rejected
        assertThat(deliveryRepository.tryRecordDelivery(deliveryId, 30 * 24, "pull_request", payload)).isFalse();
    }

    @Test
    void b09_githubApiClientEnforces40HexRefShaAndStrictTarballUri() {
        var client = new GitHubApiClient.DefaultGitHubApiClient("", "", "");

        // Invalid refSha formats must fail before any network call
        for (String badSha : new String[]{"main", "abc123", "../evil", "g".repeat(40), "a".repeat(39), ""}) {
            assertThatThrownBy(() -> client.downloadTarballBounded("tok", "org/repo", badSha, 1024))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        // Valid tarball URIs (default port -1 and explicit 443)
        assertThatCode(() -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                URI.create("https://api.github.com/repos/org/repo/tarball/" + "a".repeat(40))))
                .doesNotThrowAnyException();
        assertThatCode(() -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                URI.create("https://codeload.github.com:443/org/repo/legacy.tar.gz/main")))
                .doesNotThrowAnyException();

        // userInfo or non-443 port MUST be rejected
        assertThatThrownBy(() -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                URI.create("https://user:pass@api.github.com/repos/org/repo/tarball/" + "a".repeat(40))))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> GitHubApiClient.DefaultGitHubApiClient.validateAllowedTarballUri(
                URI.create("https://codeload.github.com:8443/org/repo/legacy.tar.gz/main")))
                .isInstanceOf(SecurityException.class);
    }

    // -------------------------------------------------------------------------
    // NV-A1 / NV-A2: Fail-closed ProductionSecurityStartupValidator
    // -------------------------------------------------------------------------
    @Test
    void prodValidatorRejectsDefaultOrShortJwtSecretAndInsecureCookie() {
        OmegaProperties defaultSecretProps = buildMinimalProps(
                "omega-dev-local-only-hmac-sha256-secret-key-2026-change-in-prod");
        assertThatThrownBy(() -> new ProductionSecurityStartupValidator(defaultSecretProps, true).validate())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("OMEGA_JWT_SECRET");

        OmegaProperties shortSecretProps = buildMinimalProps("short-secret-123");
        assertThatThrownBy(() -> new ProductionSecurityStartupValidator(shortSecretProps, true).validate())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("OMEGA_JWT_SECRET");

        OmegaProperties strongSecretProps = buildMinimalProps(
                "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
        assertThatThrownBy(() -> new ProductionSecurityStartupValidator(strongSecretProps, false).validate())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("OMEGA_COOKIE_SECURE");

        assertThatCode(() -> new ProductionSecurityStartupValidator(strongSecretProps, true).validate())
                .doesNotThrowAnyException();
    }

    private record MapRow(String deliveryId, String payloadJson) {}

    private static OmegaProperties buildMinimalProps(String jwtSecret) {
        return new OmegaProperties(
                new OmegaProperties.Security(jwtSecret, 3600, "omega", false, "", "internal-token"),
                new OmegaProperties.Ingest("/tmp", 1024, "/tmp"),
                null,
                new OmegaProperties.ForensicWorker("http://127.0.0.1:8000", 1000, 1000),
                new OmegaProperties.Cti("/tmp")
        );
    }

    private static Path buildPdfWithUri(String uriValue) throws IOException {
        Path tmp = Files.createTempFile("omega-a03-", ".pdf");
        try (PDDocument doc = new PDDocument()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            PDAnnotationLink link = new PDAnnotationLink();
            link.setRectangle(new PDRectangle(10, 10, 100, 20));
            PDActionURI action = new PDActionURI();
            action.setURI(uriValue);
            link.setAction(action);
            page.getAnnotations().add(link);
            doc.save(tmp.toFile());
        }
        return tmp;
    }
}
