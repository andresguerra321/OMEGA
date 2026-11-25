CREATE TABLE omega_rag.report_snapshots (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL, profile VARCHAR(16) NOT NULL CHECK(profile IN ('GENERAL','DEVELOPER','LEGAL')),
    expediente_id UUID, project_id UUID, title VARCHAR(255) NOT NULL,
    schema_version VARCHAR(40) NOT NULL, payload_json TEXT NOT NULL, pdf_bytes BYTEA NOT NULL,
    json_sha256 VARCHAR(64) NOT NULL, pdf_sha256 VARCHAR(64) NOT NULL, source_sha256 VARCHAR(64) NOT NULL,
    UNIQUE(tenant_id,actor_user_id,profile,source_sha256),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, expediente_id) REFERENCES omega_rag.expedientes(tenant_id,id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES omega_rag.dev_projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_report_snapshots_tenant ON omega_rag.report_snapshots(tenant_id, created_at DESC);

-- Deleting source material must also remove its derived reports from the operational database.
CREATE FUNCTION omega_rag.invalidate_case_reports_on_document_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM omega_rag.report_snapshots WHERE tenant_id=OLD.tenant_id AND expediente_id=OLD.expediente_id;
    RETURN OLD;
END;
$$;
CREATE TRIGGER invalidate_case_reports_on_document_delete AFTER DELETE ON omega_rag.documents
    FOR EACH ROW EXECUTE FUNCTION omega_rag.invalidate_case_reports_on_document_delete();

CREATE FUNCTION omega_rag.invalidate_aggregate_dev_reports_on_project_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM omega_rag.report_snapshots WHERE tenant_id=OLD.tenant_id AND profile='DEVELOPER' AND project_id IS NULL;
    RETURN OLD;
END;
$$;
CREATE TRIGGER invalidate_aggregate_dev_reports_on_project_delete AFTER DELETE ON omega_rag.dev_projects
    FOR EACH ROW EXECUTE FUNCTION omega_rag.invalidate_aggregate_dev_reports_on_project_delete();

CREATE TABLE omega_rag.transactional_mail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL, event_key VARCHAR(200) NOT NULL UNIQUE,
    subject VARCHAR(200) NOT NULL, body TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ
);
CREATE INDEX idx_transactional_mail_pending ON omega_rag.transactional_mail(status,next_attempt_at);

CREATE TABLE omega_rag.commercial_acceptances (
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, version VARCHAR(40) NOT NULL, accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(tenant_id,user_id,version)
);
CREATE TABLE omega_rag.billing_customer_details (
    tenant_id UUID PRIMARY KEY REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    legal_name VARCHAR(200) NOT NULL, document_type VARCHAR(10) NOT NULL,
    document_number VARCHAR(40) NOT NULL, billing_email VARCHAR(255) NOT NULL,
    address VARCHAR(300) NOT NULL, city VARCHAR(100) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
