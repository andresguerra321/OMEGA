-- Disable the synthetic operator from older releases, preserving its documents and tenant.
-- These historical identifiers are cleanup criteria, never login credentials or seeded data.
UPDATE omega_rag.users
SET active = FALSE
WHERE LOWER(email) = 'operador@omega.local'
  AND tenant_id IN (SELECT id FROM omega_rag.tenants WHERE slug = 'espacio-local');
