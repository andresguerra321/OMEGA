package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "expedientes", schema = "omega_rag")
public class ExpedienteEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "owner_user_id", nullable = false, updatable = false)
    private UUID ownerUserId;

    @Column(name = "title", nullable = false, length = 255)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(name = "classification", nullable = false, length = 40)
    private ClassificationLevel classification = ClassificationLevel.CONFIDENTIAL;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "description", nullable = false, columnDefinition = "TEXT")
    private String description = "";
    @Column(name = "case_reference", nullable = false, length = 160)
    private String caseReference = "";
    @Enumerated(EnumType.STRING)
    @Column(name = "case_status", nullable = false, length = 20)
    private ExpedienteStatus status = ExpedienteStatus.OPEN;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @Column(name = "client_name", length = 200)
    private String clientName;
    @Column(name = "counterparty_name", length = 200)
    private String counterpartyName;
    @Column(name = "court_name", length = 200)
    private String courtName;
    @Column(name = "process_type", length = 20)
    private String processType;
    @Column(name = "case_stage", length = 60)
    private String caseStage;

    public String getDescription() { return description; }
    public void setDescription(String value) { description = value; }
    public String getCaseReference() { return caseReference; }
    public void setCaseReference(String value) { caseReference = value; }
    public ExpedienteStatus getStatus() { return status; }
    public void setStatus(ExpedienteStatus value) { status = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public String getClientName() { return clientName; }
    public void setClientName(String value) { clientName = value; }
    public String getCounterpartyName() { return counterpartyName; }
    public void setCounterpartyName(String value) { counterpartyName = value; }
    public String getCourtName() { return courtName; }
    public void setCourtName(String value) { courtName = value; }
    public String getProcessType() { return processType; }
    public void setProcessType(String value) { processType = value; }
    public String getCaseStage() { return caseStage; }
    public void setCaseStage(String value) { caseStage = value; }
    @jakarta.persistence.PreUpdate
    void markUpdated() { updatedAt = Instant.now(); }

    protected ExpedienteEntity() {
    }

    public ExpedienteEntity(UUID tenantId, UUID ownerUserId, String title, ClassificationLevel classification) {
        this.tenantId = tenantId;
        this.ownerUserId = ownerUserId;
        this.title = title;
        this.classification = classification == null ? ClassificationLevel.CONFIDENTIAL : classification;
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getOwnerUserId() {
        return ownerUserId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public ClassificationLevel getClassification() {
        return classification;
    }

    public void setClassification(ClassificationLevel classification) {
        this.classification = classification;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
