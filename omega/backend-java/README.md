# OMEGA Core Backend (`omega/backend-java`)

Núcleo transaccional, de seguridad multi-tenant, control de acceso y base para ingesta **Zero-Retention** e integración RAG híbrida de OMEGA, construido con **Java 21** y **Spring Boot 3.3.5**.

---

## 1. Stack y Dependencias (`pom.xml`)

* **Java 21** + **Spring Boot 3.3.5** (`web`, `security`, `data-jpa`, `validation`, `actuator`)
* **PostgreSQL 16 + pgvector + Flyway** (`hibernate-vector`, `flyway-core`, `flyway-database-postgresql`)
* **JWT stateless (RFC 7519):** `io.jsonwebtoken:jjwt` `0.12.6` (firma `HS256`)
* **Procesamiento PDF / OCR preparado:** Apache PDFBox `3.0.3` + Tess4J `5.13.0` (`tesseract-ocr` `eng`/`spa` preinstalado en imagen runtime)
* **Testing:** `spring-boot-starter-test`, `spring-security-test`, `Testcontainers` (`pgvector/pgvector:pg16`)

---

## 2. Arquitectura de Paquetes

```text
src/main/java/com/omega/platform/
├── OmegaBackendApplication.java
├── config/
│   ├── AsyncExecutorConfig.java          # Pool acotado omegaIngestExecutor (core=2, max=6, queue=32)
│   ├── OmegaProperties.java              # Configuración @Validated (security, ingest, rag, forensicWorker)
│   └── RestClientConfig.java             # Cliente HTTP hacia http://forensic-worker:8000
├── domain/                               # Entidades JPA sobre esquema omega_rag
│   ├── TenantEntity.java, UserEntity.java, ExpedienteEntity.java, ExpedientePermissionEntity.java
│   ├── DocumentEntity.java, DocumentChunkEntity.java
│   └── ClassificationLevel.java, DocumentStatus.java, ExpedientePermissionLevel.java
├── repository/                           # Consultas acotadas por tenant_id
├── security/
│   ├── Role.java                         # ADMIN, ANALYST, CLIENT
│   ├── OmegaPrincipal.java / TenantContext.java / TenantScope.java
│   ├── JwtService.java / JwtAuthenticationFilter.java / SecurityConfig.java
│   ├── ExpedienteAuthorizationService.java # Verificación de lectura/escritura anti-IDOR por tenant
│   └── JsonSecurityHandlers.java         # Respuestas 401/403 uniformes en ProblemDetail JSON
├── service/
│   ├── AuthService.java                  # Registro de tenant, login JWT y creación de usuarios (ADMIN)
│   └── ExpedienteService.java            # CRUD de expedientes accesibles y concesión de permisos ACL
├── rag/
│   └── EmbeddingProvider.java            # Interfaz desacoplada para proveedores de embeddings (1536 dims)
├── integration/forensic/
│   └── ForensicWorkerContracts.java      # Contratos DTO 1:1 con omega/api/ (triage paralelo, enlaces, YARA)
└── web/
    ├── AuthController.java               # /api/v1/auth/*
    ├── ExpedienteController.java         # /api/v1/expedientes/*
    ├── GlobalExceptionHandler.java
    └── dto/AuthDtos.java, ExpedienteDtos.java
```

---

## 3. Esquema Multi-Tenant en PostgreSQL (`V1__init_omega_rag_schema.sql`)

Flyway crea y gestiona el esquema aislado **`omega_rag`** conviviendo sin colisiones con el corpus CTI público (`public.*`):

1. **`omega_rag.tenants`**: organizaciones / clientes aislados (`slug`, `name`, `active`).
2. **`omega_rag.users`**: usuarios con roles `ADMIN`, `ANALYST`, `CLIENT` y llave única compuesta `(tenant_id, id)`.
3. **`omega_rag.expedientes`**: casos clasificados (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`) con FK compuesta `(tenant_id, owner_user_id)` hacia `users`.
4. **`omega_rag.expediente_permissions`**: ACL granular (`READ` / `WRITE`) garantizando a nivel relacional que expediente y usuario pertenecen al mismo `tenant_id`.
5. **`omega_rag.documents`**: registro auditado sin almacenar binarios PDF; guarda `original_filename`, `sha256_hash` (64 hex), `total_pages`, `embedding_model`, `ocr_applied`, `status` (`PROCESSING`, `INDEXED`, `FAILED`, `REINDEX_REQUIRED`) y `temp_deleted_at`.
6. **`omega_rag.document_chunks`**: fragmentos (`content`) con columna `search_vector` (`tsvector GENERATED ALWAYS AS ... STORED` con índice **GIN**), columna `embedding public.vector(1536)` con índice **HNSW** (`vector_cosine_ops`) y FKs compuestas por `(tenant_id, document_id)` y `(tenant_id, expediente_id)`.

---

## 4. Endpoints Implementados (Fases 1–2) y Estado

### Activos hoy
* **Salud:** `GET /actuator/health` (público, `show-details: never`)
* **Autenticación y Tenants (`/api/v1/auth`):**
  * `POST /api/v1/auth/tenants/register` (controlado por `OMEGA_ALLOW_TENANT_SELF_REGISTRATION` y cabecera opcional `X-Omega-Bootstrap-Secret`)
  * `POST /api/v1/auth/login`
  * `POST /api/v1/auth/users` (`ROLE_ADMIN` dentro de su propio `tenant_id`)
  * `GET /api/v1/auth/me`
* **Expedientes (`/api/v1/expedientes`):**
  * `GET /api/v1/expedientes` (lista los expedientes accesibles en el `tenant_id` del token)
  * `POST /api/v1/expedientes` (`ADMIN` o `ANALYST`)
  * `GET /api/v1/expedientes/{expedienteId}` (requiere permiso de lectura / propiedad en el tenant)
  * `POST /api/v1/expedientes/{expedienteId}/permissions` (asigna permisos `READ` / `WRITE` a usuarios del mismo tenant)

### Base preparada para fases siguientes (aún sin exponer endpoints en producción)
* Pipeline asíncrono Zero-Retention de ingesta PDF (`POST .../documents`) sobre el montaje volátil en RAM `tmpfs` `/tmp/omega_ingest` (`256m`, `noexec,nosuid,nodev`), extracción PDFBox + OCR Tess4J y borrado garantizado (`temp_deleted_at`).
* Implementación concreta de `EmbeddingProvider` (`OpenAiEmbeddingProvider` / proveedor local) y búsqueda híbrida (`HNSW` + `tsvector` + RRF).
* Controlador puente vía `forensicWorkerRestClient` usando `ForensicWorkerContracts`.

---

## 5. Seguridad, Configuración y Pruebas

Variables clave definidas en [`omega/.env.example`](../.env.example):

* `OMEGA_JWT_SECRET`: clave HMAC-SHA256 de al menos **32 caracteres**. Con perfil `prod` activo, el arranque falla intencionalmente si se mantiene el valor por defecto de desarrollo.
* `OMEGA_ALLOW_TENANT_SELF_REGISTRATION` / `OMEGA_BOOTSTRAP_SECRET`: restringen la creación de nuevos tenants en producción.
* `OMEGA_INGEST_TMP_DIR`: ruta del volumen volátil (`tmpfs` `/tmp/omega_ingest`).

Ejecución de pruebas con Maven (requiere Docker activo para Testcontainers `pgvector/pgvector:pg16` o definir `OMEGA_TEST_DB_URL`):

```bash
cd omega/backend-java
mvn -B test
```
