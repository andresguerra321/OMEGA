package com.omega.platform.service;

import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.DevFindingEntity;
import java.util.*;
import org.junit.jupiter.api.Test;

class RoleEvidenceQualityTest {
    @Test void savedEvidenceRejectsRawSnapshotsAndMasksCredentialsAndQueryStrings() {
        String token="ghp_"+"a".repeat(36);
        var input=new ObjectMapper().valueToTree(Map.of("password","PRIVATE_PASSWORD","processes",List.of(Map.of("command","PRIVATE_COMMAND")),
            "diagnosis",Map.of("rationale","URL https://example.invalid/?secret=PRIVATE_QUERY token "+token),"total_matches",2));
        String saved=AnalysisEvidenceService.sanitize(input).toString();
        assertThat(saved).contains("total_matches").doesNotContain("PRIVATE_PASSWORD","PRIVATE_COMMAND","PRIVATE_QUERY",token);
    }
    @Test void everyRetentionLimitIsReportedInsteadOfSilentlyLosingFindings() {
        var input=new ObjectMapper().valueToTree(Map.of("findings",Collections.nCopies(300,Map.of("description","observación"))));
        var saved=AnalysisEvidenceService.sanitize(input);
        assertThat(saved.path("truncated").asBoolean()).isTrue();
        assertThat(saved.path("observations").path("findings").size()).isEqualTo(250);
    }
    @Test void manualResolvedStatusDoesNotMakeAPersistingFindingDisappearFromComparison() {
        var oldA=finding("a","NEW");var oldB=finding("b","NEW");
        var nowB=finding("b","RESOLVED");var nowC=finding("c","NEW");
        var result=DevScanComparison.compare(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),List.of(nowB,nowC),List.of(oldA,oldB));
        assertThat(result.added()).isEqualTo(1);assertThat(result.persisting()).isEqualTo(1);assertThat(result.notSeen()).isEqualTo(1);
        assertThat(result.changes()).extracting(DevScanComparison.Change::state).containsExactly("PERSISTING","NEW","NOT_SEEN_IN_LATEST");
        assertThat(result.limitation()).contains("no acredita corrección");
    }
    @Test void remediationIsSpecificToRuleAndLocationWithoutInventingASafeVersion() {
        var guide=DevRemediationGuide.forFinding("NPM-POSTINSTALL-EXEC-01","package.json:scripts.postinstall");
        assertThat(String.join(" ",guide.steps())).contains("hook","package.json:scripts.postinstall");
        assertThat(String.join(" ",DevRemediationGuide.forFinding("PKG-MALICIOUS-ADVISORY-01","package.json").steps())).contains("no se inventa una versión segura");
    }
    @Test void scannerBreakdownIsUsedWhenIndividualFindingsDoNotRepeatTheirScore() {
        var finding=Map.<String,Object>of("rule_id","NPM-POSTINSTALL-EXEC-01","location","package.json:scripts.postinstall");
        var breakdown=List.of(Map.<String,Object>of("rule_id","NPM-POSTINSTALL-EXEC-01","location","package.json:scripts.postinstall","points",35));
        assertThat(DevProjectService.findingPoints(finding,breakdown)).isEqualTo(35);
        assertThat(DevProjectService.findingPoints(Map.of("score",Double.NaN),List.of())).isZero();
    }
    private DevFindingEntity finding(String fingerprint,String state) {
        var finding=new DevFindingEntity(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),fingerprint.repeat(64),"RULE-01","static","HIGH","Hallazgo","src/a.js","Observación",10);
        finding.setTriageStatus(state,UUID.randomUUID());return finding;
    }
}
