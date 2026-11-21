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
@Table(name = "dev_dependencies", schema = "omega_rag")
public class DevDependencyEntity {

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

    @Column(name = "ecosystem", nullable = false, length = 32)
    private String ecosystem;

    @Column(name = "package_name", nullable = false, length = 255)
    private String packageName;

    @Column(name = "package_version", nullable = false, length = 120)
    private String packageVersion = "";

    @Column(name = "purl", nullable = false, length = 400)
    private String purl;

    @Column(name = "manifest_path", length = 255)
    private String manifestPath;

    @Column(name = "direct_dependency", nullable = false)
    private boolean directDependency = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected DevDependencyEntity() {
    }

    public DevDependencyEntity(
            UUID tenantId,
            UUID projectId,
            UUID scanId,
            String ecosystem,
            String packageName,
            String packageVersion,
            String purl,
            String manifestPath,
            boolean directDependency
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.scanId = scanId;
        this.ecosystem = ecosystem;
        this.packageName = packageName;
        this.packageVersion = packageVersion == null ? "" : packageVersion;
        this.purl = purl;
        this.manifestPath = manifestPath;
        this.directDependency = directDependency;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getProjectId() { return projectId; }
    public UUID getScanId() { return scanId; }
    public String getEcosystem() { return ecosystem; }
    public String getPackageName() { return packageName; }
    public String getPackageVersion() { return packageVersion; }
    public String getPurl() { return purl; }
    public String getManifestPath() { return manifestPath; }
    public boolean isDirectDependency() { return directDependency; }
    public Instant getCreatedAt() { return createdAt; }
}
