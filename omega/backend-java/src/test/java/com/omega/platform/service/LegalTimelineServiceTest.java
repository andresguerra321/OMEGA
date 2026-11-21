package com.omega.platform.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Q5 + Pre-merge Punto 3: Pruebas de exactitud y confianza de cronología LEGAL.
 * Evalúa formatos variados, fechas ambiguas (DD/MM vs MM/DD), rangos, fechas relativas
 * e inválidas, midiendo cuántos eventos salen incorrectos o omitidos.
 */
class LegalTimelineServiceTest {

    private record SyntheticExcerpt(
            String id,
            String text,
            Set<LocalDate> expectedDates,
            String expectedMinConfidence
    ) {}

    @Test
    void detectsIsoDmyAndSpanishTextDatesAndFlagsAmbiguousDates() {
        String text = """
                El contrato sintético fue firmado el 15 de marzo de 2024 en Bogotá.
                Posteriormente, el 04/07/2024 se remitió un otrosí modificatorio.
                Finalmente, la factura 2025-01-20 venció sin pago.
                También aparece una fecha inválida 31/02/2024 que debe ignorarse.
                """;

        var detected = LegalTimelineService.detectDatesDeterministically(text);
        assertThat(detected).hasSize(3);
        assertThat(detected).extracting(LegalTimelineService.DetectedDate::date)
                .containsExactlyInAnyOrder(
                        LocalDate.of(2024, 3, 15),
                        LocalDate.of(2024, 7, 4),
                        LocalDate.of(2025, 1, 20)
                );

        var ambiguous = detected.stream().filter(d -> d.date().equals(LocalDate.of(2024, 7, 4))).findFirst().orElseThrow();
        assertThat(ambiguous.ambiguous()).isTrue();
        assertThat(ambiguous.confidence()).isEqualTo("LOW");

        var clearEs = detected.stream().filter(d -> d.date().equals(LocalDate.of(2024, 3, 15))).findFirst().orElseThrow();
        assertThat(clearEs.ambiguous()).isFalse();
        assertThat(clearEs.confidence()).isEqualTo("HIGH");
        assertThat(clearEs.excerpt()).contains("15 de marzo de 2024");
    }

    @Test
    void detectsRangesAsMediumConfidenceAndNeverInventsRelativeDates() {
        String rangeText = """
                La suspensión acordada rigió del 10 al 20 de junio de 2024 por mutuo acuerdo.
                El período de garantía corrió entre el 01/05/2024 y el 15/05/2024 sin prórroga.
                El pago debía efectuarse dentro de los 15 días hábiles siguientes y al mes siguiente de la entrega.
                """;

        var detected = LegalTimelineService.detectDatesDeterministically(rangeText);
        assertThat(detected).extracting(LegalTimelineService.DetectedDate::date)
                .containsExactlyInAnyOrder(
                        LocalDate.of(2024, 6, 10),
                        LocalDate.of(2024, 6, 20),
                        LocalDate.of(2024, 5, 1),
                        LocalDate.of(2024, 5, 15)
                );

        var juneStart = detected.stream().filter(d -> d.date().equals(LocalDate.of(2024, 6, 10))).findFirst().orElseThrow();
        var juneEnd = detected.stream().filter(d -> d.date().equals(LocalDate.of(2024, 6, 20))).findFirst().orElseThrow();
        var mayStart = detected.stream().filter(d -> d.date().equals(LocalDate.of(2024, 5, 1))).findFirst().orElseThrow();
        var mayEnd = detected.stream().filter(d -> d.date().equals(LocalDate.of(2024, 5, 15))).findFirst().orElseThrow();

        assertThat(juneStart.confidence()).isEqualTo("MEDIUM");
        assertThat(juneEnd.confidence()).isEqualTo("MEDIUM");
        assertThat(mayStart.confidence()).isEqualTo("LOW");
        assertThat(mayEnd.confidence()).isEqualTo("MEDIUM");
    }

    @Test
    void accuracyBenchmarkMeasuresIncorrectAndMissedEventsAcrossVariedAndAmbiguousCorpus() {
        List<SyntheticExcerpt> corpus = List.of(
                new SyntheticExcerpt("T01-ES-TEXT",
                        "La audiencia inicial sintética se celebró el 18 de octubre de 2024.",
                        Set.of(LocalDate.of(2024, 10, 18)), "HIGH"),
                new SyntheticExcerpt("T02-ISO",
                        "Radicado electrónico registrado el 2024-11-05 en ventanilla virtual.",
                        Set.of(LocalDate.of(2024, 11, 5)), "HIGH"),
                new SyntheticExcerpt("T03-DMY-CLEAR",
                        "La notificación personal ocurrió el 28/11/2024 en el domicilio contractual.",
                        Set.of(LocalDate.of(2024, 11, 28)), "HIGH"),
                new SyntheticExcerpt("T04-DMY-AMBIG-ES",
                        "El otrosí #2 fue suscrito el 04/07/2024 en español (4 de julio).",
                        Set.of(LocalDate.of(2024, 7, 4)), "LOW"),
                // Caso adversarial real: anexo en inglés con formato MM/DD/YYYY (03/08/2024 = 8 de marzo)
                // El detector determinista en español interpreta DD/MM (3 de agosto) pero marca LOW confidence.
                new SyntheticExcerpt("T05-MMDD-US-ANNEX",
                        "Exhibit A (US format): signed on 03/08/2024 in Delaware.",
                        Set.of(LocalDate.of(2024, 3, 8)), "LOW"),
                new SyntheticExcerpt("T06-ES-RANGE-SHORT",
                        "El plazo de ejecución corrió del 10 al 20 de junio de 2024.",
                        Set.of(LocalDate.of(2024, 6, 10), LocalDate.of(2024, 6, 20)), "MEDIUM"),
                new SyntheticExcerpt("T07-FULL-RANGE",
                        "La póliza estuvo vigente entre el 01/05/2024 y el 15/05/2024.",
                        Set.of(LocalDate.of(2024, 5, 1), LocalDate.of(2024, 5, 15)), "LOW"),
                new SyntheticExcerpt("T08-RELATIVE-ONLY",
                        "El proveedor deberá responder dentro de los 15 días hábiles siguientes, a los 30 días calendario de la entrega y al mes siguiente.",
                        Set.of(), "NONE"),
                new SyntheticExcerpt("T09-INVALID-DATES",
                        "Error tipográfico en anexo: 31/02/2024 y 31/04/2024 no existen en el calendario.",
                        Set.of(), "NONE"),
                new SyntheticExcerpt("T10-DATELESS",
                        "Cláusula general de confidencialidad entre las partes sintéticas sin referencia temporal.",
                        Set.of(), "NONE")
        );

        int totalExpected = 0;
        int truePositives = 0;
        int incorrectEvents = 0;
        int missedEvents = 0;

        for (SyntheticExcerpt sample : corpus) {
            var detected = LegalTimelineService.detectDatesDeterministically(sample.text());
            Set<LocalDate> actualDates = detected.stream()
                    .map(LegalTimelineService.DetectedDate::date)
                    .collect(Collectors.toSet());

            totalExpected += sample.expectedDates().size();
            for (LocalDate actual : actualDates) {
                if (sample.expectedDates().contains(actual)) {
                    truePositives++;
                } else {
                    incorrectEvents++;
                }
            }
            for (LocalDate expected : sample.expectedDates()) {
                if (!actualDates.contains(expected)) {
                    missedEvents++;
                }
            }
            if (!"NONE".equals(sample.expectedMinConfidence())) {
                assertThat(detected).isNotEmpty();
                assertThat(detected).anyMatch(d -> d.confidence().equals(sample.expectedMinConfidence()));
            }
        }

        // Reporte exacto sobre los 9 eventos esperados en el corpus sintético de 10 cláusulas:
        // - 8/9 aciertos exactos (88.9%)
        // - 1 evento incorrecto (T05-MMDD-US-ANNEX: 03/08/2024 parseado como 3 de agosto en vez de 8 de marzo,
        //   mitigado en UI con badge "Confianza baja" y motivo explícito DD/MM vs MM/DD)
        // - 0 eventos inventados en fechas relativas, inválidas o cláusulas sin fecha
        assertThat(totalExpected).isEqualTo(9);
        assertThat(truePositives).isEqualTo(8);
        assertThat(incorrectEvents).isEqualTo(1);
        assertThat(missedEvents).isEqualTo(1);
    }

    @Test
    void inventsZeroEventsWhenTextHasNoDates() {
        String text = "Cláusula general de confidencialidad entre las partes sintéticas sin mención de fechas ni calendario.";
        assertThat(LegalTimelineService.detectDatesDeterministically(text)).isEmpty();
        assertThat(LegalTimelineService.detectDatesDeterministically("")).isEmpty();
        assertThat(LegalTimelineService.detectDatesDeterministically(null)).isEmpty();
    }
}
