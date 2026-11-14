# OMEGA Core Backend (`omega/backend-java`)

Núcleo transaccional, seguridad multi-tenant, ingesta **Zero-Retention** con OCR asíncrono, trazabilidad probatoria inmutable con encadenamiento SHA-256, ingestor nativo STIX 2.1, puente forense autenticado y motor RAG híbrido de OMEGA, construido con **Java 21** y **Spring Boot 3.3.5**.

---

## 1. Stack y Dependencias (`pom.xml`)

* **Java 21** + **Spring Boot 3.3.5** (`web`, `security`, `data-jpa`, `validation`, `actuator`)
* **PostgreSQL 16 + pgvector + Flyway** (`hibernate-vector`, `flyway-core`, `flyway-database-postgresql`)
* **JWT stateless (RFC 7519):** `io.jsonwebtoken:jjwt` `0.12.6` (firma `HS256`)
* **Procesamiento PDF / OCR Zero-Retention:** Apache PDFBox `3.0.3` + Tess4J `5.13.0` (`tesseract-ocr` `eng`/`spa` con `TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata` en contenedor runtime)
* **Testing:** `spring-boot-starter-test`, `spring-security-test`, `Testcontainers` (`pgvector/pgvector:pg16`), Apache PDFBox en RAM

---

## 2. Arquitectura de Paquetes

```text
src/main/java/com/omega/platform/
├── OmegaBackendApplication.java
├── config/
│   ├── AsyncExecutorConfig.java              # Pool acotado omegaIngestExecutor (core=2, max=6, queue=32)
│   ├── OmegaProperties.java                  # Configuración @Validated (security, ingest, rag, forensicWorker, cti)
│   └── RestClientConfig.java                 # Clientes HTTP hacia OpenAI API y worker interno (X-Internal-Service-Token)
├── domain/                                   # Entidades JPA sobre esquema omega_rag
│   ├── TenantEntity, UserEntity, ExpedienteEntity, ExpedientePermissionEntity
│   ├── DocumentEntity, DocumentChunkEntity, AuditLogEntity
│   ├── CampaignEntity, IocIndicatorEntity
│   └── ClassificationLevel, DocumentStatus, ExpedientePermissionLevel
├── repository/                               # Consultas acotadas por tenant_id y catálogo CTI
├── security/
│   ├── Role.java                             # ADMIN, ANALYST, CLIENT
│   ├── OmegaPrincipal / TenantContext / TenantScope
│   ├── JwtService / JwtAuthenticationFilter / SecurityConfig
│   ├── ExpedienteAuthorizationService        # Verificación anti-IDOR por tenant y expediente
│   └── JsonSecurityHandlers                  # Respuestas 401/403 uniformes en ProblemDetail JSON
├── service/
│   ├── AuthService.java                      # Registro de tenant, login JWT y creación de usuarios (ADMIN)
│   ├── ExpedienteService.java                # CRUD de expedientes accesibles y concesión de permisos ACL
│   └── AuditLogService.java                  # Registro probatorio inmutable con bloqueo advisory y cadena SHA-256
├── ingest/
│   ├── PdfSecuritySanitizer.java             # Escaneo AST PDFBox (bloquea /JavaScript, /Launch, /AA, /OpenAction)
│   ├── Tess4jOcrExtractor.java               # Fallback OCR en RAM vía libtesseract (OcrExtractor)
│   ├── PdfChunkExtractor.java                # Extracción página a página + chunking 500–1000 tokens con solapamiento
│   ├── AsyncDocumentProcessor.java           # @Async con limpieza física garantizada en finally (temp_deleted_at)
│   └── DocumentIngestionService.java         # Validación de frontera (%PDF-, tamaño, SHA-256 en streaming)
├── rag/
│   ├── EmbeddingProvider.java                # Interfaz desacoplada (1536 dims)
│   ├── OpenAiEmbeddingProvider.java          # Cliente RestClient hacia OpenAI con batching y reintentos
│   ├── OpenAiRagAnswerGenerator.java         # Síntesis grounded con formato de citas obligatorio
│   ├── HybridRagSearchRepository.java        # CTE PostgreSQL: pgvector (<=>) + GIN tsvector combinados por RRF
│   └── HybridRagQueryService.java            # Búsqueda por tenant+expediente y detección de drift (REINDEX_REQUIRED)
├── cti/
│   └── StixCatalogService.java               # Parser STIX 2.1 (Jackson) -> omega_rag.campaigns / ioc_indicators
├── integration/forensic/
│   ├── ForensicWorkerContracts.java          # Contratos DTO 1:1 con omega/api/
│   ├── ArchiveSecurityValidator.java         # Guardia anti-Zip-Slip y anti-Bomba-de-Descompresión
│   └── ForensicBridgeService.java            # Puente autenticado hacia http://forensic-worker:8000 con auditoría
└── web/
    ├── AuthController.java                   # /api/v1/auth/*
    ├── ExpedienteController.java             # /api/v1/expedientes/*
    ├── DocumentController.java               # /api/v1/expedientes/{expedienteId}/documents/*
    ├── RagQueryController.java               # /api/v1/expedientes/{expedienteId}/query
    ├── ForensicController.java               # /api/v1/forensics/*
    ├── CtiCatalogController.java             # /api/v1/cti/*
    ├── AuditController.java                  # /api/v1/audit-logs/*
    └── GlobalExceptionHandler.java
```

---

## 3. Migraciones Flyway (`omega_rag`)

1. **`V1__init_omega_rag_schema.sql`**: crea `tenants`, `users`, `expedientes`, `expediente_permissions`, `documents` y `document_chunks` (`vector(1536)` con índice **HNSW**, `search_vector tsvector GENERATED ALWAYS` con índice **GIN** y FKs compuestas `(tenant_id, id)`).
2. **`V2__audit_logs_and_hybrid_search.sql`**: verifica idempotencia de `search_vector`/GIN/HNSW y crea `omega_rag.audit_logs` con secuencia monotónica por tenant y trigger `prevent_audit_log_mutation()` que bloquea `UPDATE` y `DELETE`.
3. **`V3__stix_ioc_catalog.sql`**: crea `omega_rag.campaigns` y `omega_rag.ioc_indicators` con índice único `(ioc_type, normalized_value)` compartido en solo lectura con el worker forense.

---

## 4. Endpoints Implementados

* **Salud:** `GET /actuator/health` (público, `show-details: never`)
* **Autenticación y Tenants (`/api/v1/auth`):**
  * `POST /api/v1/auth/tenants/register`
  * `POST /api/v1/auth/login`
  * `POST /api/v1/auth/users` (`ADMIN`)
  * `GET /api/v1/auth/me`
* **Expedientes (`/api/v1/expedientes`):**
  * `GET /api/v1/expedientes`, `POST /api/v1/expedientes`, `GET /api/v1/expedientes/{expedienteId}`, `POST /api/v1/expedientes/{expedienteId}/permissions`
* **Ingesta Zero-Retention y RAG Híbrido:**
  * `POST /api/v1/expedientes/{expedienteId}/documents` (`202 Accepted`, validación `%PDF-`, PDFBox security scan, SHA-256 streaming, procesamiento `@Async` sobre `tmpfs` y borrado garantizado)
  * `GET /api/v1/expedientes/{expedienteId}/documents` y `GET .../documents/{documentId}`
  * `POST /api/v1/expedientes/{expedienteId}/query` (RRF `vector + tsvector`, detección `REINDEX_REQUIRED`, citas `[Documento: ... | Pág. ... | Sección: ...]`)
* **Puente Forense, Catálogo CTI y Auditoría:**
  * `POST /api/v1/forensics/triage`, `POST /api/v1/forensics/link/verify`, `POST /api/v1/forensics/yara/scan`, `GET /api/v1/forensics/yara/campaigns/{campaignId}`
  * `POST /api/v1/cti/stix/sync` (`ADMIN`), `GET /api/v1/cti/campaigns`, `GET /api/v1/cti/indicators/lookup`
  * `GET /api/v1/audit-logs`, `GET /api/v1/audit-logs/verify` (`ADMIN`)

---

## 5. Seguridad, Configuración y Pruebas

Variables clave definidas en [`omega/.env.example`](../.env.example):

* `OMEGA_JWT_SECRET`: clave HMAC-SHA256 de al menos **32 caracteres**. Con perfil `prod` activo, el arranque falla intencionalmente si se mantiene el valor por defecto de desarrollo.
* `INTERNAL_SERVICE_TOKEN`: token secreto compartido en cabecera `X-Internal-Service-Token` para autenticar todas las llamadas entre `backend-java` y `forensic-worker`.
* `OPENAI_API_KEY` / `OMEGA_EMBEDDING_MODEL`: proveedor configurado de embeddings (`text-embedding-3-small`, 1536 dimensiones) desacoplado detrás de `EmbeddingProvider`.
* `OMEGA_INGEST_TMP_DIR`: ruta del volumen volátil `tmpfs` `/tmp/omega_ingest` (`512m`, `noexec,nosuid,nodev`, `uid=10001`).

Ejecución de pruebas con Maven (Docker `pgvector/pgvector:pg16` o `OMEGA_TEST_DB_URL`):

```bash
cd omega/backend-java
mvn -B test
```
