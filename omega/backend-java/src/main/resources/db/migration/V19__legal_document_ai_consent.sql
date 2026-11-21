-- LEGAL consent to the actual document AI configuration, never API keys or document content.
-- Reverse (consent loss; uploads will require renewed acceptance):
-- DROP TABLE omega_rag.legal_document_ai_consents;
CREATE TABLE omega_rag.legal_document_ai_consents (
    tenant_id UUID PRIMARY KEY REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    policy_hash VARCHAR(64) NOT NULL CHECK(policy_hash ~ '^[0-9a-f]{64}$'),
    disclosure_json TEXT NOT NULL,
    accepted_by UUID NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY(tenant_id,accepted_by) REFERENCES omega_rag.users(tenant_id,id) ON DELETE RESTRICT
);
