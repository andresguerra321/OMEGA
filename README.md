# OMEGA — Plataforma Defensiva de Cyber Threat Intelligence sobre Spyware Comercial

Sistema de inteligencia de amenazas cibernéticas (CTI) defensivo y asistido por IA generativa (RAG) para la correlación de campañas de spyware comercial de grado gubernamental (*Pegasus*, *Predator*, etc.), verificación forense de indicadores de compromiso (MVT) en memoria volátil y monitoreo ético de exposición pasiva (OSINT).

---

## 1. Organización del Proyecto

```text
omega/
├── docker-compose.yml       # Orquestación integral de la plataforma (DB, API, Frontend)
├── .env.example             # Plantilla de variables de entorno y claves
├── .gitignore               # Exclusiones de Git (seguridad y exclusión de claves)
├── api/                     # Capa de servicios REST (FastAPI)
│   ├── Dockerfile           # Contenedor de producción backend
│   ├── main.py              # Enrutador principal y endpoints públicos
│   ├── schemas.py           # Contratos de datos tipados (Pydantic v2)
│   ├── services.py          # Lógica analítica RAG, forense MVT y OSINT pasivo
│   └── requirements.txt     # Dependencias de la API
├── corpus_mvp/              # Corpus técnico seed indexado
│   ├── corpus_manifest.json # Metadatos, hashes SHA-256 y URLs de procedencia pública
│   ├── pdfs/                # Reportes de Citizen Lab, Amnesty Tech y Google TAG
│   ├── iocs/                # Feeds oficiales en formato STIX 2.1 (Pegasus, Predator)
│   └── mvt_samples/         # Muestras de prueba forenses MVT
├── db/                      # Capa de persistencia relacional y vectorial
│   └── init.sql             # Esquema DDL en PostgreSQL 16 con extensión pgvector
├── docs/                    # Documentación académica para documento de grado
│   ├── matriz_trazabilidad.md # Matriz de requerimientos RF1–RF8 y RNF1–RNF8
│   ├── declaracion_etica.md   # Declaración de blindaje ético y salvaguardas (RNF7/RNF8)
│   └── guion_demo.md          # Guión estructurado de sustentación en vivo (5 minutos)
├── frontend/                # Interfaz de usuario Chat-First (React 19 + Vite + Tailwind v4)
│   ├── Dockerfile           # Contenedor multi-stage (Node 22-alpine + NGINX)
│   ├── src/
│   │   ├── App.jsx          # Componente raíz con navegación y divulgación progresiva
│   │   ├── components/      # CitationDrawer, OsintPanel
│   │   └── lib/api.js       # Cliente HTTP centralizado
│   └── package.json
└── rag_engine/              # Motor RAG y suite de evaluación académica
    ├── ingest.py            # Ingesta y fragmentación de reportes PDF (PyMuPDF)
    ├── normalize_meta.py    # Extracción estructurada de campañas y CVEs (Groq LPU)
    ├── ingest_iocs.py       # Poblado de base CTI con 2,100+ IOCs STIX2
    ├── verify_mvt.py        # Cruce forense en memoria volátil RAM (RNF4)
    └── eval/                # Benchmark cuantitativo RAGAS (Objetivo 6)
        ├── eval_dataset.json# Dataset ground-truth con preguntas trampa
        ├── run_benchmark.py # Script de evaluación Faithfulness / Relevancy
        └── eval_report.md   # Reporte cuantitativo consolidado
```

---

## 2. Tecnologías y Stack de Arquitectura

* **Base de Datos:** PostgreSQL 16 con extensión `pgvector` e índices vectoriales HNSW (`<=>` similitud coseno).
* **Motor de Embeddings:** `sentence-transformers/paraphrase-multilingual-mpnet-base-v2` (768 dimensiones).
* **Inferencia y Razonamiento LLM:** Groq LPU (`openai/gpt-oss-120b` / `llama-3.3-70b-versatile`) a temperatura 0.0 con control estricto de abstención.
* **Backend:** FastAPI 0.115 + Pydantic v2 + Psycopg 3 con pooling y streaming asíncrono.
* **Frontend:** React 19 + Vite + Tailwind CSS v4 + Lucide React (arquitectura *chat-first* y divulgación progresiva).
* **Evaluación Académica:** Framework RAGAS + HuggingFace Embeddings locales.
* **Despliegue y Empaquetado:** Docker Compose unificado con volúmenes persistentes y caché de modelos.

---

## 3. Matriz de Requerimientos y Cumplimiento

| ID | Requerimiento | Implementación Técnica | Estado |
| :--- | :--- | :--- | :---: |
| **RF1** | Ingesta de PDFs y metadatos | `rag_engine/ingest.py` (PyMuPDF) + `normalize_meta.py` | ✅ Cumplido |
| **RF2** | Normalización relacional | Esquema relacional en PostgreSQL 16 (`db/init.sql`) | ✅ Cumplido |
| **RF3** | Embeddings vectoriales | `paraphrase-multilingual-mpnet-base-v2` + `pgvector` HNSW | ✅ Cumplido |
| **RF4** | Consultas RAG con citas | `run_rag_query` con citas explícitas `[Reporte, Pág. X]` | ✅ Cumplido |
| **RF5** | Cruce forense MVT / IOCs | Feeds STIX2/JSON cruzados contra dumps móviles | ✅ Cumplido |
| **RF6** | Explorador de campañas | Vista interactiva con CVEs, actores, sectores e IOCs | ✅ Cumplido |
| **RF7** | Trazabilidad inmutable | Hash SHA-256, URL de origen y marcas temporales | ✅ Cumplido |
| **RF8** | OSINT pasivo con consentimiento | `crt.sh` + Cloudflare DNS DoH (SPF/DMARC) condicionado | ✅ Cumplido |
| **RNF1** | Precisión sin alucinación | Temperatura 0.0 + regla de abstención + evaluación RAGAS | ✅ Cumplido |
| **RNF2** | Divulgación progresiva | Interfaz limpia; evidencia en cajón lateral con un clic | ✅ Cumplido |
| **RNF3** | Latencia interactiva | Latencia media de **4.1 segundos** en benchmark | ✅ Cumplido |
| **RNF4** | Privacidad de evidencia forense | Procesamiento exclusivo en memoria RAM volátil (`del raw_bytes`) | ✅ Cumplido |
| **RNF6** | Arquitectura modular | Desacoplamiento total en 4 capas contenerizadas | ✅ Cumplido |
| **RNF7** | Enfoque 100% defensivo | Ausencia de módulos ofensivos, exploits o decompiladores | ✅ Cumplido |
| **RNF8** | Salvaguarda ética OSINT | `CHECK (explicit_consent = TRUE)` en BD y bloqueo HTTP 400 | ✅ Cumplido |

---

## 4. Resultados de Evaluación Cuantitativa (Objetivo 6)

Evaluación realizada mediante el framework **RAGAS** sobre el corpus técnico con casos de prueba de dominio y preguntas trampa de control:

| Dimensión | Métrica | Valor Obtenido | Requerimiento |
| :--- | :--- | :---: | :--- |
| **Fidelidad Documental** | RAGAS Faithfulness (0–1) | **0.7419** | RNF1, Objetivo 3 |
| **Relevancia de Respuesta** | RAGAS Answer Relevancy (0–1) | **0.8258** | RF4, Objetivo 6 |
| **Trazabilidad Estricta** | Formato de citas `[Reporte, Pág. X]` | **80.0%** (8/10) | RNF1 |
| **Control Anti-Alucinación** | Tasa de abstención fuera de corpus | **100.0%** (3/3) | RNF1 |
| **Rendimiento Interactivo** | Latencia media por consulta | **4.105s** | RNF3 |

---

## 5. Puesta en Marcha Rápida (Despliegue Portable)

### Requisitos previos
* [Docker Desktop](https://www.docker.com/) instalado y activo.
* Clave de API de [Groq](https://console.groq.com/).

### Pasos de ejecución
1. **Configurar variables de entorno:**
   ```powershell
   copy omega\.env.example omega\.env
   ```
   Edita `omega/.env` y define tu clave:
   ```env
   GROQ_API_KEY=gsk_tu_clave_aqui
   GROQ_MODEL=openai/gpt-oss-120b
   ```

2. **Levantar el ecosistema completo en Docker:**
   ```powershell
   cd omega
   docker compose up -d --build
   ```

3. **Acceder a la plataforma:**
   * **Interfaz Web (React):** [http://localhost:5173](http://localhost:5173)
   * **Documentación Interactiva Swagger:** [http://localhost:8000/docs](http://localhost:8000/docs)
   * **Base de Datos PostgreSQL:** `localhost:5432` (Base de datos: `omega_cti`)

---

## 6. Documentación Académica y Sustentación

En la carpeta [`omega/docs/`](omega/docs/) se encuentran los anexos para la memoria de tesis y presentación ante el jurado:
* [Matriz de Trazabilidad Técnica (RF1–RF8 / RNF1–RNF8)](omega/docs/matriz_trazabilidad.md)
* [Declaración de Blindaje Ético y Salvaguardas](omega/docs/declaracion_etica.md)
* [Guión de Demostración en Vivo en 5 Minutos](omega/docs/guion_demo.md)
