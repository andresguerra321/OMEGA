-- Wave 2 Security Audit Hardening (B-07):
-- Track document byte sizes atomically for maxTotalBytesPerCase enforcement
-- across persisted documents and in-flight upload reservations.

ALTER TABLE omega_rag.documents
    ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0);

ALTER TABLE omega_rag.legal_indexing_inflight
    ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0);
