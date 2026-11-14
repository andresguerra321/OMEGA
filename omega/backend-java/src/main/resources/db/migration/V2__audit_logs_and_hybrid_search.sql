-- Fase 4: Búsqueda híbrida (tsvector + HNSW) verificada y tabla inmutable audit_logs con encadenamiento SHA-256

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'omega_rag'
          AND table_name = 'document_chunks'
          AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE omega_rag.document_chunks
            ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('pg_catalog.simple', coalesce(section_title, '')), 'A') ||
                setweight(to_tsvector('pg_catalog.simple', content), 'B')
            ) STORED;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_rag_chunks_search_gin
    ON omega_rag.document_chunks
    USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw
    ON omega_rag.document_chunks
    USING hnsw (embedding public.vector_cosine_ops);

CREATE TABLE IF NOT EXISTS omega_rag.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_seq BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    tenant_id UUID NOT NULL,
    actor_user_id UUID,
    action VARCHAR(80) NOT NULL,
    resource_type VARCHAR(60) NOT NULL,
    resource_id VARCHAR(120),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    previous_hash VARCHAR(64) NOT NULL
        CHECK (char_length(previous_hash) = 64 AND previous_hash ~ '^[0-9a-f]{64}$'),
    current_hash VARCHAR(64) NOT NULL
        CHECK (char_length(current_hash) = 64 AND current_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_audit_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES omega_rag.tenants (id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_seq
    ON omega_rag.audit_logs (tenant_id, chain_seq DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
    ON omega_rag.audit_logs (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION omega_rag.prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'omega_rag.audit_logs es un registro probatorio inmutable (UPDATE/DELETE prohibidos).';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON omega_rag.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON omega_rag.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION omega_rag.prevent_audit_log_mutation();
