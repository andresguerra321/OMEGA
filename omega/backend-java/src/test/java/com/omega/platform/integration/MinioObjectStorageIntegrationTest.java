package com.omega.platform.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.config.SovereignModePolicy;
import com.omega.platform.domain.DocumentStatus;
import com.omega.platform.rag.EmbeddingException;
import com.omega.platform.rag.EmbeddingProvider;
import com.omega.platform.repository.DocumentRepository;
import com.omega.platform.security.Role;
import com.omega.platform.security.TenantContext;
import com.omega.platform.security.TenantScope;
import com.omega.platform.storage.InMemoryObjectStorageAdapter;
import com.omega.platform.storage.ObjectStorageException;
import com.omega.platform.storage.ObjectStoragePort;
import com.omega.platform.storage.StorageKeyGenerator;
import com.omega.platform.storage.StorageProperties;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Pruebas de integración del almacenamiento de objetos S3-compatible (MinIO / memoria):
 * - Aislamiento multi-tenant estricto en StorageKeyGenerator, ObjectStoragePort y endpoint /download
 * - Rechazo de path traversal y nombres maliciosos
 * - Garantía Zero-Retention (no persiste objetos en omega-vault cuando retentionEnabled=false)
 * - Respeto de SovereignModePolicy sobre endpoints externos
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@org.springframework.context.annotation.Import(PaidWorkspaceFixture.class)
class MinioObjectStorageIntegrationTest {

    private static final String EXTERNAL_DB_URL = System.getenv("OMEGA_TEST_DB_URL");
    private static PostgreSQLContainer<?> pgContainer;
    private static Path sharedTempDir;

    @DynamicPropertySource
    static void registerProps(DynamicPropertyRegistry registry) throws Exception {
        if (sharedTempDir == null) {
            sharedTempDir = Files.createTempDirectory("omega-storage-test-");
        }
        registry.add("omega.ingest.temp-dir", () -> sharedTempDir.toAbsolutePath().toString());
        registry.add("omega.storage.provider", () -> "memory");
        registry.add("omega.storage.retention-enabled", () -> "false");
        if (EXTERNAL_DB_URL != null && !EXTERNAL_DB_URL.isBlank()) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB_URL);
            registry.add("spring.datasource.username", () -> envOrDefault("OMEGA_TEST_DB_USER", "omega_test"));
            registry.add("spring.datasource.password", () -> envOrDefault("OMEGA_TEST_DB_PASSWORD", "omega_test_secret"));
            return;
        }
        if (pgContainer == null) {
            @SuppressWarnings("resource")
            PostgreSQLContainer<?> container = new PostgreSQLContainer<>(
                    DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres")
            )
                    .withDatabaseName("omega_storage_test")
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

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private DocumentRepository documentRepository;
    @Autowired private ObjectStoragePort objectStoragePort;
    @Autowired private StorageKeyGenerator keyGenerator;
    @Autowired private StorageProperties storageProperties;

    @MockBean private EmbeddingProvider embeddingProvider;

    @Test
    void enforcesMultiTenantIsolationAndRejectsPathTraversalKeys() {
        UUID tenantA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();
        UUID expedienteId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        byte[] payload = "contenido-sintetico-cifrado".getBytes(StandardCharsets.UTF_8);

        String keyA;
        try {
            TenantContext.set(new TenantScope(tenantA, UUID.randomUUID(), Role.ADMIN));
            keyA = keyGenerator.generateDocumentKey(expedienteId, docId);
            assertThat(keyA).isEqualTo("tenants/" + tenantA + "/expedientes/" + expedienteId + "/" + docId + ".bin");

            objectStoragePort.putObject("omega-vault", keyA, new ByteArrayInputStream(payload), payload.length, "application/pdf");
            assertThat(objectStoragePort.exists("omega-vault", keyA)).isTrue();

            // Rechazo de path traversal y nombres de archivo maliciosos
            assertThatThrownBy(() -> keyGenerator.validateKeyForCurrentTenant("../etc/passwd"))
                    .isInstanceOf(ObjectStorageException.class);
            assertThatThrownBy(() -> keyGenerator.validateKeyForCurrentTenant("tenants/" + tenantA + "/expedientes/../../secret.pdf"))
                    .isInstanceOf(ObjectStorageException.class);
            assertThatThrownBy(() -> keyGenerator.validateKeyForCurrentTenant("tenants/" + tenantA + "/expedientes/" + expedienteId + "/contrato_real.pdf"))
                    .isInstanceOf(ObjectStorageException.class);
            assertThatThrownBy(() -> keyGenerator.validateKeyForCurrentTenant("tenants/" + tenantA + "/expedientes/" + expedienteId + "/" + docId + ".bin\0.jpg"))
                    .isInstanceOf(ObjectStorageException.class);
            assertThatThrownBy(() -> keyGenerator.validateBucket("../omega-vault"))
                    .isInstanceOf(ObjectStorageException.class);
        } finally {
            TenantContext.clear();
        }

        // Tenant B no puede comprobar existencia, leer ni borrar el objeto de Tenant A
        try {
            TenantContext.set(new TenantScope(tenantB, UUID.randomUUID(), Role.ADMIN));
            assertThatThrownBy(() -> objectStoragePort.exists("omega-vault", keyA))
                    .isInstanceOf(SecurityException.class);
            assertThatThrownBy(() -> objectStoragePort.getObjectStream("omega-vault", keyA))
                    .isInstanceOf(SecurityException.class);
            assertThatThrownBy(() -> objectStoragePort.deleteObject("omega-vault", keyA))
                    .isInstanceOf(SecurityException.class);
        } finally {
            TenantContext.clear();
        }

        // Limpieza como Tenant A
        try {
            TenantContext.set(new TenantScope(tenantA, UUID.randomUUID(), Role.ADMIN));
            objectStoragePort.deleteObject("omega-vault", keyA);
            assertThat(objectStoragePort.exists("omega-vault", keyA)).isFalse();
        } finally {
            TenantContext.clear();
        }
    }

    @Test
    void zeroRetentionSkipsVaultPersistenceWhileRetentionModeAllowsAuthenticatedDownloadAndBlocksCrossTenant() throws Exception {
        when(embeddingProvider.modelName()).thenReturn("text-embedding-3-small");
        when(embeddingProvider.dimensions()).thenReturn(1536);
        when(embeddingProvider.embedBatch(anyList())).thenThrow(new EmbeddingException("lexical"));
        when(embeddingProvider.embedQuery(anyString())).thenThrow(new EmbeddingException("lexical"));

        JsonNode tenantA = registerLegalTenant("legal-stor-a-" + UUID.randomUUID().toString().substring(0, 8));
        JsonNode tenantB = registerLegalTenant("legal-stor-b-" + UUID.randomUUID().toString().substring(0, 8));
        String tokenA = tenantA.get("accessToken").asText();
        String tokenB = tenantB.get("accessToken").asText();
        UUID tenantIdA = UUID.fromString(tenantA.get("tenantId").asText());

        UUID caseId = createCase(tokenA, "Expediente Storage Integracion");
        byte[] pdfBytes = buildPdf("Documento sintetico de prueba para zero-retention y vault.");

        // 1. Modo zero-retention (por defecto): NO persiste objeto en omega-vault
        storageProperties.setRetentionEnabled(false);
        int beforeCount = ((InMemoryObjectStorageAdapter) objectStoragePort).totalStoredCount();

        MvcResult zeroUp = mockMvc.perform(multipart("/api/v1/expedientes/" + caseId + "/documents")
                        .file(new MockMultipartFile("file", "../../malicioso_nombre.pdf", "application/pdf", pdfBytes))
                        .with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isAccepted())
                .andReturn();
        UUID zeroDocId = UUID.fromString(objectMapper.readTree(zeroUp.getResponse().getContentAsString()).path("id").asText());
        waitUntilIndexed(zeroDocId);

        var zeroDoc = documentRepository.findById(zeroDocId).orElseThrow();
        assertThat(zeroDoc.getStorageBucket()).isNull();
        assertThat(zeroDoc.getStorageObjectKey()).isNull();
        assertThat(((InMemoryObjectStorageAdapter) objectStoragePort).totalStoredCount()).isEqualTo(beforeCount);

        mockMvc.perform(get("/api/v1/expedientes/" + caseId + "/documents/" + zeroDocId + "/download")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                .andExpect(status().isNotFound());

        // 2. Modo con retención habilitada: guarda binario sanitizado con key determinística sin nombre de usuario
        storageProperties.setRetentionEnabled(true);
        try {
            byte[] pdfBytes2 = buildPdf("Segundo documento sintetico con retencion habilitada en vault.");
            MvcResult retUp = mockMvc.perform(multipart("/api/v1/expedientes/" + caseId + "/documents")
                            .file(new MockMultipartFile("file", "..\\..\\nombre_peligroso_cliente.pdf", "application/pdf", pdfBytes2))
                            .with(csrf())
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                    .andExpect(status().isAccepted())
                    .andReturn();
            UUID retDocId = UUID.fromString(objectMapper.readTree(retUp.getResponse().getContentAsString()).path("id").asText());
            waitUntilIndexed(retDocId);

            var retDoc = documentRepository.findById(retDocId).orElseThrow();
            assertThat(retDoc.getStorageBucket()).isEqualTo("omega-vault");
            assertThat(retDoc.getStorageObjectKey())
                    .isEqualTo("tenants/" + tenantIdA + "/expedientes/" + caseId + "/" + retDocId + ".bin")
                    .doesNotContain("nombre_peligroso_cliente");
            assertThat(retDoc.getContentSha256()).isEqualTo(retDoc.getSha256Hash());
            assertThat(retDoc.getRetentionUntil()).isNotNull();

            // Descarga autenticada como Tenant A: 200 OK con el binario exacto
            MvcResult dl = mockMvc.perform(get("/api/v1/expedientes/" + caseId + "/documents/" + retDocId + "/download")
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA))
                    .andExpect(status().isOk())
                    .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                    .andReturn();
            assertThat(dl.getResponse().getContentAsByteArray()).isEqualTo(pdfBytes2);

            // Descarga cross-tenant como Tenant B: 404 sin revelar existencia
            mockMvc.perform(get("/api/v1/expedientes/" + caseId + "/documents/" + retDocId + "/download")
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB))
                    .andExpect(status().isNotFound());
        } finally {
            storageProperties.setRetentionEnabled(false);
        }
    }

    @Test
    void sovereignModeRejectsExternalMinioEndpointAndAllowsLocalMinio() {
        OmegaProperties sovereignProps = new OmegaProperties(
                null, null, null, null, null,
                new OmegaProperties.Ai("ollama", new OmegaProperties.Ollama("http://localhost:11434", "bge-m3", "qwen2.5:14b", "qwen2.5vl:7b"))
        );
        SovereignModePolicy policy = new SovereignModePolicy(sovereignProps, new MockEnvironment());

        assertThatThrownBy(() -> policy.requireLocalStorageEndpoint("https://s3.amazonaws.com"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("externos");
        assertThatThrownBy(() -> policy.requireLocalStorageEndpoint("https://minio.public-cloud.example:9000"))
                .isInstanceOf(IllegalStateException.class);

        // Endpoints locales permitidos en modo soberano
        policy.requireLocalStorageEndpoint("http://localhost:9000");
        policy.requireLocalStorageEndpoint("http://127.0.0.1:9000");
        policy.requireLocalStorageEndpoint("http://minio:9000");
    }

    private JsonNode registerLegalTenant(String slug) throws Exception {
        MvcResult reg = mockMvc.perform(post("/api/v1/auth/tenants/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantSlug\":\"" + slug + "\",\"tenantName\":\"Despacho Storage\","
                                + "\"adminEmail\":\"admin@" + slug + ".invalid\",\"adminPassword\":\"OmegaStor!2026\","
                                + "\"adminFullName\":\"Admin Storage\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode json = objectMapper.readTree(reg.getResponse().getContentAsString());
        String token = json.path("accessToken").asText();

        mockMvc.perform(put("/api/v1/profile").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profile\":\"LEGAL\",\"confirmed\":true}"))
                .andExpect(status().isOk());

        MvcResult pol = mockMvc.perform(get("/api/v1/legal/document-ai/policy")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        String fp = objectMapper.readTree(pol.getResponse().getContentAsString()).path("fingerprint").asText();
        mockMvc.perform(post("/api/v1/legal/document-ai/consent").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fingerprint\":\"" + fp + "\"}"))
                .andExpect(status().isNoContent());

        return json;
    }

    private UUID createCase(String token, String title) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/expedientes").with(csrf())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"" + title + "\",\"classification\":\"CONFIDENTIAL\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(res.getResponse().getContentAsString()).path("id").asText());
    }

    private void waitUntilIndexed(UUID docId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < deadline) {
            var opt = documentRepository.findById(docId);
            if (opt.isPresent() && opt.get().getStatus() == DocumentStatus.INDEXED) {
                return;
            }
            Thread.sleep(100);
        }
    }

    private static byte[] buildPdf(String text) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                cs.newLineAtOffset(50, 700);
                cs.showText(text.replaceAll("[^\\x20-\\x7EáéíóúÁÉÍÓÚñÑ¿¡]", " "));
                cs.endText();
            }
            doc.save(out);
            return out.toByteArray();
        }
    }
}
