-- Fase 5: Catálogo estructurado STIX 2.1 gestionado en Java y consultable en solo lectura por el worker forense

CREATE TABLE IF NOT EXISTS omega_rag.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_stix_id VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    spyware_family VARCHAR(120) NOT NULL DEFAULT 'Unknown',
    suspected_actor VARCHAR(255),
    description TEXT,
    source_feed VARCHAR(255),
    first_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS omega_rag.ioc_indicators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES omega_rag.campaigns (id) ON DELETE SET NULL,
    external_stix_id VARCHAR(255),
    ioc_type VARCHAR(40) NOT NULL,
    ioc_value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    stix_pattern TEXT,
    context TEXT,
    source_report VARCHAR(255),
    organization VARCHAR(160),
    source_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rag_ioc_type_normalized UNIQUE (ioc_type, normalized_value)
);

CREATE INDEX IF NOT EXISTS idx_rag_ioc_normalized
    ON omega_rag.ioc_indicators (normalized_value);

CREATE INDEX IF NOT EXISTS idx_rag_ioc_campaign
    ON omega_rag.ioc_indicators (campaign_id);
