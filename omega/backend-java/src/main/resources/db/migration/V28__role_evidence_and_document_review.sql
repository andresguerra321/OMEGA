CREATE TABLE omega_rag.personal_analysis_workspaces (
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES omega_rag.users(id) ON DELETE CASCADE,
    expediente_id UUID NOT NULL,
    PRIMARY KEY(tenant_id,user_id),
    FOREIGN KEY(tenant_id,expediente_id) REFERENCES omega_rag.expedientes(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE omega_rag.analysis_evaluations (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL, expediente_id UUID NOT NULL,
    actor_user_id UUID NOT NULL, operation VARCHAR(40) NOT NULL,
    result_json TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY(tenant_id,expediente_id) REFERENCES omega_rag.expedientes(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_analysis_evaluations_case ON omega_rag.analysis_evaluations(tenant_id,expediente_id,created_at DESC);
-- Content-free tombstones prevent status polling from resurrecting deliberately deleted USB results.
CREATE TABLE omega_rag.recorded_analysis_jobs (
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL, source_hash VARCHAR(64) NOT NULL,
    PRIMARY KEY(tenant_id,actor_user_id,source_hash)
);
CREATE FUNCTION omega_rag.invalidate_reports_on_evaluation_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM omega_rag.report_snapshots WHERE tenant_id=OLD.tenant_id AND expediente_id=OLD.expediente_id AND profile='GENERAL';
    RETURN OLD;
END;
$$;
CREATE TRIGGER invalidate_reports_on_evaluation_delete AFTER DELETE ON omega_rag.analysis_evaluations
    FOR EACH ROW EXECUTE FUNCTION omega_rag.invalidate_reports_on_evaluation_delete();

CREATE TABLE omega_rag.legal_document_observations (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL, expediente_id UUID NOT NULL,
    document_id UUID NOT NULL, chunk_id UUID NOT NULL REFERENCES omega_rag.document_chunks(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK(page_number>0), category VARCHAR(40) NOT NULL,
    passage_hash VARCHAR(64) NOT NULL, excerpt TEXT NOT NULL,
    review_status VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(review_status IN ('PENDING_REVIEW','CONFIRMED','REJECTED')),
    review_note VARCHAR(1000) NOT NULL DEFAULT '', reviewed_by UUID, reviewed_at TIMESTAMPTZ,
    revision INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY(tenant_id,expediente_id) REFERENCES omega_rag.expedientes(tenant_id,id) ON DELETE CASCADE,
    FOREIGN KEY(tenant_id,document_id) REFERENCES omega_rag.documents(tenant_id,id) ON DELETE CASCADE,
    UNIQUE(tenant_id,expediente_id,chunk_id,category,passage_hash)
);
CREATE INDEX idx_legal_observations_case ON omega_rag.legal_document_observations(tenant_id,expediente_id,page_number);
