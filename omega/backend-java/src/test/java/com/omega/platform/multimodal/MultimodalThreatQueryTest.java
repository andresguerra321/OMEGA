package com.omega.platform.multimodal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.cti.ExternalReputationService;
import com.omega.platform.cti.PublicCorpusRagService;
import com.omega.platform.cti.StixCatalogService;
import com.omega.platform.domain.IocIndicatorEntity;
import com.omega.platform.ingest.InvalidDocumentException;
import com.omega.platform.ingest.OcrExtractor;
import com.omega.platform.integration.forensic.ForensicBridgeService;
import com.omega.platform.integration.forensic.ForensicWorkerContracts.LinkVerifyResponse;
import com.omega.platform.multimodal.MultimodalThreatQueryService.MultimodalThreatResponse;
import com.omega.platform.multimodal.VisionAnalysisProvider.ImageForensicExtraction;
import com.omega.platform.rag.HybridRagQueryService;
import com.omega.platform.rag.HybridRagQueryService.RagCitationDto;
import com.omega.platform.rag.HybridRagQueryService.RagQueryResponse;
import com.omega.platform.security.ExpedienteAuthorizationService;
import com.omega.platform.security.OmegaPrincipal;
import com.omega.platform.security.Role;
import com.omega.platform.service.AuditLogService;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class MultimodalThreatQueryTest {

    @TempDir
    Path tempDir;

    private OmegaProperties buildProperties() {
        return new OmegaProperties(
                new OmegaProperties.Security("0123456789abcdef0123456789abcdef", 3600, "omega-test", true, "", "token"),
                new OmegaProperties.Ingest(tempDir.toString(), 26214400L, "/usr/share/tesseract-ocr/4.00/tessdata"),
                new OmegaProperties.Rag("openai", "text-embedding-3-small", 1536, "https://api.openai.com/v1", "", 32, 2, "gpt-4o-mini", 60, 1.0, 1.0, 500, 1000, 120),
                new OmegaProperties.ForensicWorker("http://forensic-worker:8000", 5000, 120000),
                new OmegaProperties.Cti("/app/corpus_mvp/iocs")
        );
    }

    private static byte[] createValidPngBytes() throws Exception {
        BufferedImage img = new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }

    @Test
    void rejectsFakeMagicBytes() {
        ImageSecuritySanitizer sanitizer = new ImageSecuritySanitizer(buildProperties());
        byte[] fakePng = "MZ_NOT_A_REAL_PNG_PAYLOAD".getBytes(StandardCharsets.UTF_8);

        assertThatThrownBy(() -> sanitizer.sanitize(fakePng))
                .isInstanceOf(InvalidDocumentException.class)
                .hasMessageContaining("magic bytes");
    }

    @Test
    void correlatesStixDomainPublicRagCitationAndAuditsSha256WithoutTempFiles() throws Exception {
        ImageSecuritySanitizer sanitizer = new ImageSecuritySanitizer(buildProperties());
        VisionAnalysisProvider visionProvider = mock(VisionAnalysisProvider.class);
        OcrExtractor ocrExtractor = mock(OcrExtractor.class);
        StixCatalogService stixCatalogService = mock(StixCatalogService.class);
        ExternalReputationService reputationService = mock(ExternalReputationService.class);
        ForensicBridgeService forensicBridgeService = mock(ForensicBridgeService.class);
        HybridRagQueryService hybridRagQueryService = mock(HybridRagQueryService.class);
        PublicCorpusRagService publicCorpusRagService = mock(PublicCorpusRagService.class);
        ExpedienteAuthorizationService authorizationService = mock(ExpedienteAuthorizationService.class);
        AuditLogService auditLogService = mock(AuditLogService.class);

        byte[] pngBytes = createValidPngBytes();
        String c2Domain = "free247downloads.com";

        when(visionProvider.analyze(any(), any())).thenReturn(new ImageForensicExtraction(
                "Captura de SMS sospechoso con enlace de descarga.",
                List.of("https://" + c2Domain + "/app"),
                List.of(c2Domain),
                "ONE_CLICK_PHISHING",
                "gpt-4o-mini"
        ));
        when(ocrExtractor.extractText(any())).thenReturn("Visita https://" + c2Domain + "/app ahora");

        IocIndicatorEntity stixEntity = mock(IocIndicatorEntity.class);
        when(stixEntity.getIocType()).thenReturn("domain");
        when(stixEntity.getIocValue()).thenReturn(c2Domain);
        when(stixEntity.getNormalizedValue()).thenReturn(c2Domain);
        when(stixEntity.getSourceReport()).thenReturn("Amnesty Forensic Report");
        when(stixEntity.getOrganization()).thenReturn("Amnesty Tech");
        when(stixCatalogService.lookupIndicator(c2Domain)).thenReturn(List.of(stixEntity));
        when(reputationService.lookupIndicator(c2Domain)).thenReturn(Map.of("indicator", c2Domain));
        when(forensicBridgeService.verifyLink(any(), any(), any())).thenReturn(new LinkVerifyResponse(
                "https://" + c2Domain + "/app",
                c2Domain,
                null,
                "https",
                "/app",
                "HIGH",
                "Peligroso",
                "No abrir",
                List.of(),
                0,
                List.of(),
                "Pasivo"
        ));
        when(hybridRagQueryService.queryExpediente(any(), any(), any()))
                .thenReturn(new RagQueryResponse("OK_EMPTY", "text-embedding-3-small", "", List.of(), List.of(), List.of()));
        when(publicCorpusRagService.queryPublicCorpus(any(), any()))
                .thenReturn(new RagQueryResponse(
                        "OK",
                        "text-embedding-3-small",
                        "Metodología [1]",
                        List.of(),
                        List.of(),
                        List.of(new RagCitationDto(
                                UUID.randomUUID(),
                                "amnesty_2021_pegasus_forensic_methodology.pdf",
                                "abc123",
                                12,
                                "Amnesty Tech · Infrastructure",
                                "[1]",
                                "El dominio free247downloads.com fue usado en infección Pegasus.",
                                0.0,
                                0.9,
                                0.9
                        ))
                ));

        MultimodalThreatQueryService service = new MultimodalThreatQueryService(
                sanitizer,
                visionProvider,
                ocrExtractor,
                stixCatalogService,
                reputationService,
                forensicBridgeService,
                hybridRagQueryService,
                publicCorpusRagService,
                authorizationService,
                auditLogService
        );

        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID expId = UUID.randomUUID();
        OmegaPrincipal principal = new OmegaPrincipal(userId, tenantId, "analyst@omega.local", Role.ANALYST, true);

        MultimodalThreatResponse response = service.analyzePrivateExpediente(principal, expId, pngBytes, "¿Es peligroso?");

        assertThat(response.riskLevel()).isEqualTo("HIGH");
        assertThat(response.stixMatches()).hasSize(1);
        assertThat(response.citations()).hasSize(1);
        assertThat(response.imageSha256()).hasSize(64);
        assertThat(Files.list(tempDir).count()).isZero();

        verify(authorizationService).requireReadAccess(principal, expId);
        verify(auditLogService).record(
                eq(tenantId),
                eq(userId),
                eq("MULTIMODAL_THREAT_QUERY"),
                eq("EXPEDIENTE"),
                eq(expId.toString()),
                argThat(meta -> response.imageSha256().equals(meta.get("imageSha256Hash"))
                        && "ONE_CLICK_PHISHING".equals(meta.get("suspectedVector")))
        );
    }
}
