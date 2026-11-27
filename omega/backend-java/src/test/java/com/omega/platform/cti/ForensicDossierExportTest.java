package com.omega.platform.cti;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.*;
import com.omega.platform.repository.*;
import com.omega.platform.security.*;
import com.omega.platform.service.AuditLogService;
import com.omega.platform.service.LegalCaseService;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.ReflectionTestUtils;

class ForensicDossierExportTest {
    final UUID tenant = UUID.randomUUID(), user = UUID.randomUUID(), caseId = UUID.randomUUID();
    final AuditLogRepository repository = mock(AuditLogRepository.class);
    final DocumentRepository documents = mock(DocumentRepository.class);
    final ExpedienteAuthorizationService authorization = mock(ExpedienteAuthorizationService.class);
    final List<AuditLogEntity> ledger = new ArrayList<>();
    final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    final AuditLogService audit = new AuditLogService(repository, mapper);
    final ForensicDossierExportService exporter = new ForensicDossierExportService(authorization, documents, repository, audit, mapper);

    @BeforeEach void setup() {
        TenantContext.set(new TenantScope(tenant, user, Role.ANALYST));
        var expediente = new ExpedienteEntity(tenant, user, "Caso de seguridad", ClassificationLevel.CONFIDENTIAL);
        when(authorization.requireReadAccess(any(), eq(caseId))).thenReturn(expediente);
        when(documents.findAllByTenantIdAndExpedienteIdOrderByCreatedAtDesc(tenant, caseId)).thenReturn(List.of(
                new DocumentEntity(tenant, caseId, user, "evidencia.pdf", "a".repeat(64), 2, "ollama:bge-m3", false, DocumentStatus.INDEXED)));
        when(repository.findFirstByTenantIdOrderByChainSeqDesc(tenant)).thenAnswer(inv -> ledger.isEmpty() ? Optional.empty() : Optional.of(ledger.getLast()));
        when(repository.saveAndFlush(any())).thenAnswer(inv -> {
            AuditLogEntity entry = inv.getArgument(0);
            ReflectionTestUtils.setField(entry, "id", UUID.randomUUID());
            ReflectionTestUtils.setField(entry, "chainSeq", (long) ledger.size() + 1);
            ledger.add(entry);
            return entry;
        });
        when(repository.findAllByTenantIdOrderByChainSeqAsc(tenant)).thenAnswer(inv -> List.copyOf(ledger));
        audit.record(tenant, user, "FORENSIC_TRIAGE_EXECUTED", "EXPEDIENTE", caseId.toString(), Map.of("totalMatches", 2));
    }

    @AfterEach void clear() { TenantContext.clear(); }

    @Test void generatesARealReadablePdfWithAllFourSectionsAndAuditEvent() throws Exception {
        byte[] pdf = exporter.exportAsPdf(caseId);
        assertThat(new String(pdf, 0, 5, StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
        assertThat(pdf.length).isGreaterThan(1000);
        try (var parsed = org.apache.pdfbox.Loader.loadPDF(pdf)) {
            String text = new org.apache.pdfbox.text.PDFTextStripper().getText(parsed);
            assertThat(text).contains("Resumen Ejecutivo", "Inventario de Evidencia", "Hallazgos", "Permisos Vigentes", "Verificación Técnica de Integridad", "Cadena de Custodia", "CHAIN_VALID", "a".repeat(64));
        }
        assertThat(ledger.getLast().getAction()).isEqualTo("EXPORT_FORENSIC_DOSSIER");
    }

    @Test void recomputesEveryHashAndExportsStoredFindings() {
        var payload = exporter.exportAsJson(caseId);
        assertThat(payload.packageIntegrity().algorithm()).isEqualTo("SHA-256");
        assertThat(payload.packageIntegrity().sha256Hash()).matches("[0-9a-f]{64}");
        assertThat(payload.packageIntegrity().disclaimer()).contains("Verificación técnica de integridad");
        assertThat(payload.activePermissions()).isEmpty();
        assertThat(payload.chainOfCustody().status()).isEqualTo("CHAIN_VALID");
        assertThat(payload.chainOfCustody().verifiedCount()).isEqualTo(2);
        assertThat(payload.chainOfCustody().rootHash()).isEqualTo(ledger.getFirst().getCurrentHash());
        assertThat(payload.chainOfCustody().finalHash()).isEqualTo(ledger.getLast().getCurrentHash());
        assertThat(payload.findings()).hasSize(1);
        assertThat(payload.riskLevel()).isEqualTo("HIGH");
        for (var entry : payload.chainOfCustody().entries()) {
            assertThat(AuditLogService.computeChainHash(entry.previousHash(), entry.tenantId(), entry.actorUserId(), entry.action(),
                    entry.resourceType(), entry.resourceId(), entry.metadataJson(), entry.createdAtUtc())).isEqualTo(entry.currentHash());
        }
    }

    @Test void detectsTamperedMetadataEvenIfTheStoredLinkHashesStillMatch() {
        ReflectionTestUtils.setField(ledger.getFirst(), "metadataJson", "{\"totalMatches\":0}");
        var payload = exporter.exportAsJson(caseId);
        assertThat(payload.chainOfCustody().status()).isEqualTo("CHAIN_COMPROMISED");
        assertThat(payload.chainOfCustody().brokenEntryId()).isEqualTo(ledger.getFirst().getId());
    }

    @Test void doesNotDiscloseAnotherCasesEvidenceOrMetadata() {
        audit.record(tenant, UUID.randomUUID(), "FORENSIC_TRIAGE_EXECUTED", "EXPEDIENTE", UUID.randomUUID().toString(), Map.of("secret", "PRIVATE OTHER CASE"));
        var payload = exporter.exportAsJson(caseId);
        assertThat(payload.chainOfCustody().status()).isEqualTo("CHAIN_VALID");
        assertThat(payload.chainOfCustody().entries().get(1).proofOnly()).isTrue();
        assertThat(payload.chainOfCustody().entries().get(1).metadataJson()).isNull();
        assertThat(payload.findings()).hasSize(1);
    }

    @Test void deniedCaseAccessHappensBeforeAnyEvidenceOrLogRead() {
        when(authorization.requireReadAccess(any(), eq(caseId))).thenThrow(new AccessDeniedException("denied"));
        clearInvocations(repository);
        assertThatThrownBy(() -> exporter.exportAsJson(caseId)).isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(documents);
        verifyNoInteractions(repository);
    }

    @Test void exportsCaseSheetInJsonAndPdf() throws Exception {
        var expediente = new ExpedienteEntity(tenant, user, "Caso de seguridad", ClassificationLevel.CONFIDENTIAL);
        expediente.setCaseReference("RAD-2026-001");
        LegalCaseService.applyCaseSheet(expediente, "Cliente Sintético SAS", "Contraparte Sintética Ltda", "Juzgado 4 Civil", "CIVIL", "Admisión");
        when(authorization.requireReadAccess(any(), eq(caseId))).thenReturn(expediente);
        var payload = exporter.exportAsJson(caseId);
        assertThat(payload.schemaVersion()).isEqualTo("omega-dossier-v2");
        var meta = payload.caseMetadata();
        assertThat(meta.caseReference()).isEqualTo("RAD-2026-001");
        assertThat(meta.clientName()).isEqualTo("Cliente Sintético SAS");
        assertThat(meta.counterpartyName()).isEqualTo("Contraparte Sintética Ltda");
        assertThat(meta.courtName()).isEqualTo("Juzgado 4 Civil");
        assertThat(meta.processType()).isEqualTo("CIVIL");
        assertThat(meta.caseStage()).isEqualTo("Admisión");
        try (var parsed = org.apache.pdfbox.Loader.loadPDF(exporter.exportAsPdf(caseId))) {
            String text = new org.apache.pdfbox.text.PDFTextStripper().getText(parsed);
            assertThat(text).contains("Ficha del caso", "RAD-2026-001", "Cliente Sintético SAS", "Juzgado 4 Civil", "Admisión");
        }
        Instant fixedExportTime = Instant.parse("2026-11-26T18:00:00Z");
        var alteredMeta = new ForensicDossierExportService.CaseMetadata(
                meta.expedienteId(), meta.tenantId(), meta.title(), meta.classification(), meta.createdAtUtc(),
                meta.caseReference(), meta.status(), "Otro Cliente", meta.counterpartyName(),
                meta.courtName(), meta.processType(), meta.caseStage());
        String hashOriginal = ForensicDossierExportService.computePackageHash(
                meta, payload.evidence(), payload.activePermissions(), payload.chainOfCustody().finalHash(), fixedExportTime);
        String hashAltered = ForensicDossierExportService.computePackageHash(
                alteredMeta, payload.evidence(), payload.activePermissions(), payload.chainOfCustody().finalHash(), fixedExportTime);
        assertThat(hashAltered).isNotEqualTo(hashOriginal);

        var boundaryLeft = new ForensicDossierExportService.CaseMetadata(
                meta.expedienteId(), meta.tenantId(), meta.title(), meta.classification(), meta.createdAtUtc(),
                meta.caseReference(), meta.status(), "A|B", "C", null, meta.processType(), meta.caseStage());
        var boundaryRight = new ForensicDossierExportService.CaseMetadata(
                meta.expedienteId(), meta.tenantId(), meta.title(), meta.classification(), meta.createdAtUtc(),
                meta.caseReference(), meta.status(), "A", "B|C", "null", meta.processType(), meta.caseStage());
        assertThat(ForensicDossierExportService.computePackageHash(
                boundaryLeft, payload.evidence(), payload.activePermissions(), payload.chainOfCustody().finalHash(), fixedExportTime))
                .isNotEqualTo(ForensicDossierExportService.computePackageHash(
                        boundaryRight, payload.evidence(), payload.activePermissions(), payload.chainOfCustody().finalHash(), fixedExportTime));
    }

    @Test void requiresATenantScope() {
        TenantContext.clear();
        assertThatThrownBy(() -> exporter.exportAsJson(caseId)).isInstanceOf(AccessDeniedException.class);
    }
}
