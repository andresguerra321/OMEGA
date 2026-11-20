package com.omega.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "github_app_installations", schema = "omega_rag")
public class GitHubAppInstallationEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, unique = true)
    private UUID tenantId;

    @Column(name = "installation_id", nullable = false, unique = true)
    private long installationId;

    @Column(name = "account_login", nullable = false, length = 120)
    private String accountLogin = "";

    @Column(name = "selected_repos_json", nullable = false, columnDefinition = "TEXT")
    private String selectedReposJson = "[]";

    @Column(name = "suspended_at")
    private Instant suspendedAt;

    @Column(name = "created_by_user_id", nullable = false)
    private UUID createdByUserId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected GitHubAppInstallationEntity() {
    }

    public GitHubAppInstallationEntity(
            UUID id,
            UUID tenantId,
            long installationId,
            String accountLogin,
            String selectedReposJson,
            UUID createdByUserId,
            Instant now
    ) {
        this.id = id;
        this.tenantId = tenantId;
        this.installationId = installationId;
        this.accountLogin = accountLogin != null ? accountLogin : "";
        this.selectedReposJson = selectedReposJson != null ? selectedReposJson : "[]";
        this.createdByUserId = createdByUserId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public long getInstallationId() {
        return installationId;
    }

    public String getAccountLogin() {
        return accountLogin;
    }

    public void setAccountLogin(String accountLogin) {
        this.accountLogin = accountLogin != null ? accountLogin : "";
    }

    public String getSelectedReposJson() {
        return selectedReposJson;
    }

    public void setSelectedReposJson(String selectedReposJson) {
        this.selectedReposJson = selectedReposJson != null ? selectedReposJson : "[]";
    }

    public Instant getSuspendedAt() {
        return suspendedAt;
    }

    public void setSuspendedAt(Instant suspendedAt) {
        this.suspendedAt = suspendedAt;
    }

    public UUID getCreatedByUserId() {
        return createdByUserId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
