-- Habilitar extensión vectorial (RF3)
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Campañas de spyware normalizadas (RF2, RF6)
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    spyware_family VARCHAR(100) NOT NULL, -- Ej: Pegasus, Predator, Candiru
    suspected_actor VARCHAR(255),
    target_sector VARCHAR(255),           -- Ej: Periodistas, Sociedad Civil, Gobierno
    target_regions TEXT[],
    first_seen_date DATE,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Reportes técnicos ingeridos y auditoría de fuentes (RF1, RF7, RNF5)
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    organization VARCHAR(150) NOT NULL,   -- Citizen Lab, Amnesty Tech, Google TAG
    publication_date DATE,
    source_url TEXT NOT NULL,
    local_filename VARCHAR(255) NOT NULL,
    -- Hash SHA-256 del PDF para ingesta incremental sin duplicados (RNF5)
    file_hash VARCHAR(64) NOT NULL UNIQUE,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Vulnerabilidades (CVEs) asociadas a reportes y campañas (RF1, RF2, RF6)
CREATE TABLE cves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cve_code VARCHAR(30) NOT NULL UNIQUE, -- Ej: CVE-2021-30860
    description TEXT,
    cvss_score NUMERIC(3,1)
);

CREATE TABLE campaign_cves (
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    cve_id UUID NOT NULL REFERENCES cves(id) ON DELETE CASCADE,
    report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
    PRIMARY KEY (campaign_id, cve_id)
);

-- 4. Base de Indicadores de Compromiso (IOCs) para cruce con MVT (RF5, RF6, RNF3)
CREATE TABLE iocs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    ioc_type VARCHAR(50) NOT NULL,        -- domain, ip, sha256, process, package, email
    ioc_value TEXT NOT NULL,
    context TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ioc_type, ioc_value, report_id)
);

-- Índice B-Tree para cruces rápidos contra dumps de MVT en memoria (RNF3, RNF4)
CREATE INDEX idx_iocs_value ON iocs (ioc_value);
CREATE INDEX idx_iocs_type_value ON iocs (ioc_type, ioc_value);

-- 5. Fragmentos vectoriales para RAG con trazabilidad estricta (RF3, RF4, RNF1)
-- Nota: vector(768) funciona directo con nomic-embed-text (Ollama) o text-embedding-004 (Gemini).
-- Si usas OpenAI text-embedding-3-small, cambia 768 por 1536.
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    page_number INTEGER NOT NULL,         -- Obligatorio para citas verificables (RNF1)
    section_title VARCHAR(255),
    content TEXT NOT NULL,
    embedding vector(768) NOT NULL,
    search_vector tsvector,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (report_id, chunk_index)
);

-- Índice HNSW para búsqueda por similitud coseno en milisegundos (RNF3)
CREATE INDEX idx_chunks_embedding_hnsw
    ON document_chunks
    USING hnsw (embedding vector_cosine_ops);

-- Índice GIN y Trigger para búsqueda léxica exacta (Búsqueda Híbrida RRF)
CREATE INDEX idx_chunks_search_gin
    ON document_chunks
    USING GIN (search_vector);

CREATE TRIGGER trg_chunks_search_vector
    BEFORE INSERT OR UPDATE OF content ON document_chunks
    FOR EACH ROW
    EXECUTE FUNCTION tsvector_update_trigger(search_vector, 'pg_catalog.simple', content);

-- 6. Activos propios para monitoreo OSINT defensivo (RF8, RNF8)
-- El constraint CHECK impide a nivel de BD registrar activos sin consentimiento explícito
CREATE TABLE osint_monitored_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_type VARCHAR(50) NOT NULL,      -- domain, institutional_email, organization
    asset_value VARCHAR(255) NOT NULL UNIQUE,
    explicit_consent BOOLEAN NOT NULL CHECK (explicit_consent = TRUE),
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ
);

