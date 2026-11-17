![OMEGA — Visualización de Marca](../../img/banner.png)

# Guión Maestro de Presentación y Demo en Vivo — Proyecto OMEGA (30 Minutos)

**Versión de referencia:** `v1.6.0`  
**Propósito:** Guía completa, minuto a minuto, para sustentar y demostrar **OMEGA** ante jurado calificador, comité técnico o audiencia comercial (~25 minutos de exposición + demo guiada + 5 minutos de preguntas difíciles).

---

## Mapa de Tiempos (30 Minutos)

| Bloque | Tiempo | Tema Principal | Qué se demuestra en vivo |
| :--- | :--- | :--- | :--- |
| **1. Problema, Propuesta y Arquitectura** | `00:00 – 04:00` (4 min) | Espionaje comercial vs. herramientas dispersas; diseño Zero-Retention | Diagrama de 4+1 contenedores aislados + apertura del `.exe` con **Eclipse Orbital Loader** |
| **2. Seguridad de Sesión y Multi-Tenant** | `04:00 – 08:00` (4 min) | Autenticación sin `localStorage`, aislamiento por tenant y auditoría inmutable | Registro real, cookies `HttpOnly`, Tour inicial (`OnboardingTourModal`) y cadena **SHA-256** en Ajustes |
| **3. Motor de IA Universal y OmniRoute** | `08:00 – 12:00` (4 min) | "Trae tu propia IA": Groq por defecto, Ollama local, Gemini, OpenAI, Custom `/v1` y OmniRoute | Selector en **Ajustes → Motor de IA**, botón **Probar conexión** (anti-SSRF) y cadena de fallback |
| **4. Motor RAG Híbrido, Re-ranking y Abstención** | `12:00 – 17:00` (5 min) | `pgvector` + `tsvector` + RRF, anti-inyección, re-ranking CTI y PDFs privados sin retención | Pregunta conceptual (`"¿Qué es Pegasus?"`), citas clicables `[1]`, pregunta trampa fuera de corpus y carga de PDF privado |
| **5. Módulos Defensivos en Tiempo Real** | `17:00 – 22:30` (5.5 min) | **Inicio 3D**, **Equipos** (PC WMI, Android ADB, iOS MVT/backup), **Enlaces** pasivo, **Amenazas** y **OSINT** con doble candado ético | Inspección de enlaces sin HTTP saliente, triaje en RAM, consentimiento obligatorio en OSINT y extractor web SSRF-safe |
| **6. Honestidad Forense, RAGAS y Supply Chain** | `22:30 – 26:30` (4 min) | Límites kernel/usuario, corte CTI SHA-256, métricas cuantitativas RAGAS y CI firmado con Sigstore | Verificación `corpus_integrity.py`, tabla de ablación RAGAS y releases firmados en GitHub |
| **7. Defensa ante Preguntas del Jurado (Q&A)** | `26:30 – 30:00` (3.5 min) | Respuestas concretas sobre privacidad, llaves API, SSRF, dos backends y escalabilidad | Respuestas técnicas directas respaldadas por archivo y prueba |

---

## Checklist Previo (2 Minutos Antes de Empezar)

1. Verifica que **Docker Desktop** esté en `Engine running` y los servicios saludables (`docker compose -f omega/docker-compose.yml ps`).
2. Confirma que el motor de IA tenga **Groq** (o tu proveedor/Ollama local) activo desde **Ajustes → Motor de IA → Probar conexión**.
3. Ten abiertas en pestañas secundarias del IDE (por si el jurado pide ver código):
   - `omega/docker-compose.yml`
   - `omega/backend-java/src/main/java/com/omega/platform/rag/OpenAiRagAnswerGenerator.java`
   - `omega/backend-java/src/main/java/com/omega/platform/cti/PublicCorpusRagService.java`
   - `omega/backend-java/src/main/java/com/omega/platform/web/SystemController.java`
   - `omega/docs/matriz_trazabilidad.md` y `omega/rag_engine/eval/ablation_report_v1.md`

---

## Bloque 1 — El Problema, la Visión y la Arquitectura (`00:00 – 04:00`)

### Qué abres en pantalla
- Inicia la aplicación de escritorio **`OMEGA.exe`** (o la versión web en `http://localhost:5173` / `http://127.0.0.1:8080`) y muestra la animación del **Eclipse Orbital Loader** (`splash.html` / `OmegaLoader.jsx`) junto con el archivo `omega/docker-compose.yml`.

### Qué explicas al jurado
> *"Hoy las herramientas de Cyber Threat Intelligence (CTI) y verificación contra spyware mercenario —como Pegasus, Predator o Candiru— obligan al analista o periodista a saltar entre scripts CLI (MVT), PDFs técnicos extensos de Citizen Lab o Amnesty International, buscadores de IOCs y scripts sueltos de OSINT. Además, subir respaldos de teléfonos o documentos confidenciales a servicios SaaS tradicionales rompe la confidencialidad de la víctima."*
>
> *"OMEGA resuelve esto integrando inteligencia documental verificable, triaje forense volátil y monitoreo defensivo en una plataforma unificada con arquitectura **Zero-Retention**."*

### Por qué la arquitectura destaca (4 + 1 servicios aislados)
1. **Frontend (`omega_frontend` — React 19 + Tailwind + Framer Motion + Three.js + Electron):** interfaz de escritorio empacada en `.exe` (`OMEGA-Setup-1.6.0-x64.exe` y `OMEGA-Portable-1.6.0-x64.exe`) con `DockerOrchestrator` (`electron/dockerOrchestrator.js`), que detecta si Docker está arriba, sincroniza secretos locales sin exponer contraseñas fijas y **detecta automáticamente actualizaciones de versión** (`1.4 → 1.5 → 1.6`) reconstruyendo contenedores sin perder datos en `omega_pgdata`.
2. **Gateway y Core Transaccional (`omega_backend_java` — Java 21 / Spring Boot 3.3):** único punto de entrada (`:8080`), gestiona autenticación multi-tenant, RAG híbrido, auditoría criptográfica e ingesta temporal en `tmpfs` en RAM (`/tmp/omega_ingest` montado con `noexec,nosuid,nodev`).
3. **Worker Forense Stateless (`omega_forensic_worker` — Python / FastAPI):** vive exclusivamente en la red privada interna `omega-private` (`internal: true`, **sin puertos públicos ni salida directa por DNS de usuario**), autenticado mutuamente mediante `X-Internal-Service-Token`. Procesa respaldos y reglas YARA estrictamente en memoria RAM (`RNF4`).
4. **Base Vectorial (`omega_postgres` — PostgreSQL 16 + `pgvector`):** también aislada en `omega-private`. Separa el esquema `public` (corpus CTI público de solo lectura) del esquema `omega_rag` (tenants, expedientes, documentos e historial de auditoría).
5. **Router Multi-Proveedor Opcional (`omega_omniroute`):** perfil activable en `docker-compose.yml` (`127.0.0.1:20128`) para balancear cuotas entre múltiples cuentas o proveedores sin cambiar código.

---

## Bloque 2 — Seguridad de Sesión, Multi-Tenant y Auditoría Inmutable (`04:00 – 08:00`)

### Acción en vivo
1. Muestra la pantalla de acceso orbital (`AuthModulePanel.jsx`). Si creas una cuenta nueva frente al jurado, se dispara automáticamente el **Tour Interactivo de Bienvenida** de 5 pasos (`OnboardingTourModal.jsx`), que también puede reabrirse desde **Guía** o con `⌘K`.
2. Entra luego a **Cuenta** y a **Ajustes → Cuenta y espacio de trabajo** y pulsa **Verificar cadena de auditoría**.

### Discurso al jurado
- **Cero secretos en `localStorage`:** a diferencia de apps web comunes que guardan el JWT en `localStorage` (vulnerable a XSS), OMEGA emite una **cookie `HttpOnly` + `SameSite=Strict`** (`SessionCookieHelper.java`, `JwtAuthenticationFilter.java`), y el cliente incluso limpia llaves heredadas al iniciar (`api.js`).
- **Sin credenciales demo fijas:** retiramos usuarios hardcodeados de la interfaz; cada instalación nueva registra su propia organización y usuario administrador con validación estricta de contraseñas (`12+` caracteres) y validación anti-cadenas basura (`validators.js` / `ValidationPatterns.java`).
- **Defensa activa contra fuerza bruta (`LoginRateLimiter.java`):** bloqueo progresivo tras `5` fallos por combinación IP + correo y techo de `25` fallos por IP en ventanas de `15` minutos, devolviendo HTTP `429 Too Many Requests` con cabecera `Retry-After`.
- **Bitácora probatoria inmutable (`AuditController.java` + trigger SQL en PostgreSQL):** cada ingesta, purga de PDF, consulta RAG o auditoría OSINT queda encadenada por hash **SHA-256**. Un trigger en base de datos prohíbe `UPDATE` y `DELETE` sobre `omega_rag.audit_logs`, y el botón **Verificar cadena de auditoría** comprueba evento por evento que nadie alteró la historia.

---

## Bloque 3 — Selector Universal de IA y Resiliencia (`08:00 – 12:00`)

### Acción en vivo
1. Ve a **Ajustes → Motor de IA**.
2. Muestra el selector de proveedores con **Groq (Por defecto)** seleccionado, haz clic en los presets (**Ollama Local**, **Gemini**, **OpenRouter**, **OpenAI**, **LM Studio**, **OmniRoute**, **API personalizada `/v1`**) y pulsa **Probar conexión**.
3. Si pruebas sin haber salido de la demo, observa cómo el backend devuelve latencia real (ej. `~589 ms`) y lista los modelos detectados como chips clicables.

### Discurso al jurado
> *"Un error típico de proyectos académicos de IA es quedar amarrados a un único proveedor o exigir al usuario editar archivos `.env` por consola. En la `v1.6.0` convertimos OMEGA en una plataforma **Plug Any AI** lista para uso real:"*
> - **Cero fricción para usuarios nuevos:** **Groq gratuito** es la opción por defecto con guía de 3 pasos dentro de la propia UI; en 1 minuto cualquiera pega su `gsk_...` y el puente IPC de Electron (`dockerOrchestrator.js` + `main.js`) la guarda con permisos `0o600` (sanitizada contra inyección de líneas en `.env`) y recarga el motor automáticamente. Si falta la clave, el Chat avisa proactivamente en lugar de fallar en silencio.
> - **Soberanía de datos con Ollama / API privada:** quien no quiera enviar datos a la nube elige **Ollama (Local)** (`http://host.docker.internal:11434/v1` sin API key), **LM Studio** o cualquier servidor empresarial `/v1` (`vLLM`, `LiteLLM`), gracias a `host.docker.internal:host-gateway` en Docker.
> - **Separación Chat vs Embeddings:** configurar una URL personalizada (`CUSTOM_LLM_*`) **solo afecta al modelo generador de respuestas**; nunca rompe el proveedor de embeddings (`OPENAI_BASE_URL`).
> - **Cadena automática de respaldo (`OpenAiRagAnswerGenerator.java`):** el backend resuelve en cascada **`Proveedor Personal → OmniRoute → OpenAI → Groq → Resumen Extractivo Determinista`**. Si un proveedor cae o agota su cuota `429`, salta en milisegundos al siguiente sin interrumpir al analista.
> - **Prueba de conexión protegida contra SSRF (`POST /api/v1/system/ai-test`):** el backend mide latencia y enumera modelos, bloqueando explícitamente destinos internos (`postgres`, `forensic-worker`) e IPs link-local/metadata (`169.254.*`, `metadata.google.internal`).

---

## Bloque 4 — Motor RAG Híbrido, Re-ranking CTI, Abstención y PDFs Privados (`12:00 – 17:00`)

### Acción en vivo
1. Abre el **Asistente** (`Preguntar`), elige profundidad (`Rápido 4`, `Estándar 6`, `En profundidad 10`, `Integral 14`) y filtra por fuente o deja **Todas**.
2. **Prueba 1 — Consulta conceptual con re-ranking CTI:** escribe:
   > *"¿Qué es Pegasus y qué vulnerabilidades zero-click (CVEs) se documentan para él?"*
   - Muestra cómo responde ordenado (definición directa + viñetas estructuradas) con chips clicables `[1]`, `[2]`, `[3]`.
   - Haz clic en `[1]` o en **Ver fuentes** para abrir `SourcesPanel.jsx` / `CitationDrawer.jsx` y mostrar la página exacta y el fragmento textual original.
   - Despliega la telemetría de la respuesta (`híbrido`, `exacto`, `semántico`, similitud máxima).
3. **Prueba 2 — Abstención Anti-Alucinación (`RNF1`):** escribe una consulta fuera de corpus:
   > *"¿Qué infraestructura de comando y control utilizó el ransomware LockBit 3.0 en Colombia durante 2025?"*
   - Observa que el sistema se abstiene con honestidad sin inventar IPs, dominios ni citas.
4. **Prueba 3 — Biblioteca Privada Zero-Retention:** cambia el ámbito a **Mis PDFs** (o sube un PDF en **Cuenta** / botón **Adjuntar PDF**), consulta sobre el archivo y muestra en **Cuenta** que el documento figura como **indexado en fragmentos** mientras el PDF original fue **purgado inmediatamente del `tmpfs` en RAM** (`temp_deleted_at`), dejando trazabilidad por `SHA-256`.

### Discurso al jurado
- **Búsqueda Híbrida RRF (`HybridRagSearchRepository.java` / `PublicCorpusRagService.java`):** combina similitud semántica coseno en `pgvector` (HNSW `1536d`) con búsqueda léxica exacta `tsvector` GIN mediante **Reciprocal Rank Fusion** (`rrfK = 60`). Esto es crítico en ciberseguridad porque un embedding semántico suele confundir `CVE-2021-30860` con `CVE-2023-41064`, mientras la componente léxica los diferencia con precisión exacta.
- **Re-ranking CTI anti-ruido (`PublicCorpusRagService.java`):** antes de redactar la respuesta, recuperamos una ventana ampliada (`topK * 4`), penalizamos índices (`CONTENTS`) y volcados crudos de logs/SMS (`Appendix C`) en preguntas definicionales, y diversificamos fragmentos entre múltiples reportes (*Citizen Lab*, *Google TAG*, *Amnesty International*).
- **Blindaje Anti-Prompt Injection (`OpenAiRagAnswerGenerator.java`):** cada fragmento recuperado se envuelve entre etiquetas `<FRAGMENTO_NO_CONFIABLE>...</FRAGMENTO_NO_CONFIABLE>` neutralizando cualquier etiqueta inyectada dentro de un PDF malicioso. Además, un filtro de salida bloquea afirmaciones falsas de inmunidad (`"equipo limpio"`, `"100% seguro"`) y adjunta siempre el aviso de alcance documental (`RNF9`).

---

## Bloque 5 — Suite de Defensa Activa: Inicio 3D, Equipos, Enlaces, Amenazas y OSINT (`17:00 – 22:30`)

### Acción en vivo (recorriendo los instrumentos de `SpatialNavPill`)

1. **Inicio (`SecurityPostureStage.jsx`):**
   - Muestra el **centro 3D interactivo** (`SecurityCenterpiece3D.jsx` en Three.js con fallback accesible) y la barra unificada de acceso rápido a **Equipo Local**, **Celulares USB** y **Escudo Web**.
   - Activa el **Modo Técnico** (si quieres mostrar detalle de `WMI / Sockets RAM`, `ADB / Lockdown iOS`) y muestra la barra **⌘K (Command Palette)** y el **CopilotDrawer** que acompaña la navegación sin destruir el hilo de investigación.

2. **Escudo Web (`LinkVerifierPanel.jsx` + `link_verifier.py` — `RNF7`):**
   - Pega una URL sospechosa (ej. con homógrafos Unicode, punycode `xn--`, acortador o dominio de campaña conocida).
   - **Punto clave al jurado:** *"El verificador de enlaces realiza **cero peticiones HTTP salientes** hacia el enlace sospechoso (`RNF7`). Analiza sintaxis, IDN/homógrafos, acortadores y correlación contra el catálogo CTI sin alertar al atacante ni descargar cargas maliciosas."*

3. **Equipos (`MvtVerifierPanel.jsx` + `omega/api/`):**
   - Explica los **3 vectores de triaje local**:
     - **PC Windows:** recolección en solo lectura de procesos firmados/no firmados, conexiones TCP activas, tareas programadas y suscripciones WMI, evaluados contra reglas **YARA** y correlación conductual/temporal en RAM.
     - **Android vía ADB portátil:** detección automática/instalación de ADB portátil y auditoría no invasiva + opción de endurecimiento de DNS privado (`omega:adb-harden-dns`).
     - **iOS / Backups MVT (`ios_backup_crypto.py` + `sqlite_safety.py`):** inspección de respaldos iTunes/MVT (incluso cifrados, solicitando contraseña en memoria) con lista blanca estricta de identificadores SQLite contra inyección al analizar bases de datos no confiables (`Sms.db`, `DataUsage.sqlite`, etc.).
   - Prueba pegando indicadores de demostración:
     ```text
     weather4free.com
     tookcheckout.com
     actualite.emergence-mada.com
     google.com
     roleaccountd
     ```
   - Señala el botón de **Purga de pánico** (`omega:panic-purge`) que borra inmediatamente todos los estados volátiles en memoria del navegador/sesión.

4. **Amenazas e Ingesta Web (`CampaignsPanel.jsx` + `OmegaWebIntelCard.jsx` + `WebIntelExtractorService.java`):**
   - Explora las campañas e indicadores STIX 2.1 indexados y muestra el **extractor web en RAM**, protegido contra **DNS Rebinding / SSRF** anclando la conexión TCP/TLS a la IP pública ya validada sin re-resolución DNS en redirecciones.

5. **Exposición OSINT con Doble Candado Ético (`OsintPanel.jsx` + `OsintController.java` — `RF8, RNF8`):**
   - Escribe un dominio (ej. `miorganizacion.org`) dejando desmarcada la casilla de consentimiento → el registro queda bloqueado.
   - Marca la casilla explícita, registra el activo y pulsa **Auditar exposición**.
   - **Discurso:** *"Doble candado ético: bloqueo en UI + validación en backend + constraint `CHECK (explicit_consent = TRUE)` a nivel de PostgreSQL en `omega_rag.osint_monitored_assets`. Ejecuta inspección 100% pasiva (DNS/SPF/DMARC por DoH y logs públicos de Certificate Transparency `crt.sh`) correlacionando con campañas CTI."*

---

## Bloque 6 — Honestidad Forense, Métricas RAGAS y Cadena de Suministro (`22:30 – 26:30`)

### Acción en vivo
- Proyecta o abre `omega/rag_engine/eval/ablation_report_v1.md`, `omega/docs/matriz_trazabilidad.md` y la página de **Releases en GitHub** (`v1.6.0`).

### Discurso al jurado

1. **Honestidad Forense y Frescura del Catálogo (`forensic_scope.py`, `cti_db.py`):**
   - Todo veredicto sin hallazgos muestra explícitamente la **fecha de corte del catálogo** (`2024-12-16`), la cantidad de bundles STIX verificados y aclara que la ausencia de coincidencias en espacio de usuario **no certifica inmunidad frente a exploits zero-click en kernel/BlastDoor**, recomendando parches del SO y Modo Aislamiento (`Lockdown Mode`).

2. **Integridad Criptográfica del Corpus (`corpus_integrity.py`):**
   - Verificación **SHA-256 con fallo cerrado** sobre `9` PDFs técnicos y `7` bundles STIX 2.1 oficiales bajo política `pr_reviewed_only` (`.github/workflows/cti-feed-review.yml`). Ningún dato CTI entra sin revisión y checksum exacto.

3. **Evaluación Cuantitativa RAGAS (Ablación MVP Vectorial vs. Omega V1.0):**
   > *"Evaluamos sobre 10 casos (7 de dominio CTI muestreados estratificadamente y 3 preguntas trampa de control), usando `openai/gpt-oss-120b` como generador (`top_k=3`) y `openai/gpt-oss-20b` como juez RAGAS sin truncamiento de fragmentos:"*
   - **Context Precision:** subió de `0.2143` (7/7) a **`0.7`** (5/7 muestras válidas por cuota diaria Groq).
   - **Hit@3:** subió de `28.6%` a **`85.7%`** (`MRR@5` de `0.2143` a **`0.7857`**).
   - **Cumplimiento de citas inline:** subió de `28.6%` (2/7) a **`85.7%` (6/7)**.
   - **Fidelidad documental (`Faithfulness`):** subió de `0.2036` (7/7) a **`0.6`** (5/7 válidas).
   - **Answer Relevancy:** subió de `0.2356` a **`0.6082`** (7/7).
   - **Abstención fuera de corpus (`RNF1`):** **`100.0%` (3/3)** y latencia media neta de **`1.22 s`** (máx. `1.646 s`).

4. **Calidad Verificada en Ingeniería de Software (`v1.6.0`):**
   - **Backend Java:** `21/21` pruebas unitarias aprobadas (`BUILD SUCCESS`, incluyendo pruebas de fallback `OmniRoute → OpenAI → Groq`, Ollama local sin clave, `LoginRateLimiter`, `JwtService`, `WebIntelExtractorService` y `PdfChunkExtractor`) + suite de integración Testcontainers para flujos multi-tenant y gateway.
   - **Frontend & Escritorio:** `oxlint` con **0 errores** y **`23/23` pruebas de escritorio aprobadas** (`dockerOrchestrator.test.js`, `validators.test.js`, `api.test.js`).
   - **Worker Python:** suite automatizada verificando seguridad SQLite, autenticación interna, verificador de enlaces y honestidad forense.
   - **CI/CD y Supply Chain (`.github/workflows/release-desktop.yml`, `supply-chain-audit.yml`):** cada etiqueta `v*` verifica los SHA-256 del corpus, compila NSIS + Portable `.exe`, genera `SHA256SUMS.txt` y firma **atestación de procedencia Sigstore / SLSA** verificable con `gh attestation verify`.

---

## Bloque 7 — Respuestas Preparadas a Preguntas Difíciles del Jurado (`26:30 – 30:00`)

1. ***"¿Por qué usan dos backends (Java 21 + Python FastAPI) en vez de uno solo?"***
   > *"Separación de responsabilidades y superficie de ataque mínima: Java maneja seguridad transaccional, JWT, multi-tenancy, JPA/PostgreSQL e ingestión controlada; Python aporta el ecosistema maduro de análisis forense móvil/YARA/SQLite en un contenedor sin estado (`omega_forensic_worker`) aislado sin red externa ni puerto público."*

2. ***"Si un usuario descarga el `.exe`, ¿cómo consigue clave de IA? ¿Por qué no la embeben en el instalador?"***
   > *"Embeber una clave secreta dentro de un `.exe` Electron permite extraerla en segundos inspeccionando el `app.asar`. Por eso diseñamos el flujo **Plug Any AI**: guía integrada de 1 minuto para Groq gratuito por defecto, o conexión inmediata con **Ollama local (0 llaves, 0 internet)**, Gemini, OpenAI, OpenRouter o API corporativa `/v1`."*

3. ***"¿Cómo garantizan que un PDF subido no quede en el servidor ni envenene al LLM?"***
   > *"Doble garantía: (1) el PDF entra a un `tmpfs` estrictamente en RAM (`noexec,nosuid`), se extraen fragmentos y hash SHA-256 y se purga el archivo fuente al instante (`temp_deleted_at`); (2) los fragmentos pasan al modelo dentro de delimitadores `<FRAGMENTO_NO_CONFIABLE>` tratados como datos pasivos de solo lectura."*

4. ***"¿Por qué el verificador dice '0 coincidencias' en vez de 'Dispositivo 100% limpio'?"***
   > *"Por rigor ético y técnico en ciberseguridad (`RNF9`): ningún análisis en espacio de usuario contra indicadores históricos hasta una fecha de corte puede demostrar ausencia de exploits zero-day en kernel. Declarar falsamente '100% limpio' daría una falsa sensación de seguridad a víctimas de alto riesgo."*

5. ***"¿Qué pasa si un atacante intenta usar el extractor web o el botón 'Probar conexión IA' para escanear su red interna (SSRF)?"***
   > *"En `WebIntelExtractorService.java` anclamos la conexión TCP/TLS directamente a la IP pública ya validada evitando DNS Rebinding; y en `SystemController.java` (`/api/v1/system/ai-test`) bloqueamos explícitamente esquemas no-HTTP, metadatos cloud (`169.254.*`, `metadata.google.internal`) y servicios internos como `postgres` o `forensic-worker`."*

---

**Documentación complementaria de soporte:**
- [Matriz de Trazabilidad de Requisitos (`matriz_trazabilidad.md`)](matriz_trazabilidad.md)
- [Declaración Ética y Alcance (`declaracion_etica.md`)](declaracion_etica.md)
- [Reporte de Ablación RAGAS (`ablation_report_v1.md`)](../rag_engine/eval/ablation_report_v1.md)
- [Historial de Entregas (`CHANGELOG.md`)](../../CHANGELOG.md)
