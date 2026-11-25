package com.omega.platform.service;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.*;
import com.omega.platform.domain.DocumentChunkEntity;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class ProfessionalReportQualityTest {
    @Test void developmentPdfIncludesEveryFindingAcrossPagesWithoutCuttingLongText() throws Exception {
        var findings=new ArrayList<DevReportService.FindingReportItemDto>();
        for(int i=0;i<230;i++) findings.add(new DevReportService.FindingReportItemDto("Proyecto español","RULE-"+i,"HIGH",
                "Hallazgo número " + i,"src/"+"long-path/".repeat(25)+i+".js","NEW",10,UUID.randomUUID(),UUID.randomUUID(),
                "Explicación completa con información verificable y una recomendación contextual.","Pendiente de confirmar","Revisar la configuración","Repetir evaluación"));
        var project=new DevReportService.ProjectReportItemDto(UUID.randomUUID(),"Aplicación Ñandú","app",1,70,70,null,230,10,
                "WARN","HIGH","MARK_ONLY",UUID.randomUUID(),Instant.now(),"abc123","main","2.0","{\"truncated\":false}");
        var report=new DevReportService.ExecutiveReportDto("PROJECT",Instant.now(),1,70,Map.of("HIGH",230),Map.of("NEW",230),List.of(project),findings,List.of(),"Metadatos saneados.");
        try(var document=Loader.loadPDF(DevReportService.renderPdf(report,"report-reference-qa"))) {
            String text=new PDFTextStripper().getText(document);
            assertThat(document.getNumberOfPages()).isGreaterThan(3);
            assertThat(text).contains("report-reference-qa","Ñandú","Hallazgo número 229","RULE-0","RULE-229","229.js");
            assertThat(text).contains("Explicación completa", "Repetir evaluación");
        }
    }

    @Test void legalPassagesKeepSourceAndDoNotPretendToBeReviewedConclusions() {
        var document=UUID.randomUUID();
        var chunk=new DocumentChunkEntity(UUID.randomUUID(),document,UUID.randomUUID(),
                "La contratista deberá entregar el informe. El valor es COP 150000. No hay más menciones.",new float[0],3,"",0,20,"local");
        var result=LegalReportObservations.extract(List.of(chunk));
        assertThat(result.candidatesFound()).isEqualTo(2);
        assertThat(result.observations()).allSatisfy(item -> {
            assertThat(item.documentId()).isEqualTo(document);
            assertThat(item.pageNumber()).isEqualTo(3);
            assertThat(item.reviewStatus()).isEqualTo("PENDING_REVIEW");
        });
        assertThat(result.observations().getFirst().excerpt()).isEqualTo("La contratista deberá entregar el informe.");
    }

    @Test void legalCoverageExplicitlyDisclosesSelectionLimit() {
        var chunk=new DocumentChunkEntity(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),
                "Se obliga a pagar. ".repeat(220),new float[0],1,"",0,100,"local");
        var result=LegalReportObservations.extract(List.of(chunk));
        assertThat(result.candidatesFound()).isEqualTo(220);
        assertThat(result.observations()).hasSize(200);
        assertThat(result.truncated()).isTrue();
    }
    @Test void unsupportedUnicodeIsVisibleInsteadOfDisappearing() {
        assertThat(ReportPdf.safe("Análisis 文件")).isEqualTo("Análisis [U+6587][U+4EF6]");
    }
}
