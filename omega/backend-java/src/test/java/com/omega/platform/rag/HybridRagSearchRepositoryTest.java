package com.omega.platform.rag;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class HybridRagSearchRepositoryTest {

    @Test
    void buildsExactCvePhraseAndStripsAccentedSpanishStopwords() {
        String tsQuery = HybridRagSearchRepository.buildSanitizedOrTsQuery(
                "¿Qué vulnerabilidades como CVE-2021-1048 de 2020 o CVE‑2021‑30860 afectan cuáles kernels de Android?"
        );

        assertThat(tsQuery)
                .contains("(cve <-> 2021 <-> 1048)")
                .contains("(cve <-> -2021 <-> -1048)")
                .contains("(cve <-> 2021 <-> 30860)")
                .contains("(cve <-> -2021 <-> -30860)")
                .contains("vulnerabilidades")
                .contains("kernels")
                .contains("android")
                .doesNotContain("2020")
                .doesNotContain("qué")
                .doesNotContain("cuáles")
                .doesNotContain("| 2021 |");
    }
}
