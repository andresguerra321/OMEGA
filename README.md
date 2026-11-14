# OMEGA — Plataforma Defensiva de Cyber Threat Intelligence sobre Spyware Comercial

Plataforma defensiva de inteligencia de amenazas cibernéticas (CTI) asistida por RAG híbrido, trazabilidad verificable, verificación forense de indicadores (MVT / YARA / respaldos móviles) en memoria volátil y auditoría pasiva de exposición (OSINT), con aislamiento multi-tenant y política de **Zero-Retention** sobre archivos originales.

---

## 1. Organización del Proyecto

```text
omega/
├── docker-compose.yml               # Orquestación de 3 contenedores (postgres, forensic-worker, backend-java) y redes omega-public / omega-private
├── .env.example                     # Plantilla de variables (Postgres, JWT, INTERNAL_SERVICE_TOKEN, OpenAI, CTI)
├── .gitignore                       # Exclusiones de secretos (.env), binarios, dist/ y target/
├── backend-java/                    # Núcleo transaccional, RAG Zero-Retention, CTI STIX 2.1 y seguridad (Java 21 + Spring Boot 3.3.5)
│   ├── Dockerfile                   # Multi-stage Maven (Java 21) + JRE 21 non-root + Tesseract OCR (eng/spa)
│   ├── pom.xml                      # Spring Security, JPA, Hibernate Vector, Flyway, JWT (jjwt), PDFBox, Tess4J
│   ├── README.md                    # Documentación técnica del núcleo Java Zero-Retention
│   └── src/main/
│       ├── java/com/omega/platform/
│       │   ├── config/              # OmegaProperties, RestClientConfig y configuración asíncrona
│       │   ├── domain/              # Entidades JPA multi-tenant, auditoría y catálogo CTI
│       │   ├── repository/          # Repositorios JPA por tenant_id y búsqueda híbrida vector+tsvector
│       │   ├── security/            # JWT HS256, TenantContext, RBAC (ADMIN/ANALYST/CLIENT), anti-IDOR ACL
│       │   ├── service/             # AuthService, ExpedienteService y AuditLogService (cadena SHA-256)
│       │   ├── ingest/              # Pipeline Zero-Retention (PDFBox AST, SHA-256 en RAM, Tess4J OCR, chunking)
│       │   ├── cti/                 # StixCatalogService (bootstrap/ingesta STIX 2.1)
│       │   ├── rag/                 # EmbeddingProvider (OpenAI), RagAnswerGenerator y HybridRagQueryService
│       │   ├── integration/forensic/# ArchiveSecurityValidator y ForensicBridgeService hacia omega/api/
│       │   └── web/                 # API REST /api/v1/* (auth, expedientes, documents, query, cti, forensics, audit-logs)
│       └── resources/db/migration/
│           ├── V1__init_omega_rag_schema.sql         # Esquema omega_rag + pgvector(1536) HNSW + multi-tenancy
│           ├── V2__audit_logs_and_hybrid_search.sql  # tsvector GIN híbrido y tabla audit_logs encadenada por SHA-256
│           └── V3__stix_ioc_catalog.sql              # Tablas campaigns e ioc_indicators para catálogo STIX 2.1
├── api/                             # Worker forense stateless en FastAPI (aislado en red omega-private)
│   ├── Dockerfile                   # Python 3.11 no-root (UID 10002) + yara-python + iphone-backup-decrypt
│   ├── main.py                      # API forense interna protegida por middleware X-Internal-Service-Token
│   ├── schemas.py                   # Contratos tipados (Pydantic v2)
│   ├── cti_db.py                    # Consultas compartidas al catálogo CTI en PostgreSQL
│   ├── forensic_engine.py           # Motor base de correlación forense sobre artefactos
│   ├── deep_forensics.py            # Inspección profunda en RAM de artefactos móviles y dumps MVT
│   ├── behavioral_forensics.py      # Heurísticas de anomalías conductuales
│   ├── yara_engine.py               # Escaneo YARA sobre IOCs y volcados
│   ├── ios_backup_crypto.py         # Desbloqueo en memoria (:memory:) de respaldos iOS cifrados
│   ├── temporal_correlator.py       # Correlación temporal zero-day / eventos
│   ├── triage_orchestrator.py       # Pipeline de triage forense paralelo
│   ├── host_forensics.py            # Inspección forense de artefactos de host
│   ├── link_verifier.py             # Verificación pasiva de enlaces sospechosos
│   └── detection_engineering.py     # Exportación de reglas YARA y scripts MVT por campaña
├── corpus_mvp/                      # Corpus técnico seed indexado (PDFs públicos, STIX 2.1, muestras MVT)
├── db/
│   └── init.sql                     # Esquema público CTI (reports, campaigns, cves, iocs, osint_assets)
├── docs/                            # Documentación académica para sustentación
│   ├── matriz_trazabilidad.md       # Matriz RF1–RF8 y RNF1–RNF8
│   ├── declaracion_etica.md         # Declaración de alcance defensivo y salvaguardas (RNF7/RNF8)
│   └── guion_demo.md                # Guión de demostración en vivo (5 minutos)
├── frontend/                        # Cliente Web & Desktop (React 19 + Vite 8 + Tailwind v4 + Three.js + Electron 45)
│   ├── Dockerfile                   # Multi-stage Node 22-alpine + Nginx Alpine
│   ├── nginx.conf                   # Proxy /api/ -> http://omega-api:8000/api/ (alias de forensic-worker)
│   ├── electron/                    # Empaquetado nativo de escritorio (IPC PC/ADB/iOS, titleBarOverlay)
│   └── src/
│       ├── App.jsx                  # Navegación espacial, estado global y conmutador Simple | Técnico
│       ├── components/              # SecurityPostureStage, SecurityCenterpiece3D, OmegaShaderOrb,
│       │                            # SpatialNavPill, ChatWorkspace, CopilotDrawer, ChatAtmosphere, etc.
│       └── lib/api.js               # Cliente HTTP unificado Web + Electron
└── rag_engine/                      # Ingesta Python del corpus público y suite de evaluación RAGAS
    ├── ingest.py / normalize_meta.py / ingest_iocs.py / verify_mvt.py
    └── eval/                        # Benchmark RAGAS (eval_dataset.json, run_benchmark.py, eval_report.md)
```

---

## 2. Arquitectura y Stack Tecnológico

OMEGA opera mediante **3 contenedores endurecidos** segregados en dos redes (`omega-public` y `omega-private` con `internal: true`):

| Servicio Docker (`compose`) | Contenedor | Redes / Puertos | Responsabilidad |
| :--- | :--- | :--- | :--- |
| **`backend-java`** (Java 21 / Spring Boot 3.3.5) | `omega_backend_java` | `omega-public` (`:8080`) + `omega-private` | Núcleo transaccional, JWT stateless (`HS256`), aislamiento multi-tenant, RBAC, ACL por expediente, ingesta PDF Zero-Retention en `tmpfs` `/tmp/omega_ingest` (`512m`, `noexec,nosuid,nodev`), OCR Tess4J, RAG híbrido HNSW+tsvector, STIX 2.1, cadena SHA-256 `audit_logs` y puente autenticado hacia el worker forense. |
| **`forensic-worker`** (FastAPI / Python 3.11) | `omega_forensic_worker` | Solo `omega-private` (*sin puertos públicos*) | Microservicio forense stateless en RAM (triage paralelo MVT, YARA, iOS crypto `:memory:`, correlación temporal y verificación pasiva de enlaces). Rechaza peticiones sin `X-Internal-Service-Token` válido. |
| **`postgres`** (`pgvector/pgvector:pg16`) | `omega_postgres` | Solo `omega-private` (*sin puertos públicos*) | Persistencia aislada en esquema `omega_rag` gestionado por Flyway (`V1`–`V3`). |

### Estado del Núcleo Java (`omega/backend-java`)

* **Arquitectura Zero-Retention completa:** validación estructural PDFBox (bloqueo de `/JavaScript`, `/Launch`, `/AA`, `/OpenAction`), SHA-256 en streaming, procesamiento `@Async` sobre `tmpfs`, borrado físico garantizado en `finally` (`temp_deleted_at`), búsqueda híbrida RRF (`pgvector` + `tsvector`), detección de drift de embeddings (`REINDEX_REQUIRED`), ingesta STIX 2.1 (`campaigns` / `ioc_indicators`) y validación anti-Zip-Slip / anti-Bomba-ZIP (detalle en [omega/backend-java/README.md](omega/backend-java/README.md)).

---

## 3. Matriz de Requerimientos y Cumplimiento

| ID | Requerimiento | Implementación Técnica | Estado |
| :--- | :--- | :--- | :---: |
| **RF1** | Ingesta de PDFs y metadatos | `rag_engine/ingest.py` (PyMuPDF) + `normalize_meta.py` (corpus seed) | ✅ Cumplido |
| **RF2** | Normalización relacional | PostgreSQL 16 (`db/init.sql` en `public` y Flyway `V1` en `omega_rag`) | ✅ Cumplido |
| **RF3** | Embeddings vectoriales | `paraphrase-multilingual-mpnet-base-v2` (768d) y esquema HNSW 1536d en `omega_rag` | ✅ Cumplido |
| **RF4** | Consultas RAG con citas | `run_rag_query` con citas explícitas `[Reporte, Pág. X]` | ✅ Cumplido |
| **RF5** | Cruce forense MVT / IOCs | Feeds STIX 2.1 + YARA + correlación temporal + iOS backup en RAM | ✅ Cumplido |
| **RF6** | Explorador de campañas | Vista interactiva con CVEs, actores, sectores e indicadores por campaña | ✅ Cumplido |
| **RF7** | Trazabilidad inmutable | Hash SHA-256 (`sha256_hash` en `omega_rag.documents` y `file_hash` en `reports`) | ✅ Cumplido |
| **RF8** | OSINT pasivo con consentimiento | `crt.sh` + Cloudflare DNS DoH (`SPF`/`DMARC`) condicionado por BD | ✅ Cumplido |
| **RNF1** | Precisión sin alucinación | Temperatura 0.0 + regla estricta de abstención + benchmark RAGAS | ✅ Cumplido |
| **RNF2** | Divulgación progresiva | Cabina clara + detalles técnicos expandibles + `CitationDrawer` / `CopilotDrawer` | ✅ Cumplido |
| **RNF3** | Latencia interactiva | Latencia media de **4.1 segundos** en benchmark | ✅ Cumplido |
| **RNF4** | Privacidad y Zero-Retention | Análisis volátil en RAM (`del raw_bytes`, SQLite `:memory:`) y `tmpfs` `/tmp/omega_ingest` en `backend-java` | ✅ Cumplido |
| **RNF6** | Arquitectura modular desacoplada | 3 servicios aislados en redes `omega-public` + `omega-private` (`postgres`, `forensic-worker`, `backend-java`) | ✅ Cumplido |
| **RNF7** | Enfoque 100% defensivo | Ausencia total de exploits, payloads o capacidades ofensivas | ✅ Cumplido |
| **RNF8** | Salvaguarda ética OSINT | `CHECK (explicit_consent = TRUE)` en PostgreSQL y validación API/UI | ✅ Cumplido |

---

## 4. Resultados de Evaluación Cuantitativa (Objetivo 6)

Evaluación realizada mediante el framework **RAGAS** sobre el corpus técnico seed con casos de prueba de dominio y preguntas trampa de control (`omega/rag_engine/eval/eval_report.md`):

| Dimensión | Métrica | Valor Obtenido | Requerimiento |
| :--- | :--- | :---: | :--- |
| **Fidelidad Documental** | RAGAS Faithfulness (0–1) | **0.7419** | RNF1, Objetivo 3 |
| **Relevancia de Respuesta** | RAGAS Answer Relevancy (0–1) | **0.8258** | RF4, Objetivo 6 |
| **Trazabilidad Estricta** | Formato de citas `[Reporte, Pág. X]` | **80.0%** (8/10) | RNF1 |
| **Control Anti-Alucinación** | Tasa de abstención fuera de corpus | **100.0%** (3/3) | RNF1 |
| **Rendimiento Interactivo** | Latencia media por consulta | **4.105s** | RNF3 |

---

## 5. Puesta en Marcha Rápida (Docker Compose)

### Requisitos previos
* [Docker Desktop](https://www.docker.com/) activo con soporte Linux containers / Compose v2.
* Clave `OPENAI_API_KEY` para embeddings (`text-embedding-3-small`, 1536 dims) y síntesis RAG.

### Pasos de ejecución
1. **Configurar variables de entorno:**
   ```powershell
   copy omega\.env.example omega\.env
   ```
   Edita `omega/.env` definiendo un `OMEGA_JWT_SECRET` y `INTERNAL_SERVICE_TOKEN` aleatorios de al menos 32 bytes, las credenciales de PostgreSQL y tu `OPENAI_API_KEY`:
   ```env
   POSTGRES_USER=omega_admin
   POSTGRES_PASSWORD=tu_password_seguro
   POSTGRES_DB=omega_cti
   OMEGA_JWT_SECRET=reemplazar_por_secreto_criptografico_minimo_32_bytes
   INTERNAL_SERVICE_TOKEN=reemplazar_por_token_interno_aleatorio_32_bytes
   OPENAI_API_KEY=sk_tu_clave_aqui
   ```

2. **Construir y levantar el ecosistema endurecido:**
   ```powershell
   cd omega
   docker compose up -d --build
   ```

3. **Puntos de acceso y aislamiento:**
   * **API Principal Backend Java (`backend-java`):** [http://localhost:8080/actuator/health](http://localhost:8080/actuator/health) (`/api/v1/auth/*`, `/api/v1/expedientes/*`, `/api/v1/forensics/*`, `/api/v1/cti/*`, `/api/v1/audit-logs/*`).
   * **Worker Forense (`forensic-worker`):** aislado exclusivamente en `omega-private` (`internal: true`, `http://forensic-worker:8000`, sin puertos hacia el host y autenticado mediante `X-Internal-Service-Token`).
   * **PostgreSQL 16 + `pgvector`:** aislado exclusivamente en `omega-private` (`postgres:5432`, sin exposición pública).

Para ejecutar el cliente frontend o la aplicación de escritorio Electron en desarrollo local, revisa [omega/frontend/README.md](omega/frontend/README.md).

---

## 6. Documentación Adicional

* [Arquitectura y estado del Backend Java (`omega/backend-java`)](omega/backend-java/README.md)
* [Sistema de diseño visual y WebGL (`DESIGN.md`)](DESIGN.md)
* [Especificación de producto (`PRODUCT.md`)](PRODUCT.md)
* [Guía del cliente Frontend y Electron (`omega/frontend/README.md`)](omega/frontend/README.md)
* **Documentación académica (`omega/docs/`):**
  * [Matriz de Trazabilidad Técnica (RF1–RF8 / RNF1–RNF8)](omega/docs/matriz_trazabilidad.md)
  * [Declaración de Blindaje Ético y Salvaguardas](omega/docs/declaracion_etica.md)
  * [Guión de Demostración en Vivo en 5 Minutos](omega/docs/guion_demo.md)
