package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DocumentEntity;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.repository.DocumentChunkRepository;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.AuditLogService.ChainVerificationResult;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.UUID;
import java.util.stream.Stream;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.interactive.action.PDActionJavaScript;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DocumentZeroRetentionIngestionTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static Path sharedTempDir;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (sharedTempDir == null) {
            sharedTempDir = Files.createTempDirectory("omega-zero-ret-test-");
        }
        registry.add("omega.ingest.temp-dir", () -> sharedTempDir.toAbsolutePath().toString());

        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            pgContainer = new PostgreSQLContainer<>(
                    DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_rag_test")
                    .withUsername("omega_test")
                    .withPassword("omega_test_secret");
            pgContainer.start();
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

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private DocumentChunkRepository documentChunkRepository;

    @Autowired
    private AuditLogService auditLogService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private EmbeddingProvider embeddingProvider;

    @Test
    void completeZeroRetentionLifecycleDeletesTempPdfAndMaintainsImmutableAuditChain() throws Exception {
        stubDeterministicEmbeddings();

        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode tenantA = registerTenant("zr-alpha-" + suffix, "ZeroRet Alpha", "admin@" + suffix + ".org");
        String tokenA = tenantA.get("accessToken").asText();
        UUID tenantAId = UUID.fromString(tenantA.get("tenantId").asText());
        UUID expAId = createExpediente(tokenA, "Expediente Zero-Retention");

        byte[] pdfBytes = buildValidPdf("1. Informe Forense Móvil", "Hallazgo crítico Pegasus con dominio telemetry.spyware-test.org.");
        String expectedSha256 = sha256Hex(pdfBytes);

        MockMultipartFile multipartFile = new MockMultipartFile(
                "file",
                "../../path-traversal/informe-forense.pdf",
                MediaType.APPLICATION_PDF_VALUE,
                pdfBytes
        );

        MvcResult uploadRes = mockMvc.perform(multipart("/api/v1/expedientes/" + expAId + "/documents")
                        .file(multipartFile)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isAccepted())
                .andReturn();

        JsonNode accepted = objectMapper.readTree(uploadRes.getResponse().getContentAsString());
        UUID documentId = UUID.fromString(accepted.get("id").asText());
        assertThat(accepted.get("originalFilename").asText()).isEqualTo("informe-forense.pdf");
        assertThat(accepted.get("sha256Hash").asText()).isEqualTo(expectedSha256);

        // Esperar finalización del pool @Async Zero-Retention
        DocumentEntity indexed = awaitTerminalStatus(tokenA, expAId, documentId);
        assertThat(indexed.getStatus()).isEqualTo(DocumentStatus.INDEXED);
        assertThat(indexed.getTempDeletedAt()).isNotNull();
        assertThat(documentChunkRepository.countByTenantIdAndDocumentId(tenantAId, documentId)).isGreaterThan(0);

        // Cero archivos PDF permanentes o huérfanos en el almacenamiento temporal
        try (Stream<Path> files = Files.list(sharedTempDir)) {
            assertThat(files.toList()).isEmpty();
        }

        // Verificar cadena SHA-256 e inmutabilidad en PostgreSQL
        ChainVerificationResult verification = auditLogService.verifyTenantChain(tenantAId);
        assertThat(verification.valid()).isTrue();
        assertThat(verification.verifiedCount()).isGreaterThanOrEqualTo(2);

        assertThatThrownBy(() -> jdbcTemplate.update(
                "UPDATE omega_rag.audit_logs SET action = 'TAMPERED' WHERE tenant_id = ?",
                tenantAId
        )).hasMessageContaining("inmutable");

        // Tenant B NO puede ver ni listar documentos del Tenant A
        JsonNode tenantB = registerTenant("zr-bravo-" + suffix, "ZeroRet Bravo", "admin-b@" + suffix + ".org");
        String tokenB = tenantB.get("accessToken").asText();

        mockMvc.perform(get("/api/v1/expedientes/" + expAId + "/documents")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/v1/expedientes/" + expAId + "/documents/" + documentId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                .andExpect(status().isNotFound());
    }

    @Test
    void rejectsMaliciousPdfWithJavascriptLaunchAndBadMagicBytesWhilePurgingTemp() throws Exception {
        stubDeterministicEmbeddings();

        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode tenant = registerTenant("zr-sec-" + suffix, "ZeroRet Sec", "sec@" + suffix + ".org");
        String token = tenant.get("accessToken").asText();
        UUID tenantId = UUID.fromString(tenant.get("tenantId").asText());
        UUID expId = createExpediente(token, "Expediente Seguridad PDF");

        // 1. PDF con /JavaScript embebido en /OpenAction
        byte[] jsPdf = buildJsMaliciousPdf();
        mockMvc.perform(multipart("/api/v1/expedientes/" + expId + "/documents")
                        .file(new MockMultipartFile("file", "payload-js.pdf", MediaType.APPLICATION_PDF_VALUE, jsPdf))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnprocessableEntity());

        // 2. PDF con acción /Launch
        byte[] launchPdf = buildLaunchMaliciousPdf();
        mockMvc.perform(multipart("/api/v1/expedientes/" + expId + "/documents")
                        .file(new MockMultipartFile("file", "payload-launch.pdf", MediaType.APPLICATION_PDF_VALUE, launchPdf))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnprocessableEntity());

        // 3. Archivo disfrazado sin magic bytes %PDF-
        mockMvc.perform(multipart("/api/v1/expedientes/" + expId + "/documents")
                        .file(new MockMultipartFile("file", "fake.pdf", MediaType.APPLICATION_PDF_VALUE,
                                "MZ_EXECUTABLE_NOT_PDF".getBytes(StandardCharsets.UTF_8)))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isBadRequest());

        assertThat(documentRepository.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(tenantId, expId)).isEmpty();
        try (Stream<Path> files = Files.list(sharedTempDir)) {
            assertThat(files.toList()).isEmpty();
        }
        assertThat(auditLogService.verifyTenantChain(tenantId).valid()).isTrue();
        assertThat(auditLogService.listRecent(tenantId, 10))
                .anySatisfy(e -> assertThat(e.getAction()).isEqualTo("DOCUMENT_REJECTED_UNSAFE_PDF"));
    }

    private void stubDeterministicEmbeddings() {
        when(embeddingProvider.modelName()).thenReturn("text-embedding-3-small");
        when(embeddingProvider.dimensions()).thenReturn(1536);
        when(embeddingProvider.embedBatch(anyList())).thenAnswer(inv -> {
            @SuppressWarnings("unchecked")
            var texts = (java.util.List<String>) inv.getArgument(0);
            return texts.stream().map(t -> unitVec(0.05f)).toList();
        });
    }

    private DocumentEntity awaitTerminalStatus(String token, UUID expId, UUID docId) throws Exception {
        long deadline = System.currentTimeMillis() + 12_000;
        while (System.currentTimeMillis() < deadline) {
            MvcResult poll = mockMvc.perform(get("/api/v1/expedientes/" + expId + "/documents/" + docId)
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                    .andExpect(status().isOk())
                    .andReturn();
            String status = objectMapper.readTree(poll.getResponse().getContentAsString(StandardCharsets.UTF_8)).get("status").asText();
            if (!"PROCESSING".equals(status)) {
                return documentRepository.findById(docId).orElseThrow();
            }
            Thread.sleep(60);
        }
        throw new AssertionError("Timeout esperando indexación async del documento " + docId);
    }

    private JsonNode registerTenant(String slug, String name, String email) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/auth/tenants/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantSlug": "%s",
                                  "tenantName": "%s",
                                  "adminEmail": "%s",
                                  "adminPassword": "ClaveSuperSegura2026!",
                                  "adminFullName": "Admin OMEGA"
                                }
                                """.formatted(slug, name, email)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString());
    }

    private UUID createExpediente(String token, String title) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/expedientes")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "title": "%s", "classification": "RESTRICTED" }
                                """.formatted(title)))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString(StandardCharsets.UTF_8)).get("id").asText());
    }

    private static byte[] buildValidPdf(String heading, String body) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                cs.newLineAtOffset(50, 720);
                cs.showText(heading);
                cs.newLineAtOffset(0, -24);
                cs.showText(body);
                cs.endText();
            }
            doc.save(baos);
            return baos.toByteArray();
        }
    }

    private static byte[] buildJsMaliciousPdf() throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            doc.addPage(new PDPage());
            doc.getDocumentCatalog().setOpenAction(new PDActionJavaScript("app.alert('malicious');"));
            doc.save(baos);
            return baos.toByteArray();
        }
    }

    private static byte[] buildLaunchMaliciousPdf() throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            doc.addPage(new PDPage());
            COSDictionary launch = new COSDictionary();
            launch.setName(COSName.S, "Launch");
            launch.setString(COSName.F, "cmd.exe");
            doc.getDocumentCatalog().getCOSObject().setItem(COSName.OPEN_ACTION, launch);
            doc.save(baos);
            return baos.toByteArray();
        }
    }

    private static String sha256Hex(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static float[] unitVec(float val) {
        float[] v = new float[1536];
        Arrays.fill(v, val);
        return v;
    }
}
