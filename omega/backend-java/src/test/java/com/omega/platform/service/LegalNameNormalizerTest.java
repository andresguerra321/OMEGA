package com.omega.platform.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class LegalNameNormalizerTest {

    @Test
    void foldsAccentsCaseAndEnyeToTheSameKey() {
        assertThat(LegalNameNormalizer.normalize("Óscar")).isEqualTo("oscar");
        assertThat(LegalNameNormalizer.normalize("ÓSCAR")).isEqualTo("oscar");
        assertThat(LegalNameNormalizer.normalize("Úrsula")).isEqualTo("ursula");
        assertThat(LegalNameNormalizer.normalize("ÚRSULA")).isEqualTo("ursula");
        assertThat(LegalNameNormalizer.normalize("Muñoz")).isEqualTo(LegalNameNormalizer.normalize("Munoz")).isEqualTo("munoz");
        assertThat(LegalNameNormalizer.normalize("José")).isEqualTo(LegalNameNormalizer.normalize("Jose")).isEqualTo("jose");
    }

    @Test
    void dropsPunctuationAndCollapsesWhitespace() {
        assertThat(LegalNameNormalizer.normalize("  Inversiones   Córdoba S.A.S. ")).isEqualTo("inversiones cordoba sas");
        assertThat(LegalNameNormalizer.normalize("O'Connor_1 / Ruta\\Norte")).isEqualTo("oconnor 1 ruta norte");
        assertThat(LegalNameNormalizer.normalize(null)).isEmpty();
        assertThat(LegalNameNormalizer.normalize("%%%%")).isEmpty();
    }

    @Test
    void escapesLikeWildcardsLiterally() {
        assertThat(LegalNameNormalizer.escapeLikeLiteral("a%b_c\\d")).isEqualTo("a\\%b\\_c\\\\d");
    }
}
