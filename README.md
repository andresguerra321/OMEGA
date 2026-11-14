# OMEGA — Plataforma Defensiva de Cyber Threat Intelligence sobre Spyware Comercial

Plataforma defensiva de inteligencia de amenazas cibernéticas (CTI) asistida por RAG híbrido, trazabilidad verificable, verificación forense de indicadores (MVT / YARA / respaldos móviles) en memoria volátil y auditoría pasiva de exposición (OSINT), con aislamiento multi-tenant y política de **Zero-Retention** sobre archivos originales.

---

## 1. Organización del Proyecto

```text
omega/
├── docker-compose.yml               # Orquestación de 4 contenedores y red aislada omega-internal
├── .env.example                     # Plantilla de variables (Postgres, JWT, OpenAI/Groq, puertos)
├── .gitignore                       # Exclusiones de secretos (.env), binarios, dist/ y target/
├── backend-java/                    # Núcleo transaccional, seguridad y multi-tenancy (Java 21 + Spring Boot 3.3.5)
│   ├── Dockerfile                   # Multi-stage Maven (Java 21) + JRE 21 + Tesseract OCR (eng/spa)
│   ├── pom.xml                      # Spring Security, JPA, Hibernate Vector, Flyway, JWT (jjwt), PDFBox, Tess4J
│   ├── README.md                    # Documentación técnica y estado de fases del núcleo Java
│   └── src/main/
│       ├── java/com/omega/platform/
│       │   ├── config/              # OmegaProperties (@Validated), AsyncExecutorConfig, RestClientConfig
│       │   ├── domain/              # Entidades JPA: Tenant, User, Expediente, Document, DocumentChunk
│       │   ├── repository/          # Repositorios Spring Data JPA acotados por tenant_id
│       │   ├── security/            # JWT HS256, TenantContext, RBAC (ADMIN/ANALYST/CLIENT), anti-IDOR ACL
│       │   ├── service/             # AuthService y ExpedienteService
│       │   ├── web/                 # /api/v1/auth/*, /api/v1/expedientes/* y ProblemDetail global
│       │   ├── rag/                 # Contrato desacoplado EmbeddingProvider
│       │   └── integration/forensic/# Contratos RestClient hacia omega/api/ (ForensicWorkerContracts)
│       └── resources/db/migration/
│           └── V1__init_omega_rag_schema.sql # Esquema aislado omega_rag + pgvector(1536) HNSW + tsvector GIN
├── api/                             # Worker forense y motor CTI en FastAPI (aislado en red interna)
│   ├── Dockerfile                   # Python 3.11 + PyTorch CPU + yara-python + iphone-backup-decrypt
│   ├── main.py                      # API FastAPI del motor CTI, RAG y triage
│   ├── schemas.py                   # Contratos tipados (Pydantic v2)
│   ├── services.py                  # Orquestación RAG, citas y analítica CTI
│   ├── deep_forensics.py            # Inspección profunda de artefactos móviles y dumps MVT
│   ├── behavioral_forensics.py      # Heurísticas de anomalías conductuales
│   ├── yara_engine.py               # Escaneo YARA sobre IOCs y dumps
│   ├── ios_backup_crypto.py         # Desbloqueo en memoria (:memory:) de respaldos iOS cifrados
│   ├── temporal_correlator.py       # Correlación temporal zero-day / eventos
│   ├── triage_orchestrator.py       # Pipeline de triage forense paralelo
│   ├── link_verifier.py             # Verificación pasiva de enlaces sospechosos
│   ├── detection_engineering.py     # Exportación de reglas YARA por campaña
│   └── osint_engine.py              # Monitoreo pasivo crt.sh + DNS DoH (SPF/DMARC)
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

## 2. Arquitectura Híbrida y Stack Tecnológico

OMEGA opera mediante **4 contenedores** conectados en la red bridge `omega-internal`:

| Servicio Docker (`compose`) | Contenedor | Puertos expuestos | Responsabilidad |
| :--- | :--- | :--- | :--- |
| **`postgres`** (`pgvector/pgvector:pg16`) | `omega_postgres` | `5432` | Persistencia dual: esquema `public.*` (corpus público CTI, 768 dims) y esquema **`omega_rag.*`** gestionado por Flyway (`vector(1536)` HNSW + `tsvector` GIN multi-tenant). |
| **`backend-java`** (Java 21 / Spring Boot 3.3.5) | `omega_backend_java` | `8080` (`${JAVA_BACKEND_PORT}`) | Núcleo transaccional, autenticación JWT stateless (`HS256`), aislamiento multi-tenant por `tenant_id`, RBAC (`ADMIN`, `ANALYST`, `CLIENT`), ACL por expediente y directorio temporal volátil `tmpfs` `/tmp/omega_ingest` (`256m`, `noexec,nosuid,nodev`) con Tesseract OCR listo para ingesta Zero-Retention. |
| **`forensic-worker`** (FastAPI 0.115 / Python 3.11) | `omega_forensic_worker` | *Solo red interna* (`8000`, alias `omega-api`) | Motor forense especializado: triage paralelo MVT/YARA, desbloqueo iOS en RAM (`:memory:`), verificación pasiva de enlaces, OSINT DoH/`crt.sh` y motor RAG Groq actual. Sin exposición pública directa hacia el host. |
| **`omega-frontend`** (React 19 + Vite 8 + Three.js + Nginx) | `omega_frontend` | `5173` | Interfaz web y shell Electron: cabina 3D `SecurityCenterpiece3D`, asistente con orbe WebGL GLSL `OmegaShaderOrb`, cajón lateral `CopilotDrawer` y proxy Nginx `/api/` hacia `forensic-worker`. |

### Estado actual del núcleo Java (`omega/backend-java`)

* **Fases 1 y 2 completadas y verificadas:** migración Flyway `V1__init_omega_rag_schema.sql` (`tenants`, `users`, `expedientes`, `expediente_permissions`, `documents`, `document_chunks`), llave compuesta `(tenant_id, id)` anti-IDOR a nivel SQL, filtros JWT stateless + `TenantContext` + BCrypt (`cost 12`), endpoints `/api/v1/auth/*` y `/api/v1/expedientes/*`, y validación de arranque (`OMEGA_JWT_SECRET` >= 32 bytes sin secreto de desarrollo en perfil `prod`).
* **Fases 3+ preparadas por contrato:** configuración de ejecución asíncrona `AsyncExecutorConfig` (`@Async`, `PDFBox 3.0.3` + `Tess4J 5.13.0`), interfaz desacoplada `EmbeddingProvider` y DTOs `ForensicWorkerContracts` + `RestClientConfig` hacia `http://forensic-worker:8000` (detalle completo en [omega/backend-java/README.md](omega/backend-java/README.md)).

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
| **RNF6** | Arquitectura modular desacoplada | 4 servicios aislados en `omega-internal` (`postgres`, `backend-java`, `forensic-worker`, `omega-frontend`) | ✅ Cumplido |
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
* Clave de API de [Groq](https://console.groq.com/) (y `OPENAI_API_KEY` al habilitar embeddings de 1536 dimensiones en `backend-java`).

### Pasos de ejecución
1. **Configurar variables de entorno:**
   ```powershell
   copy omega\.env.example omega\.env
   ```
   Edita `omega/.env` definiendo al menos un `OMEGA_JWT_SECRET` aleatorio de al menos 32 bytes, las credenciales de PostgreSQL y tu `GROQ_API_KEY`:
   ```env
   POSTGRES_USER=omega_admin
   POSTGRES_PASSWORD=tu_password_seguro
   POSTGRES_DB=omega_cti
   OMEGA_JWT_SECRET=reemplazar_por_secreto_criptografico_minimo_32_bytes
   GROQ_API_KEY=gsk_tu_clave_aqui
   ```

2. **Construir y levantar el ecosistema completo:**
   ```powershell
   cd omega
   docker compose up -d --build
   ```

3. **Puntos de acceso locales:**
   * **Interfaz Web (React / Nginx):** [http://localhost:5173](http://localhost:5173) (proxea `/api/*` hacia el worker interno).
   * **Núcleo Backend Java (`backend-java`):** [http://localhost:8080/actuator/health](http://localhost:8080/actuator/health) (`/api/v1/auth/*`, `/api/v1/expedientes/*`).
   * **Worker Forense (`forensic-worker`):** ejecutándose aislado en `http://forensic-worker:8000` dentro de `omega-internal` (sin puerto público en el host).
   * **PostgreSQL 16 + `pgvector`:** `localhost:5432` (BD `omega_cti`, esquemas `public` y `omega_rag`).

Para ejecutar también la aplicación de escritorio Electron en desarrollo local, revisa [omega/frontend/README.md](omega/frontend/README.md).

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
