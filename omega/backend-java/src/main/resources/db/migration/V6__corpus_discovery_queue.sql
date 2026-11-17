CREATE TABLE IF NOT EXISTS omega_rag.corpus_discovery_queue (
    id UUID PRIMARY KEY,
    source_name VARCHAR(150) NOT NULL,
    title VARCHAR(500) NOT NULL,
    source_url TEXT NOT NULL UNIQUE,
    summary TEXT,
    published_date VARCHAR(64),
    content_hash VARCHAR(64),
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corpus_discovery_status
    ON omega_rag.corpus_discovery_queue (status, discovered_at DESC);
