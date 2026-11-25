package com.omega.platform.service;

import com.omega.platform.domain.DevFindingEntity;
import java.util.*;
import java.util.stream.Collectors;

public final class DevScanComparison {
    private DevScanComparison() {}
    public record Change(String fingerprint,String ruleId,String location,String state) {}
    public record Comparison(UUID projectId,UUID latestScanId,UUID previousScanId,int added,int persisting,int notSeen,List<Change> changes,String limitation) {}
    public static Comparison compare(UUID projectId,UUID latestScan,UUID previousScan,List<DevFindingEntity> current,List<DevFindingEntity> previous) {
        var before=previous.stream().collect(Collectors.toMap(DevFindingEntity::getFingerprint,f -> f,(a,b) -> a));
        var after=current.stream().collect(Collectors.toMap(DevFindingEntity::getFingerprint,f -> f,(a,b) -> a));
        var changes=new ArrayList<Change>();int added=0,persisting=0,notSeen=0;
        for(var finding:current) {
            boolean exists=before.containsKey(finding.getFingerprint());
            if(exists) persisting++;else added++;
            changes.add(new Change(finding.getFingerprint(),finding.getRuleId(),finding.getLocation(),previousScan==null?"BASELINE":exists?"PERSISTING":"NEW"));
        }
        for(var finding:previous) if(!after.containsKey(finding.getFingerprint())) {
            notSeen++;changes.add(new Change(finding.getFingerprint(),finding.getRuleId(),finding.getLocation(),"NOT_SEEN_IN_LATEST"));
        }
        return new Comparison(projectId,latestScan,previousScan,added,persisting,notSeen,List.copyOf(changes),
            previousScan==null?"Primera evaluación: no hay una revisión anterior para verificar cambios.":
            "Comparación por huellas de los hallazgos persistidos. Revise reglas, revisión y límites de ambas evaluaciones: una ausencia puede deberse a cambios de cobertura y no acredita corrección.");
    }
}
