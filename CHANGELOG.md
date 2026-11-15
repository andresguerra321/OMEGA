# Changelog — OMEGA

Todas las entregas relevantes de arquitectura, seguridad y calidad verificada del proyecto se registran aquí siguiendo versionado semántico.

## [1.3.0] - 2026-11-14

### Compuerta de Autenticación Obligatoria & Escena Orbital
- **Bloqueo integral sin sesión activa (`AuthModulePanel.jsx`, `OmegaAuthBackdrop.jsx`, `AuthService.java`, `AuthController.java`):** Toda la plataforma requiere inicio de sesión previo; soporte de autenticación solo con correo y contraseña cuando la cuenta es única sin exigir `tenantSlug` manual, recuperación de contraseña asistida, animaciones Tailwind y acceso demo en 1 clic (`admin@omega.local` / `OmegaDemo!2026`).

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
