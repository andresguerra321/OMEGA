-- =============================================================================
-- V20: Modelo de datos del perfil DEVELOPER (Proyectos, Escaneos, Hallazgos,
--      Supresiones, Inventario de Dependencias, Políticas y Suscripciones).
-- Zero-Retention del código: solo se persisten metadatos derivados, nunca
-- código fuente ni valores de secretos. Borrar un proyecto elimina en cascada
-- todo lo derivado.
--
-- Reversa documentada (ejecutar en orden):
--   DROP TABLE IF EXISTS omega_rag.dev_monitor_subscriptions;
--   DROP TABLE IF EXISTS omega_rag.dev_policies;
--   DROP TABLE IF EXISTS omega_rag.dev_dependencies;
--   DROP TABLE IF EXISTS omega_rag.dev_suppressions;
--   DROP TABLE IF EXISTS omega_rag.dev_finding_comments;
--   DROP TABLE IF EXISTS omega_rag.dev_findings;
--   DROP TABLE IF EXISTS omega_rag.dev_scans;
--   DROP TABLE IF EXISTS omega_rag.dev_projects;
-- =============================================================================

-- Backfill compatible: asegurar corpus_scope = DEVELOPER en documentos de tenants DEVELOPER
UPDATE omega_rag.documents d
SET corpus_scope = 'DEVELOPER'
FROM omega_rag.tenants t
WHERE d.tenant_id = t.id
  AND t.profile = 'DEVELOPER'
  AND d.corpus_scope = 'GENERAL';

CREATE TABLE IF NOT EXISTS omega_rag.dev_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    created_by UUID NOT NULL,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    repo_url VARCHAR(500),
    default_branch VARCHAR(120),
    source_type VARCHAR(24) NOT NULL DEFAULT 'ARCHIVE'
        CHECK (source_type IN ('ARCHIVE', 'GITHUB_URL', 'GITHUB_APP', 'CLI')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_dev_projects_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_dev_projects_tenant_slug UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_dev_projects_tenant_updated
    ON omega_rag.dev_projects (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS omega_rag.dev_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    triggered_by UUID,
    source VARCHAR(24) NOT NULL DEFAULT 'UI'
        CHECK (source IN ('UI', 'CLI', 'GITHUB_ACTION', 'GITHUB_APP', 'URL')),
    rules_version VARCHAR(40) NOT NULL DEFAULT '2.0.0',
    commit_sha VARCHAR(64),
    branch VARCHAR(120),
    score DOUBLE PRECISION NOT NULL DEFAULT 0,
    effective_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    has_active_suppressions BOOLEAN NOT NULL DEFAULT FALSE,
    score_breakdown_json TEXT NOT NULL DEFAULT '[]',
    limits_json TEXT NOT NULL DEFAULT '{}',
    findings_count INTEGER NOT NULL DEFAULT 0,
    dependencies_count INTEGER NOT NULL DEFAULT 0,
    policy_status VARCHAR(24) NOT NULL DEFAULT 'PASS'
        CHECK (policy_status IN ('PASS', 'WARN', 'FAIL')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_dev_scans_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_dev_scans_project_same_tenant
        FOREIGN KEY (tenant_id, project_id)
        REFERENCES omega_rag.dev_projects (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dev_scans_tenant_project_created
    ON omega_rag.dev_scans (tenant_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS omega_rag.dev_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    scan_id UUID NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    rule_id VARCHAR(80) NOT NULL,
    detector VARCHAR(64) NOT NULL DEFAULT 'static',
    severity VARCHAR(16) NOT NULL
        CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
    title VARCHAR(255) NOT NULL,
    location VARCHAR(300),
    explanation TEXT NOT NULL,
    score_points DOUBLE PRECISION NOT NULL DEFAULT 0,
    triage_status VARCHAR(24) NOT NULL DEFAULT 'NEW'
        CHECK (triage_status IN ('NEW', 'CONFIRMED', 'FALSE_POSITIVE', 'ACCEPTED', 'RESOLVED')),
    triage_updated_by UUID,
    triage_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_dev_findings_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_dev_findings_project_same_tenant
        FOREIGN KEY (tenant_id, project_id)
        REFERENCES omega_rag.dev_projects (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_dev_findings_scan_same_tenant
        FOREIGN KEY (tenant_id, scan_id)
        REFERENCES omega_rag.dev_scans (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dev_findings_tenant_project_status
    ON omega_rag.dev_findings (tenant_id, project_id, triage_status, severity);
CREATE INDEX IF NOT EXISTS idx_dev_findings_scan
    ON omega_rag.dev_findings (tenant_id, scan_id);
CREATE INDEX IF NOT EXISTS idx_dev_findings_fingerprint
    ON omega_rag.dev_findings (tenant_id, project_id, fingerprint);

CREATE TABLE IF NOT EXISTS omega_rag.dev_finding_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    finding_id UUID NOT NULL,
    author_user_id UUID NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_dev_comments_finding_same_tenant
        FOREIGN KEY (tenant_id, finding_id)
        REFERENCES omega_rag.dev_findings (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dev_comments_finding
    ON omega_rag.dev_finding_comments (tenant_id, finding_id, created_at ASC);

CREATE TABLE IF NOT EXISTS omega_rag.dev_suppressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    rule_id VARCHAR(80) NOT NULL,
    fingerprint VARCHAR(64),
    reason VARCHAR(400) NOT NULL,
    created_by UUID NOT NULL,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_dev_suppressions_project_same_tenant
        FOREIGN KEY (tenant_id, project_id)
        REFERENCES omega_rag.dev_projects (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dev_suppressions_tenant_project
    ON omega_rag.dev_suppressions (tenant_id, project_id, rule_id);

CREATE TABLE IF NOT EXISTS omega_rag.dev_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    scan_id UUID NOT NULL,
    ecosystem VARCHAR(32) NOT NULL,
    package_name VARCHAR(255) NOT NULL,
    package_version VARCHAR(120) NOT NULL DEFAULT '',
    purl VARCHAR(400) NOT NULL,
    manifest_path VARCHAR(255),
    direct_dependency BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_dev_deps_project_same_tenant
        FOREIGN KEY (tenant_id, project_id)
        REFERENCES omega_rag.dev_projects (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_dev_deps_scan_same_tenant
        FOREIGN KEY (tenant_id, scan_id)
        REFERENCES omega_rag.dev_scans (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dev_deps_tenant_project_scan
    ON omega_rag.dev_dependencies (tenant_id, project_id, scan_id);
CREATE INDEX IF NOT EXISTS idx_dev_deps_purl
    ON omega_rag.dev_dependencies (tenant_id, ecosystem, package_name);

CREATE TABLE IF NOT EXISTS omega_rag.dev_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    project_id UUID,
    fail_on_severity VARCHAR(16) NOT NULL DEFAULT 'HIGH'
        CHECK (fail_on_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE')),
    action_on_violation VARCHAR(24) NOT NULL DEFAULT 'FAIL_PIPELINE'
        CHECK (action_on_violation IN ('MARK_ONLY', 'FAIL_PIPELINE', 'COMMENT_PR')),
    allowed_packages_json TEXT NOT NULL DEFAULT '[]',
    blocked_packages_json TEXT NOT NULL DEFAULT '[]',
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_dev_policies_project_same_tenant
        FOREIGN KEY (tenant_id, project_id)
        REFERENCES omega_rag.dev_projects (tenant_id, id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_policies_tenant_default
    ON omega_rag.dev_policies (tenant_id)
    WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_policies_tenant_project
    ON omega_rag.dev_policies (tenant_id, project_id)
    WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS omega_rag.dev_monitor_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    channel VARCHAR(24) NOT NULL DEFAULT 'WEBHOOK'
        CHECK (channel IN ('WEBHOOK', 'TELEGRAM', 'EMAIL')),
    min_severity VARCHAR(16) NOT NULL DEFAULT 'HIGH'
        CHECK (min_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    last_evaluated_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_dev_monitor_tenant_project_channel UNIQUE (tenant_id, project_id, channel),
    CONSTRAINT fk_dev_monitor_project_same_tenant
        FOREIGN KEY (tenant_id, project_id)
        REFERENCES omega_rag.dev_projects (tenant_id, id)
        ON DELETE CASCADE
);
