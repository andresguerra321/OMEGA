package com.omega.platform.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/**
 * Q5: Pruebas deterministas de detección de fechas para cronología LEGAL:
 * - Formatos variados (ISO, DD/MM/YYYY, español textual)
 * - Fechas ambiguas (marcadas para verificación)
 * - Fechas inválidas ignoradas
 * - Cero eventos inventados cuando el texto no contiene fechas
 */
class LegalTimelineServiceTest {

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

        var clearEs = detected.stream().filter(d -> d.date().equals(LocalDate.of(2024, 3, 15))).findFirst().orElseThrow();
        assertThat(clearEs.ambiguous()).isFalse();
        assertThat(clearEs.excerpt()).contains("15 de marzo de 2024");
    }

    @Test
    void inventsZeroEventsWhenTextHasNoDates() {
        String text = "Cláusula general de confidencialidad entre las partes sintéticas sin mención de fechas ni calendario.";
        assertThat(LegalTimelineService.detectDatesDeterministically(text)).isEmpty();
        assertThat(LegalTimelineService.detectDatesDeterministically("")).isEmpty();
        assertThat(LegalTimelineService.detectDatesDeterministically(null)).isEmpty();
    }
}
