-- V22: Metadatos de almacenamiento de objetos S3-compatible (MinIO) para documentos con retención habilitada.
-- En modo zero-retention (por defecto), estas columnas permanecen NULL.
-- Reversa:
--   DROP INDEX IF EXISTS omega_rag.idx_documents_tenant_storage_key;
--   ALTER TABLE omega_rag.documents
--     DROP COLUMN IF EXISTS retention_until,
--     DROP COLUMN IF EXISTS content_sha256,
--     DROP COLUMN IF EXISTS storage_object_key,
--     DROP COLUMN IF EXISTS storage_bucket;

ALTER TABLE omega_rag.documents
    ADD COLUMN IF NOT EXISTS storage_bucket VARCHAR(64),
    ADD COLUMN IF NOT EXISTS storage_object_key VARCHAR(512),
    ADD COLUMN IF NOT EXISTS content_sha256 VARCHAR(64),
    ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_documents_tenant_storage_key
    ON omega_rag.documents (tenant_id, storage_object_key)
    WHERE storage_object_key IS NOT NULL;
