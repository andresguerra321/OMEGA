-- =============================================================================
-- OMEGA Core Multi-Tenant Zero-Retention RAG & Forensic Registry Schema
-- Esquema aislado 'omega_rag' para convivir sin colisiones junto al corpus
-- público CTI ('public.*') en PostgreSQL 16 + pgvector.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS omega_rag;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- 1. Tenants (Organizaciones / Despachos / Periodistas aislados)
CREATE TABLE omega_rag.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Usuarios con RBAC estricto y llave compuesta (tenant_id, id) para integridad referencial cross-tenant
CREATE TABLE omega_rag.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'ANALYST', 'CLIENT')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email),
    CONSTRAINT uq_users_tenant_id_pair UNIQUE (tenant_id, id)
);

CREATE INDEX idx_users_tenant_role ON omega_rag.users (tenant_id, role);

-- 3. Expedientes (Cases) aislados por tenant y propietario
CREATE TABLE omega_rag.expedientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    classification VARCHAR(40) NOT NULL DEFAULT 'CONFIDENTIAL'
        CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_expedientes_tenant_id_pair UNIQUE (tenant_id, id),
    CONSTRAINT fk_expedientes_owner_same_tenant
        FOREIGN KEY (tenant_id, owner_user_id)
        REFERENCES omega_rag.users (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_expedientes_tenant_owner ON omega_rag.expedientes (tenant_id, owner_user_id);

-- ACL granular opcional dentro del mismo tenant para compartir un expediente entre ANALYST / CLIENT
CREATE TABLE omega_rag.expediente_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    expediente_id UUID NOT NULL,
    user_id UUID NOT NULL,
    permission VARCHAR(16) NOT NULL CHECK (permission IN ('READ', 'WRITE')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_exp_perm_unique UNIQUE (tenant_id, expediente_id, user_id),
    CONSTRAINT fk_exp_perm_expediente_same_tenant
        FOREIGN KEY (tenant_id, expediente_id)
        REFERENCES omega_rag.expedientes (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_exp_perm_user_same_tenant
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES omega_rag.users (tenant_id, id)
        ON DELETE CASCADE
);

-- 4. Registro de documentos Zero-Retention (NUNCA almacena binarios PDF ni rutas permanentes)
CREATE TABLE omega_rag.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    expediente_id UUID NOT NULL,
    uploaded_by UUID NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL
        CHECK (char_length(sha256_hash) = 64 AND sha256_hash ~ '^[0-9a-f]{64}$'),
    total_pages INTEGER NOT NULL DEFAULT 0 CHECK (total_pages >= 0),
    embedding_model VARCHAR(120) NOT NULL,
    ocr_applied BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING'
        CHECK (status IN ('PROCESSING', 'INDEXED', 'FAILED', 'REINDEX_REQUIRED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temp_deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_documents_tenant_id_pair UNIQUE (tenant_id, id),
    CONSTRAINT fk_documents_expediente_same_tenant
        FOREIGN KEY (tenant_id, expediente_id)
        REFERENCES omega_rag.expedientes (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_documents_uploader_same_tenant
        FOREIGN KEY (tenant_id, uploaded_by)
        REFERENCES omega_rag.users (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_documents_tenant_exp_status
    ON omega_rag.documents (tenant_id, expediente_id, status);
CREATE INDEX idx_documents_sha256
    ON omega_rag.documents (tenant_id, expediente_id, sha256_hash);

-- 5. Fragmentos vectoriales y léxicos (pgvector 1536 dims + tsvector autogenerado)
CREATE TABLE omega_rag.document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_id UUID NOT NULL,
    expediente_id UUID NOT NULL,
    content TEXT NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('pg_catalog.simple', coalesce(section_title, '')), 'A') ||
        setweight(to_tsvector('pg_catalog.simple', content), 'B')
    ) STORED,
    embedding public.vector(1536) NOT NULL,
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    section_title VARCHAR(255),
    chunk_order INTEGER NOT NULL CHECK (chunk_order >= 0),
    token_count INTEGER NOT NULL CHECK (token_count >= 1),
    embedding_model VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunk_doc_order UNIQUE (document_id, chunk_order),
    CONSTRAINT fk_chunks_document_same_tenant
        FOREIGN KEY (tenant_id, document_id)
        REFERENCES omega_rag.documents (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_chunks_expediente_same_tenant
        FOREIGN KEY (tenant_id, expediente_id)
        REFERENCES omega_rag.expedientes (tenant_id, id)
        ON DELETE CASCADE
);

-- Índice HNSW para búsqueda coseno ultrarrápida sobre embeddings de 1536 dimensiones
CREATE INDEX idx_rag_chunks_embedding_hnsw
    ON omega_rag.document_chunks
    USING hnsw (embedding public.vector_cosine_ops);

-- Índice GIN para búsqueda léxica híbrida sobre el tsvector autogenerado
CREATE INDEX idx_rag_chunks_search_gin
    ON omega_rag.document_chunks
    USING GIN (search_vector);

-- Índice compuesto para aislamiento obligatorio por tenant y expediente en consultas RAG
CREATE INDEX idx_rag_chunks_tenant_exp_doc
    ON omega_rag.document_chunks (tenant_id, expediente_id, document_id);
