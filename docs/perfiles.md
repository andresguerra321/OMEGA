# Perfiles de Tenant en OMEGA (`GENERAL`, `DEVELOPER`, `LEGAL`)

Los perfiles adaptan la presentación, la vista inicial y el alcance del corpus RAG según el caso de uso del espacio de trabajo (**tenant**).

## 1. Qué cambia según el perfil

La configuración `1.1.0` vive en `omega/backend-java/src/main/resources/profile-configs.json` y se expone mediante `GET /api/v1/profile/config`:

| Perfil | Vista inicial (`defaultView`) | Módulos visibles (`visibleModules`) | Alcance RAG (`ragCorpusScope` / `corpus_scope`) | Enfoque del copiloto |
| --- | --- | --- | --- | --- |
| `GENERAL` | `inicio` | `inicio`, `equipo`, `exposicion`, `amenazas`, `preguntar`, `cuenta` | `general_cti` (sin filtro restrictivo sobre corpus general) | Comportamiento defensivo estándar de OMEGA (spyware, CTI y verificación pasiva). |
| `DEVELOPER` | `repo_scanner` | Módulos estándar + `repo_scanner` | `dev_supply_chain_cti` (`DEVELOPER`) | Análisis estático de repositorios, dependencias y puntaje explicable. Nunca afirma "repo seguro"; usa *"Sin señales detectadas con las reglas actuales"*. |
| `LEGAL` | `expedientes` | `expedientes`, `preguntar`, `cuenta`; `seguridad_despacho` está configurado, pero permanece oculto hasta LM | `legal_expedientes` (`LEGAL`) | Instrucciones de lenguaje formal y citas de documentos privados. |

GENERAL y DEVELOPER conservan sus valores anteriores; `dev_cli` sigue oculto. La vista inicial de Expedientes ofrece una lista de lectura con estados de carga, error y vacío. La gestión completa del expediente corresponde a los bloques posteriores.

## 2. Qué nunca cambia

- **Aislamiento multi-tenant:** Un tenant jamás puede leer datos, expedientes, documentos ni hallazgos de otro tenant al cambiar de perfil.
- **RBAC:** Los roles `ADMIN`, `ANALYST` y `CLIENT` siguen gobernando los permisos en todos los endpoints.
- **Gestión de acceso:** Solo el propietario o ADMIN puede conceder, listar o revocar permisos de un expediente. WRITE no permite administrar acceso. Crear expedientes y conceder, cambiar o revocar permisos genera auditoría sin títulos, nombres ni correos en los metadatos de esas acciones.
- **Cambio de perfil:** Solo `ADMIN` puede ejecutar `PUT /api/v1/profile` con `confirmed: true`. La acción se registra en `audit_logs` (`TENANT_PROFILE_CHANGED`). Al entrar o salir de LEGAL se sincroniza `corpus_scope` de sus documentos dentro de la misma transacción, sin borrar contenido. El bloqueo del tenant coordina cambios de perfil y altas de documentos.
- **Alertas críticas:** Las alertas de seguridad críticas y la pestaña `cuenta` nunca se ocultan por perfil.

## 3. Cómo añadir un perfil futuro

1. Añadir el valor al enum `TenantProfile` en `omega/backend-java/src/main/java/com/omega/platform/domain/TenantProfile.java`.
2. Crear una migración Flyway que amplíe las restricciones `CHECK` en `profile` (de `V11__tenant_profile.sql`) y `corpus_scope` (de `V12__corpus_scope.sql`).
3. Agregar la entrada correspondiente en `omega/backend-java/src/main/resources/profile-configs.json`.
4. Si introduce un nuevo módulo UI, registrarlo en `SpatialNavPill.jsx` y `App.jsx`.

## 4. Límites conocidos y capacidades completas por rol

- **Perfil `DEVELOPER` completo:** documentado en detalle en [docs/developer_producto.md](developer_producto.md) (Proyectos, Hallazgos y Triaje, Dependencias y SBOM CycloneDX 1.5 / SPDX 2.3, Políticas, Inteligencia de Cadena de Suministro `dev_supply_chain_cti`, Reportes PDF/JSON, CLI `--project` y GitHub App). La migración `V20` actualiza retroactivamente a `corpus_scope = 'DEVELOPER'` los documentos de tenants con perfil `DEVELOPER`.
- **Decisión sobre `dev_cli` y `DevCliModulePanel.jsx`:** el ítem `dev_cli` no se habilita en `profile-configs.json` porque CLI, tokens `REPO_SCAN` y GitHub App están integrados como pestañas dentro del hub **Proyectos** (`RepoScannerPanel.jsx`). `DevCliModulePanel.jsx` se conserva únicamente como componente legado de compatibilidad sin exponerlo en la barra de navegación.
- **Transiciones y aislamiento `LEGAL` / `DEVELOPER` / `GENERAL`:** las transiciones entre perfiles reetiquetan únicamente documentos del tenant autenticado; `V17` corrige documentos de tenants `LEGAL` y `V20` los de tenants `DEVELOPER`, conservando el aislamiento por tenant y expediente sin almacenar originales permanentemente.
- El análisis de repositorios (`POST /api/v1/repo/scan` y `/scan-url`) actúa como proxy autenticado hacia el worker FastAPI (`omega/api` `/api/repo/scan`) y registra automáticamente los metadatos saneados en `omega_rag.dev_projects`, `dev_scans`, `dev_findings` y `dev_dependencies`.
