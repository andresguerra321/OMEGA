-- =============================================================================
-- V12: Etiqueta de alcance del corpus RAG/CTI por perfil (GENERAL, LEGAL, DEVELOPER)
-- Compatible con datos existentes: lo ya indexado permanece en 'GENERAL'.
-- Reversible por diseño:
--   ALTER TABLE omega_rag.documents DROP CONSTRAINT IF EXISTS chk_documents_corpus_scope;
--   ALTER TABLE omega_rag.documents DROP COLUMN IF EXISTS corpus_scope;
--   ALTER TABLE omega_rag.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_corpus_scope;
--   ALTER TABLE omega_rag.campaigns DROP COLUMN IF EXISTS corpus_scope;
-- =============================================================================

ALTER TABLE omega_rag.documents
    ADD COLUMN IF NOT EXISTS corpus_scope VARCHAR(32) NOT NULL DEFAULT 'GENERAL';

ALTER TABLE omega_rag.documents
    DROP CONSTRAINT IF EXISTS chk_documents_corpus_scope;

ALTER TABLE omega_rag.documents
    ADD CONSTRAINT chk_documents_corpus_scope CHECK (corpus_scope IN ('GENERAL', 'LEGAL', 'DEVELOPER'));

ALTER TABLE omega_rag.campaigns
    ADD COLUMN IF NOT EXISTS corpus_scope VARCHAR(32) NOT NULL DEFAULT 'GENERAL';

ALTER TABLE omega_rag.campaigns
    DROP CONSTRAINT IF EXISTS chk_campaigns_corpus_scope;

ALTER TABLE omega_rag.campaigns
    ADD CONSTRAINT chk_campaigns_corpus_scope CHECK (corpus_scope IN ('GENERAL', 'LEGAL', 'DEVELOPER'));
