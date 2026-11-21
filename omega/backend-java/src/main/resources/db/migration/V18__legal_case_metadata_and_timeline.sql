-- LEGAL schema; additive and compatible with existing cases and documents.
-- Reverse (metadata/history loss; back up first): DROP TABLE omega_rag.legal_timeline_events;
-- ALTER TABLE omega_rag.expedientes DROP COLUMN description, DROP COLUMN case_reference,
-- DROP COLUMN case_status, DROP COLUMN updated_at;
-- UPDATE omega_rag.documents SET status='FAILED' WHERE status='REJECTED';
-- ALTER TABLE omega_rag.documents DROP CONSTRAINT documents_status_check;
-- ALTER TABLE omega_rag.documents ADD CONSTRAINT documents_status_check
-- CHECK(status IN ('PROCESSING','INDEXED','FAILED','REINDEX_REQUIRED'));
-- ALTER TABLE omega_rag.documents DROP COLUMN failure_code, DROP COLUMN document_format;
ALTER TABLE omega_rag.expedientes
    ADD COLUMN description TEXT NOT NULL DEFAULT '',
    ADD COLUMN case_reference VARCHAR(160) NOT NULL DEFAULT '',
    ADD COLUMN case_status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(case_status IN ('OPEN','CLOSED','ARCHIVED')),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE omega_rag.expedientes SET updated_at = created_at;
ALTER TABLE omega_rag.documents ADD COLUMN failure_code VARCHAR(64),
    ADD COLUMN document_format VARCHAR(12) NOT NULL DEFAULT 'PDF' CHECK(document_format IN ('PDF','DOCX','IMAGE'));
ALTER TABLE omega_rag.documents DROP CONSTRAINT documents_status_check;
ALTER TABLE omega_rag.documents ADD CONSTRAINT documents_status_check
    CHECK(status IN ('PROCESSING','INDEXED','FAILED','REINDEX_REQUIRED','REJECTED'));
CREATE INDEX idx_legal_cases_page ON omega_rag.expedientes(tenant_id, updated_at DESC);
CREATE INDEX idx_legal_case_activity ON omega_rag.audit_logs(tenant_id, resource_id, chain_seq DESC);
CREATE TABLE omega_rag.legal_timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, expediente_id UUID NOT NULL,
    document_id UUID NOT NULL, chunk_id UUID NOT NULL REFERENCES omega_rag.document_chunks(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK(page_number > 0), event_date DATE NOT NULL,
    summary TEXT NOT NULL, review_status VARCHAR(16) NOT NULL DEFAULT 'EXTRACTED'
        CHECK(review_status IN ('EXTRACTED','CONFIRMED','CORRECTED','HIDDEN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY(tenant_id, expediente_id) REFERENCES omega_rag.expedientes(tenant_id,id) ON DELETE CASCADE,
    FOREIGN KEY(tenant_id, document_id) REFERENCES omega_rag.documents(tenant_id,id) ON DELETE CASCADE,
    UNIQUE(tenant_id, expediente_id, chunk_id, event_date)
);
CREATE INDEX idx_legal_timeline_case ON omega_rag.legal_timeline_events(tenant_id, expediente_id, event_date);
