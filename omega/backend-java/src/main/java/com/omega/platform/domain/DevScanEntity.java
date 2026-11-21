package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "dev_scans", schema = "omega_rag")
public class DevScanEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "triggered_by")
    private UUID triggeredBy;

    @Column(name = "source", nullable = false, length = 24)
    private String source = "UI";

    @Column(name = "rules_version", nullable = false, length = 40)
    private String rulesVersion = "2.0.0";

    @Column(name = "commit_sha", length = 64)
    private String commitSha;

    @Column(name = "branch", length = 120)
    private String branch;

    @Column(name = "score", nullable = false)
    private double score;

    @Column(name = "effective_score", nullable = false)
    private double effectiveScore;

    @Column(name = "has_active_suppressions", nullable = false)
    private boolean hasActiveSuppressions;

    @Column(name = "score_breakdown_json", nullable = false, columnDefinition = "TEXT")
    private String scoreBreakdownJson = "[]";

    @Column(name = "limits_json", nullable = false, columnDefinition = "TEXT")
    private String limitsJson = "{}";

    @Column(name = "findings_count", nullable = false)
    private int findingsCount;

    @Column(name = "dependencies_count", nullable = false)
    private int dependenciesCount;

    @Column(name = "policy_status", nullable = false, length = 24)
    private String policyStatus = "PASS";

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected DevScanEntity() {
    }

    public DevScanEntity(
            UUID tenantId,
            UUID projectId,
            UUID triggeredBy,
            String source,
            String rulesVersion,
            String commitSha,
            String branch,
            double score,
            double effectiveScore,
            boolean hasActiveSuppressions,
            String scoreBreakdownJson,
            String limitsJson,
            int findingsCount,
            int dependenciesCount,
            String policyStatus
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.triggeredBy = triggeredBy;
        this.source = (source == null || source.isBlank()) ? "UI" : source;
        this.rulesVersion = (rulesVersion == null || rulesVersion.isBlank()) ? "2.0.0" : rulesVersion;
        this.commitSha = commitSha;
        this.branch = branch;
        this.score = score;
        this.effectiveScore = effectiveScore;
        this.hasActiveSuppressions = hasActiveSuppressions;
        this.scoreBreakdownJson = scoreBreakdownJson == null ? "[]" : scoreBreakdownJson;
        this.limitsJson = limitsJson == null ? "{}" : limitsJson;
        this.findingsCount = findingsCount;
        this.dependenciesCount = dependenciesCount;
        this.policyStatus = (policyStatus == null || policyStatus.isBlank()) ? "PASS" : policyStatus;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getProjectId() { return projectId; }
    public UUID getTriggeredBy() { return triggeredBy; }
    public String getSource() { return source; }
    public String getRulesVersion() { return rulesVersion; }
    public String getCommitSha() { return commitSha; }
    public String getBranch() { return branch; }
    public double getScore() { return score; }
    public double getEffectiveScore() { return effectiveScore; }
    public void setEffectiveScore(double effectiveScore) { this.effectiveScore = effectiveScore; }
    public boolean isHasActiveSuppressions() { return hasActiveSuppressions; }
    public void setHasActiveSuppressions(boolean hasActiveSuppressions) { this.hasActiveSuppressions = hasActiveSuppressions; }
    public String getScoreBreakdownJson() { return scoreBreakdownJson; }
    public String getLimitsJson() { return limitsJson; }
    public int getFindingsCount() { return findingsCount; }
    public int getDependenciesCount() { return dependenciesCount; }
    public String getPolicyStatus() { return policyStatus; }
    public void setPolicyStatus(String policyStatus) { this.policyStatus = policyStatus; }
    public Instant getCreatedAt() { return createdAt; }
}
