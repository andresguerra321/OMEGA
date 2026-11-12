-- 1. Columna tsvector en document_chunks (diccionario 'simple' preserva CVEs, dominios y procesos sin mutilarlos)
ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Poblar vectores léxicos sobre los fragmentos ya existentes
UPDATE document_chunks
SET search_vector = to_tsvector('simple', COALESCE(content, ''))
WHERE search_vector IS NULL;

-- 3. Índice invertido GIN para consultas exactas en milisegundos (RNF3)
CREATE INDEX IF NOT EXISTS idx_chunks_search_gin
    ON document_chunks
    USING GIN (search_vector);

-- 4. Trigger automático para futuras ingestas
DROP TRIGGER IF EXISTS trg_chunks_search_vector ON document_chunks;
CREATE TRIGGER trg_chunks_search_vector
    BEFORE INSERT OR UPDATE OF content ON document_chunks
    FOR EACH ROW
    EXECUTE FUNCTION tsvector_update_trigger(search_vector, 'pg_catalog.simple', content);

