![OMEGA v2.0.5 — Visualización de Marca](docs/assets/omega-v2-release-banner.jpg)

# Changelog — OMEGA

Todas las entregas relevantes de arquitectura, seguridad y calidad verificada del proyecto se registran aquí siguiendo versionado semántico.

## [2.0.5] - 2026-11-19

### Arranque inmediato sin cuenta + detección y sincronización automática de `.env` en el `.exe`
- **Detección e inyección automática de `.env` desde Tauri (`env_loader.rs`, `docker_bootstrap.rs`):** sin empaquetar secretos dentro del instalador, localiza el archivo `.env` local (`OMEGA_ENV_FILE`, directorio del `docker-compose.yml`, `app_data_dir/.env`, ancestros `omega/.env`, `~/.omega/.env` o etiqueta `working_dir` de contenedores OMEGA previos), fusiona `GROQ_API_KEY`, `GROQ_MODEL`, `OMEGA_SMTP_*` y claves de reputación preservando los secretos efímeros locales y las anulaciones de Ajustes, y verifica una huella determinista (`env_fingerprint`) en `built-images.json` para recrear automáticamente los contenedores cuando `.env` cambie.
- **Acceso local directo sin crear cuenta (`AuthController.java`, `AuthService.java`, `OmegaProperties.java`, `SecurityConfig.java`, `App.jsx`, `AuthModulePanel.jsx`):** nuevo endpoint `POST /api/v1/auth/local-session` (deshabilitado por defecto en producción/Java puro, habilitado en modo local `OMEGA_LOCAL_ACCESS_ENABLED=true`, protegido contra `X-Forwarded-For` y aislado en su propio tenant `espacio-local`). Al abrir OMEGA en modo local, entra directo al espacio operativo para usar chat, verificador de enlaces, análisis de PC, USB/MVT y OSINT sin registro previo, conservando botón de acceso directo y creación de cuentas multi-tenant bajo demanda.
- **Versionado sincronizado a `2.0.5`:** manifiestos frontend/Tauri/sensor Rust y notas en [v2.0.5](.github/release-notes/v2.0.5.md).

## [2.0.4] - 2026-11-19

### Arranque local completo tras instalar el `.exe` (validación de imágenes, Ajustes IA/SMTP y UX sin correo)
- **Validación de versión e imágenes cacheadas (`docker_bootstrap.rs`):** antes de reutilizar `:8080`, verifica la etiqueta `io.omega.version`, el estado `healthy` de `omega_forensic_worker` y el marcador `built-images.json`; si había imágenes antiguas cacheadas (como compilaciones previas sin `/app/healthcheck.py`), fuerza `--build` automáticamente conservando el volumen de PostgreSQL.
- **Configuración local persistente en Tauri (`desktop_config.rs`, `SettingsPanel.jsx`, `desktopBridge.js`):** guarda proveedor de IA (Groq, Ollama Soberano Local, Gemini, OpenAI, OmniRoute) y servidor SMTP opcional dentro de `app_data_dir/desktop-config.json` (sin exponer secretos al frontend ni tocar archivos `.env` del repo) y recarga únicamente `forensic-worker` + `backend-java` al aplicar cambios.
- **Puerta de acceso y recuperación honesta en modo local (`AuthController.java`, `AuthModulePanel.jsx`):** `GET /api/v1/auth/config` expone `smtpConfigured`; la pestaña de recuperación avisa con claridad cuando no hay SMTP configurado (evitando esperar un correo que solo queda en `docker logs`) y durante el arranque inicial muestra el estado de preparación de contenedores en lugar de una falsa alarma de desconexión.
- **Versionado sincronizado a `2.0.4`:** actualizados manifiestos frontend/Tauri/sensor Rust y notas en [v2.0.4](.github/release-notes/v2.0.4.md).

## [2.0.3] - 2026-11-19

### Arranque autónomo Docker en el instalador Tauri y sincronización de versión
- **Bootstrap autónomo de contenedores desde la app instalada (`docker_bootstrap.rs`, `lib.rs`):** generación segura y persistente una sola vez de `INTERNAL_SERVICE_TOKEN` y `OMEGA_JWT_SECRET` mediante `getrandom` en `app_data_dir`, resolución de rutas `\\?\` en Windows y ejecución exclusiva de los servicios `postgres`, `forensic-worker` y `backend-java` (sin levantar el contenedor web redundante) con timeout extendido de primer arranque (`20 min`) y prevención de ejecuciones concurrentes.
- **Empaquetado de recursos Self-Hosted (`stage_desktop_resources.py`, `tauri.conf.json`, `release-desktop.yml`):** staging limpio de `docker-compose.yml`, `db/init.sql`, `api/`, `backend-java/` y `corpus_mvp/` dentro de los recursos del instalador Tauri v2 (sin `.env` ni artefactos locales).
- **Visibilidad y reconexión en UI (`useDesktopBootstrap.js`, `DesktopBootstrapBanner.jsx`, `App.jsx`):** banner de estado durante el arranque/error del stack Docker con botón **Reintentar** y revalidación inmediata del gateway vía evento `omega:backend-ready`.
- **Sincronización de versión a `2.0.3`:** unificados `package.json`, `package-lock.json`, `tauri.conf.json`, `src-tauri/Cargo.toml`, `sensor-rust/Cargo.toml`, sus `Cargo.lock` y la versión reportada por el cliente. Notas de lanzamiento en [v2.0.3](.github/release-notes/v2.0.3.md).

## [2.0.2] - 2026-11-18

### USB nativo, CORS y protección CSRF
- Restaurada la conexión de `MvtVerifierPanel` con los comandos Tauri de detección y captura USB Android/iOS, selección/instalación de ADB y lectura de respaldos iOS normales y cifrados.
- Alineados los orígenes Tauri del backend Java y retirado `null` de los valores predeterminados de CORS.
- Activada la protección CSRF para las operaciones web sin Bearer, incluidos los endpoints públicos de autenticación; el cliente obtiene y envía automáticamente el token.
- Autenticación Bearer sin recurrir a cookies ante encabezados inválidos y modo explícito sin cookies para Tauri.
- Añadidas pruebas CORS/CSRF y un workflow Java 21 que bloquea el release si fallan. Validadas 88 pruebas Java y 36 del frontend.
- Sincronizada la versión de frontend, shell Tauri y sensor Rust a `2.0.2`. Notas y visuales oficiales en [v2.0.2](.github/release-notes/v2.0.2.md).
- Pendiente la validación con dispositivos físicos y respaldos reales por el usuario.

## [2.0.1] - 2026-11-18

### Seguridad DevSecOps, Hardening CI/Docker y Unificación de Versión
- **Pipeline SAST (`CodeQL v4` + `Semgrep` + Gate fail-closed):** integrado análisis multi-lenguaje (`java-kotlin`, `python`, `javascript-typescript`, `actions`) con CodeQL `security-extended`, Semgrep OWASP + reglas propias de OMEGA en [`.semgrep/omega-rules.yml`](.semgrep/omega-rules.yml) y evaluador por `context_sha256` en [`.github/scripts/evaluate_semgrep_gate.py`](.github/scripts/evaluate_semgrep_gate.py) con pruebas unitarias obligatorias en CI.
- **Cadena de suministro inmutable en CI/CD:** las 32 referencias de acciones en `.github/workflows/*.yml` quedaron fijadas a SHAs de commit de 40 caracteres verificados con actualización semanal vía [`.github/dependabot.yml`](.github/dependabot.yml).
- **Contenedor frontend no privilegiado (`omega/frontend/Dockerfile`, `nginx.conf`, `docker-compose.yml`):** migrado a `nginxinc/nginx-unprivileged:1.27-alpine` (`USER 101`, puerto interno `8080`, `server_tokens off`, cabecera proxy `Host backend-java:8080` y mapeo `5173:8080` en Compose).
- **Versionado unificado a `2.0.1`:** sincronizados `omega/frontend/package.json`, `package-lock.json`, `tauri.conf.json`, `src-tauri/Cargo.toml`, `sensor-rust/Cargo.toml` y defaults del sensor.
- **Documentación y notas de lanzamiento:** guía operativa en [`docs/sast-security.md`](docs/sast-security.md) y notas visuales en [`.github/release-notes/v2.0.1.md`](.github/release-notes/v2.0.1.md).

## [2.0.0] - 2026-11-18

### Escritorio Nativo Tauri v2 + Sensor Residente Rust (Fase 9)
- **Sensor nativo `omega-sensor` (`omega/sensor-rust/`):** binario estático de ~256 KB con telemetría de procesos/memoria, detector **Anti-Infostealer** nativo y firma/verificación **HMAC-SHA256**.
- **Shell Desktop Tauri v2 (`omega/frontend/src-tauri/`):** instaladores nativos Windows `.exe` (NSIS, ~3.5 MiB) y `.msi` (WiX, ~4.8 MiB) con auto-orquestación Docker (`docker_bootstrap.rs`) en modo `SELF_HOSTED` por defecto y cambio automático a `CLOUD_MANAGED` cuando `OMEGA_BACKEND_URL=https://...` está definida.
- **Índice local privado de PDFs (`pdf_vault_index.rs`):** mapeo local `(documentId, sha256) -> ruta PDF original` en `app_data_dir()` para abrir citas en página exacta y reindexar en 1 clic sin almacenar PDFs en el servidor, reforzado con advertencia legal explícita en `ForensicDossierExportService.java`.
- **Pipeline de CI actualizado (`.github/workflows/release-desktop.yml`):** job `build-tauri-v2` con `cargo test`, compilación release de `omega-sensor` y empaquetado Tauri v2 multiplataforma.

### Capa Comercial SaaS, Cuotas IA y Alertas Críticas (Fase 8)
- **Migración Flyway `V8__commercial_saas_fleet_and_alerts.sql`:** tablas `subscriptions`, `devices`, `ai_usage_quotas` y `alert_dispatches` con claves foráneas compuestas `(tenant_id, user_id)`.
- **Cuotas IA aplicadas de punta a punta:** `CommercialSaasService.consumeAiQuota()` conectado a `HybridRagQueryService` y `MultimodalThreatQueryService` (tope mensual para OpenAI/Vision en la nube; **Modo Soberano Ollama siempre ilimitado**).
- **Despacho automático de alertas fuera de banda (`AlertDispatcherService`):** conectado a hallazgos críticos de `OsintExposureService`, `HostSensorBridge` y ejecuciones reales de `ContainmentBridge` vía Webhook HTTPS (anti-SSRF) y Telegram Bot API.
- **UX dual (`Modo Escudo` vs. `Modo Laboratorio`) + `SaasFleetCard.jsx`:** navegación simplificada para usuarios finales/ejecutivos y suite forense completa para analistas/legal.

### Fidelidad Anti-Pegasus y Protección Diaria (Fase 7)
- **Soporte completo de `sysdiagnose` iOS (`.tar.gz`):** extracción en streaming anti-Zip-Slip + Zero-Retention con analizadores para `shutdown.log`, `DataUsage.sqlite`, perfiles `.mobileconfig` (root CA/MDM) y crash logs `.ips` zero-click.
- **USB portable y Android profundo (`usb_device_connector.py`):** `resolve_portable_tool()` para `adb`/`libimobiledevice` empaquetados y auditoría de servicios de Accesibilidad abusivos y perfiles MDM.
- **Escudo diario Anti-Infostealer (`infostealer_shield.py` + `GET /api/host/infostealer/scan`):** vigilancia de accesos no firmados a credenciales de navegador, llaves SSH y `.env` (filtrando cookies propias de apps Electron y `.env.example`).
- **Verificación Ed25519 de feeds CTI (`SignedFeedVerifier.java`):** política fail-closed antes de ingerir feeds externos en `ExternalIocFeedSyncService.java`.

### Limpieza Arquitectónica y Blindaje SAST (Fase 6)
- División de `ForensicBridgeService.java` en 4 puentes especializados (`HostSensorBridge`, `ContainmentBridge`, `MobileUsbBridge`, `MvtTriageBridge`), modularización de `containment_engine.py` (`firewall_adapters.py`, `quarantine_vault.py`, `process_controller.py`), volumen persistente `omega_quarantine_vault` en `docker-compose.yml` y gate continuo de `vice-security` en `.github/workflows/supply-chain-audit.yml`.

## [1.6.0] - 2026-11-16

### Selector Universal de IA ("Trae tu propia API" · Nivel Comercial)
- **Soporte desacoplado de proveedor personal (`OmegaProperties.java`, `application.yml`, `OpenAiRagAnswerGenerator.java`, `docker-compose.yml`):** nuevas variables `CUSTOM_LLM_PROVIDER`, `CUSTOM_LLM_BASE_URL`, `CUSTOM_LLM_API_KEY` y `CUSTOM_LLM_MODEL` completamente separadas de `OPENAI_BASE_URL` de embeddings, con `host.docker.internal:host-gateway` para Ollama/LM Studio y cadena automática de respaldo (`Proveedor personal → OmniRoute → OpenAI → Groq → Extractivo`).
- **Endpoint seguro `"Probar conexión"` (`POST /api/v1/system/ai-test` en `SystemController.java`):** verifica latencia real y lista los modelos detectados (`/models` con fallback a ping de chat) bloqueando destinos internos/metadata contra SSRF (`postgres`, `forensic-worker`, `169.254.*`, esquemas no-HTTP).
- **UI comercial en Ajustes y Chat (`SettingsPanel.jsx`, `ChatWorkspace.jsx`, `api.js`):** selector visual con presets listos para **Groq (por defecto)**, **Ollama local (sin API key)**, **Gemini**, **OpenRouter**, **OpenAI**, **LM Studio**, **OmniRoute** y **API personalizada (`/v1`)**, chips de modelos sugeridos/detectados y botón **Probar conexión** antes de guardar.
- **Orquestador Desktop (`dockerOrchestrator.js`):** lectura/escritura segura de configuraciones personalizadas desde Electron IPC y limpieza al cambiar de proveedor.

## [1.5.1] - 2026-11-16

### Asistente Paso a Paso de IA (BYOK sin consola) & OmniRoute
- **Asistente guiado en Ajustes y aviso en Chat (`SettingsPanel.jsx`, `ChatWorkspace.jsx`, `SystemController.java`, `App.jsx`):** cuando una instalación nueva aún no tiene clave de IA configurada, el Chat muestra un acceso directo a **Ajustes → Motor de IA**, donde el usuario encuentra el paso a paso para crear su clave gratuita en Groq (~1 min), pegarla y activar el motor en 1 clic sin editar archivos `.env` ni abrir consola.
- **Puente IPC seguro en Electron (`dockerOrchestrator.js`, `main.js`, `preload.cjs`):** `getAiEngineConfig()` (solo estado y sufijo enmascarado) y `reapplyAiConfig()` (sanitización anti-inyección en `.env`, escritura con permisos locales y recarga automática de `backend-java`).
- **Router multi-proveedor opcional OmniRoute (`OmegaProperties.java`, `OpenAiRagAnswerGenerator.java`, `docker-compose.yml`):** soporte para `OMNIROUTE_BASE_URL` / `OMNIROUTE_API_KEY` / `OMNIROUTE_MODEL` (`auto`) con cadena automática de respaldo `OmniRoute → OpenAI → Groq → Extractivo`, contenedor `omega_omniroute` bajo el perfil `omniroute` (`127.0.0.1:20128`) y activación automática en `DockerOrchestrator`.

## [1.5.0] - 2026-11-16

### Motor RAG, Síntesis con Groq & Calidad de Respuestas
- **Soporte dual OpenAI / Groq (`OmegaProperties.java`, `application.yml`, `OpenAiRagAnswerGenerator.java`):** cuando `OPENAI_API_KEY` está vacío y `GROQ_API_KEY` está configurado, OMEGA usa Groq (`/chat/completions`, `openai/gpt-oss-120b` por defecto) en lugar de caer al resumen extractivo crudo, manteniendo los delimitadores `<FRAGMENTO_NO_CONFIABLE>` y el alcance documental (`RNF9`).
- **Context box y normalización de citas (`OpenAiRagAnswerGenerator.java`):** numeración `[1]`..`[N]` de fragmentos recuperados, instrucciones estrictas para definiciones directas y viñetas ordenadas sin volcar `CONTENTS` ni listados crudos de SMS en preguntas conceptuales, y normalización de corchetes `【1】` / `[2, 3]` a `[1]`, `[2][3]` clicables.
- **Re-ranking CTI anti-ruido (`PublicCorpusRagService.java`):** ventana ampliada de candidatos, penalización de ruido estructural (`TOC` / trazas Appendix C) en consultas conceptuales y diversificación por reporte.

### Escritorio `.exe`, Arranque & Orquestación Docker
- **Validación automática de versión al actualizar (`dockerOrchestrator.js`):** registro `omega-desktop-state.json` en `userData`; si el usuario abre una versión nueva (`1.4.0 → 1.5.0`) con contenedores anteriores activos, reconstruye automáticamente (`up -d --build`) conservando volúmenes y secretos.
- **Corrección de aprovisionamiento y salud (`dockerOrchestrator.js`, `main.js`, `docker-compose.yml`):** se deja de autogenerar `OMEGA_BOOTSTRAP_SECRET` en instalaciones locales, se sincroniza `.env` en `userData`, se añade fallo rápido ante servicios en bucle `restarting` y se agilizan los intervalos de healthcheck.
- **Eclipse Orbital Loader y transición fluida (`splash.html`, `OmegaLoader.jsx`, `App.jsx`):** pantalla de carga Canvas 2D a 60 FPS tanto al abrir la app como al iniciar sesión, sin parpadeos.
- **Tour interactivo inicial (`OnboardingTourModal.jsx`):** guía de 5 pasos al crear cuenta nueva, re-abrible desde `Guía`.

### Auditoría UI/UX & Simplicidad
- **Limpieza de jerga y avisos repetidos (`AuthModulePanel.jsx`, `StructuredResponse.jsx`, `ChatWorkspace.jsx`, `SettingsPanel.jsx`, `OmegaWebIntelCard.jsx`, `MvtVerifierPanel.jsx`, `CampaignsPanel.jsx`):** retirado el cartel técnico redundante de `localStorage / HttpOnly / Passkeys`, el indicador `GATEWAY · EN LÍNEA`, el pie duplicado de alcance documental y etiquetas internas (`RNF*`, `RF7`, `JWT HS256`, `Bootstrap Secret`) en textos orientados al usuario.

## [1.4.0] - 2026-11-16

### Seguridad y Honestidad Forense
- **Sesión con cookie `HttpOnly` / `SameSite=Strict` (`SessionCookieHelper.java`, `AuthController.java`, `JwtAuthenticationFilter.java`):** el navegador y la app de escritorio dejan de guardar el JWT en `localStorage`; `OMEGA_COOKIE_SECURE` controla el atributo `Secure` (`false` en desarrollo, `true` en producción). Se mantiene el acceso sin credenciales demo fijas en la interfaz (primer ingreso vía **Crear cuenta**).
- **Frescura del catálogo CTI y alcance por sistema operativo (`cti_db.py`, `forensic_scope.py`):** los veredictos informan la fecha de corte del catálogo y evitan afirmar inmunidad absoluta; el manifiesto STIX se monta en modo lectura dentro del worker.
- **Integridad de corpus y cadena de suministro (`corpus_integrity.py`, `cti-feed-review.yml`, `release-desktop.yml`, `supply-chain-audit.yml`):** verificación SHA-256 con fallo cerrado de PDFs y bundles STIX, y construcción de instaladores en CI con atestación de procedencia.

### Interfaz y Marca
- **Animaciones con Framer Motion:** transiciones entre vistas, subrayado deslizante en la navegación, mensajes de chat con resorte, tarjetas escalonadas, y cierre animado del cajón del copiloto y del modal de acceso; respeta `prefers-reduced-motion`.
- **Pantalla de carga (`OmegaLoader.jsx`):** esfera de OMEGA con anillos orbitales, ondas de pulso y barra de progreso.
- **Nuevo logo e ícono de la app:** esfera de cristal con Ω azul (`omega/frontend/build/icon.svg`, `icon.png`, `icon.ico` con 7 resoluciones) aplicada también dentro de la interfaz.

### Empaquetado
- Los instaladores `.exe` dejan de versionarse en Git y se publican como asset de GitHub Release; el nombre de los archivos sigue ahora la versión del proyecto (`OMEGA-Setup-1.4.0-x64.exe`, `OMEGA-Portable-1.4.0-x64.exe`). Los instaladores no están firmados con un certificado comercial.

## [1.3.1] - 2026-11-15

### Seguridad en Profundidad (`backend-java` & `omega/api`)
- **Protección contra fuerza bruta en `/api/v1/auth/login` (`LoginRateLimiter.java`, `AuthService.java`, `GlobalExceptionHandler.java`):** Bloqueo progresivo tras `5` intentos fallidos por combinación IP + usuario y techo de `25` fallos por IP dentro de una ventana de `15` minutos, devolviendo HTTP `429 Too Many Requests` con cabecera `Retry-After` sin filtrar datos sensibles en bitácora.
- **Mitigación de DNS Rebinding en extractor web CTI (`WebIntelExtractorService.java`):** Conexión TCP/TLS anclada directamente a la IP pública ya validada mediante socket factory fijado conservando cabecera `Host` y SNI original en cada salto de redirección (sin re-resolución DNS tardía).
- **Blindaje SQLite y trazabilidad de errores en worker forense (`triage_orchestrator.py`, `behavioral_forensics.py`, `temporal_correlator.py`, `deep_forensics.py`, `ios_backup_crypto.py`):** Validación estricta de identificadores de tabla mediante lista blanca (`safe_identifier`) contra nombres maliciosos en respaldos SQLite no confiables y reemplazo de seis `except Exception: pass` silenciosos por registro explícito `logger.debug`.

### Correcciones Críticas de Ingesta, Pruebas & Build
- **Corrección de conteo de fragmentos en ingesta Zero-Retention (`AsyncDocumentProcessor.java`):** Solucionado fallo donde `Boolean.TRUE.equals(transactionTemplate.execute(...))` comparaba `Boolean` contra el `Integer` retornado por la transacción, registrando siempre `persistedChunks = 0` en auditoría.
- **Limpieza estática Java & Maven (`pom.xml`, `OsintExposureService.java`, excepciones, suite de integración):** Declarado `<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>`, añadidos `serialVersionUID` en excepciones de dominio, corregido cierre de stream no-2xx en `crt.sh`, eliminados avisos de fugas en contenedores Testcontainers y reparado el helper `FrontendGatewayIntegrationTest`.
- **Optimización de fuentes web (`omega/frontend/src/main.jsx`):** Eliminados subconjuntos muertos (cirílico, griego, vietnamita), conservando únicamente `latin` y `latin-ext` (32 archivos tipográficos).

### Evaluación RAGAS Corregida & Identidad Visual
- **Corrección de arnés RAGAS (`eval_common.py`, `run_ablation_benchmark.py`):** Reconstrucción completa de página (`(report_id, page_number)`), frases CVE exactas + expansión bilingüe para `pg_catalog.simple`, normalización `【#】 -> [#]` y evaluación sin truncamiento; eliminando el `Faithfulness = 0.0` previo (`0.2036` Baseline -> **`0.6`** Omega V1.0 en 5/7 válidas, `Hit@3/Hit@5 = 85.7%`, citas inline `85.7%`, `RNF1 = 100.0%`).
- **Identidad de marca (`img/banner.png`) y Releases Windows:** Incorporación del banner visual oficial en toda la documentación y notas de lanzamiento junto con los ejecutables `OMEGA-Setup-1.0.0-x64.exe` y `OMEGA-Portable-1.0.0-x64.exe`.

## [1.3.0] - 2026-11-14

### Compuerta de Autenticación Obligatoria & Escena Orbital
- **Bloqueo integral sin sesión activa (`AuthModulePanel.jsx`, `OmegaAuthBackdrop.jsx`, `AuthService.java`, `AuthController.java`):** Toda la plataforma requiere inicio de sesión previo; soporte de autenticación solo con correo y contraseña cuando la cuenta es única sin exigir `tenantSlug` manual, recuperación de contraseña asistida y animaciones Tailwind *(el acceso demo en 1 clic con `admin@omega.local` introducido inicialmente en v1.3.0 fue retirado posteriormente al eliminar credenciales fijas de la UI)*.

### Empaquetado Nativo Windows (`.exe` Setup + Portable)
- **Instalador NSIS y ejecutable portable (`omega/frontend/release/`):** Generación de `OMEGA-Setup-1.0.0-x64.exe` y `OMEGA-Portable-1.0.0-x64.exe` con orquestación automática de Docker Compose e íconos nativos (`omega/frontend/build/icon.ico`, `icon.png`).

### Blindaje Integral Anti-Falla y Anti-Clic Compulsivo
- **Validación estricta sincronizada (`validators.js`, `useSingleFlight.js`, `ValidationPatterns.java`, `OsintExposureService.java`, `link_verifier.py`):** Rechazo consistente en frontend, gateway Java y worker Python contra entradas basura (como `akjriuqw2iu3i3123.2.q..qw..wqe.r.34`), límites `maxLength`, sanitización en tiempo real y bloqueo `useSingleFlight` frente a envíos o clics duplicados en formularios, chat, OSINT, enlaces y verificador MVT.

### Simplificación Editorial & Chatbot Glassmorphism
- **Interfaz enfocada (`ChatWorkspace.jsx`, `CopilotDrawer.jsx`):** Reducción de texto innecesario distribuido entre módulos y superficie conversacional en vidrio esmerilado oscuro.

## [1.2.0] - 2026-11-14

### Integración Gateway Frontend–Backend & Seguridad Operativa
- **Gateway unificado en Java (`omega/backend-java`):** Nuevos controladores y servicios (`OsintController`, `SystemController`, `CtiDossierService`, `PublicCorpusRagService`, `WebIntelExtractorService`, `OsintExposureService`) integrados con `CtiCatalogController`, `ForensicController`, `AuthController`, `ForensicBridgeService` y `omega/api/detection_engineering.py`, más suite `FrontendGatewayIntegrationTest`.
- **Persistencia multi-tenant OSINT con consentimiento (`V4__osint_monitored_assets_rag.sql`):** Tabla `omega_rag.osint_monitored_assets` con restricción `CHECK (explicit_consent = TRUE)` y clave foránea compuesta por `(tenant_id, user_id)`.
- **Autenticación JWT, Expedientes y Proxy Compose:** Sesión multi-tenant y gestión de expedientes en `omega/frontend/src/lib/api.js` y `AuthModal.jsx`, más servicio `frontend` en `omega/docker-compose.yml` y enrutamiento Nginx/Vite hacia `backend-java:8080`.

### Auto-Orquestación Desktop (Electron)
- **Ciclo de vida automático del backend (`omega/frontend/electron/dockerOrchestrator.js`, `main.js`, `preload.cjs`, `launch.js`):** Arranque y apagado controlado de Docker Compose al abrir/cerrar Electron con generación segura de secretos faltantes, redacción de credenciales en logs, pantalla de carga `splash.html` y pruebas `dockerOrchestrator.test.js` (`6/6`).

### Sistema Visual Dark Glassmorphism (`DESIGN.md`)
- **Identidad "vidrio esmerilado sobre panel de control nocturno":** Lienzo `#0A0A0C` con rejilla punteada (`24px`) y film grain (`2.5%`), paneles translúcidos biselados (`rgba(20, 20, 24, 0.55)` + `backdrop-filter: blur(16px)`), estado activo/hover `rgba(28, 36, 56, 0.65)`, texto `#F2F2F4` / `#9A9AA2`, consolidación del acento único `#2F6FED` y presupuesto estricto de `<= 3–4` capas `backdrop-filter` simultáneas por vista con soporte para `prefers-reduced-transparency` y contraste WCAG AA verificado sin hallazgos en `impeccable`.

## [1.1.0] - 2026-11-14

### Seguridad y Resiliencia
- **Validación `prod` de token interno (`RestClientConfig`):** El arranque falla explícitamente en perfiles `prod`/`production` si `INTERNAL_SERVICE_TOKEN` conserva el marcador de desarrollo o mide menos de 32 caracteres.
- **Override fail-closed de producción (`omega/docker-compose.prod.yml`):** Exige secretos obligatorios (`POSTGRES_PASSWORD`, `OMEGA_JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`) sin valores por defecto y deshabilita el autoregistro abierto de tenants.
- **Degradación léxica controlada (`HybridRagQueryService` + `HybridRagSearchRepository`):** Cuando el proveedor remoto de embeddings no responde (`EmbeddingException`), las consultas RAG degradan automáticamente a búsqueda léxica pura (`tsvector` GIN en PostgreSQL) manteniendo aislamiento multi-tenant, citas verificables y registro en `audit_logs` (`DEGRADED_LEXICAL`).
- **Divulgación responsable y cadena de suministro:** Añadido `/.well-known/security.txt` (RFC 9116), flujo de CI `.github/workflows/supply-chain-audit.yml` (`npm audit`, `pip-audit`, CycloneDX SBOM Java) y script local `omega/scripts/supply_chain_audit.ps1`.

### Evaluación y Documentación
- **Evaluación RAGAS:** Benchmark corregido sobre 13 casos del corpus real (`10/10` métricas válidas; `Context Precision` de `0.4333` a `0.5575`, `Faithfulness` de `0.5375` a `0.6`, `Hit@3` de `50.0%` a `70.0%` con fusión híbrida RRF) y reconciliación de documentación técnica (`README.md`, `requerimientos.md`, `DESIGN.md`, `omega/docs/`).

### Experiencia de Investigación Conectada
- **Flujo continuo entre módulos:** Conexión directa de hallazgos existentes entre `Amenazas`, `Equipos`, `Mi exposición` y `Enlaces` (inspeccionar dominios/subdominios/IOCs sin peticiones HTTP activas, saltar a auditoría OSINT con consentimiento explícito y abrir expedientes de campaña sin añadir funcionalidades nuevas).
- **Transparencia de datos y estados de UI:** Ficha legible de custodia Zero-Retention en `Ajustes`, estados unificados de carga/error/vacío/confirmación y consolidación visual de 3 tonos de azul.

## [1.0.0] - 2026-11-14

### Arquitectura Base Verificada
- **Core Java 21 / Spring Boot 3.3.5 (`omega/backend-java`):** Multi-tenancy estricto, JWT `HS256`, RBAC (`ADMIN`/`ANALYST`/`CLIENT`), ACL por expediente anti-IDOR, ingesta PDF *Zero-Retention* sobre `tmpfs` con PDFBox/Tess4J, RAG híbrido HNSW + `tsvector` RRF y bitácora inmutable encadenada con SHA-256 (`omega_rag.audit_logs`).
- **Worker Forense Stateless (`omega/api`):** Microservicio aislado en `omega-private` autenticado por `X-Internal-Service-Token`, procesamiento en RAM de dumps MVT, copias cifradas de iOS (`:memory:`), YARA, heurísticas conductuales y verificación pasiva de enlaces.
