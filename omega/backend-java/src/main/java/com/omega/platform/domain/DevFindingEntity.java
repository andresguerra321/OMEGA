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
@Table(name = "dev_findings", schema = "omega_rag")
public class DevFindingEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "scan_id", nullable = false, updatable = false)
    private UUID scanId;

    @Column(name = "fingerprint", nullable = false, length = 64)
    private String fingerprint;

    @Column(name = "rule_id", nullable = false, length = 80)
    private String ruleId;

    @Column(name = "detector", nullable = false, length = 64)
    private String detector = "static";

    @Column(name = "severity", nullable = false, length = 16)
    private String severity;

    @Column(name = "title", nullable = false, length = 255)
    private String title;

    @Column(name = "location", length = 300)
    private String location;

    @Column(name = "explanation", nullable = false, columnDefinition = "TEXT")
    private String explanation;

    @Column(name = "score_points", nullable = false)
    private double scorePoints;

    @Column(name = "triage_status", nullable = false, length = 24)
    private String triageStatus = "NEW";

    @Column(name = "triage_updated_by")
    private UUID triageUpdatedBy;

    @Column(name = "triage_updated_at")
    private Instant triageUpdatedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected DevFindingEntity() {
    }

    public DevFindingEntity(
            UUID tenantId,
            UUID projectId,
            UUID scanId,
            String fingerprint,
            String ruleId,
            String detector,
            String severity,
            String title,
            String location,
            String explanation,
            double scorePoints
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.scanId = scanId;
        this.fingerprint = fingerprint;
        this.ruleId = ruleId;
        this.detector = (detector == null || detector.isBlank()) ? "static" : detector;
        this.severity = severity;
        this.title = title;
        this.location = location;
        this.explanation = explanation == null ? "" : explanation;
        this.scorePoints = scorePoints;
        this.triageStatus = "NEW";
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getProjectId() { return projectId; }
    public UUID getScanId() { return scanId; }
    public String getFingerprint() { return fingerprint; }
    public String getRuleId() { return ruleId; }
    public String getDetector() { return detector; }
    public String getSeverity() { return severity; }
    public String getTitle() { return title; }
    public String getLocation() { return location; }
    public String getExplanation() { return explanation; }
    public double getScorePoints() { return scorePoints; }
    public String getTriageStatus() { return triageStatus; }
    public void setTriageStatus(String triageStatus, UUID updatedBy) {
        this.triageStatus = triageStatus;
        this.triageUpdatedBy = updatedBy;
        this.triageUpdatedAt = Instant.now();
    }
    public UUID getTriageUpdatedBy() { return triageUpdatedBy; }
    public Instant getTriageUpdatedAt() { return triageUpdatedAt; }
    public Instant getCreatedAt() { return createdAt; }
}
