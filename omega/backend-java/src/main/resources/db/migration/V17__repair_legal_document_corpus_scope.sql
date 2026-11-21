-- Repair documents ingested with the GENERAL default in LEGAL tenants.
-- No binary retention, content reindexing, or changes to other tenants.
-- Reverse before changing tenant profiles (retags all current LEGAL rows):
-- UPDATE omega_rag.documents d SET corpus_scope = 'GENERAL' FROM omega_rag.tenants t
-- WHERE d.tenant_id = t.id AND t.profile = 'LEGAL' AND d.corpus_scope = 'LEGAL';
UPDATE omega_rag.documents AS d
SET corpus_scope = 'LEGAL'
FROM omega_rag.tenants AS t
WHERE d.tenant_id = t.id
  AND t.profile = 'LEGAL'
  AND d.corpus_scope = 'GENERAL';
