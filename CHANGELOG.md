# Changelog — OMEGA

Todas las entregas relevantes de arquitectura, seguridad y calidad verificada del proyecto se registran aquí siguiendo versionado semántico.

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
