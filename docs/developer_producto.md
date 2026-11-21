# Producto Comercial OMEGA — Perfil `DEVELOPER`

Este documento describe las capacidades comerciales completas del perfil **`DEVELOPER`** en OMEGA, sus flujos de trabajo, garantías Zero-Retention, benchmarks verificados y límites conocidos.

---

## 1. Visión general del hub `Proyectos` (`RepoScannerPanel`)

Para evitar dispersión en la navegación principal, todas las capacidades de ingeniería de seguridad viven consolidadas dentro de **Proyectos** (`repo_scanner`); el módulo legado `dev_cli` y `DevCliModulePanel.jsx` fueron eliminados:

1. **Analizar repositorio (`scan`):** escaneo estático en RAM/tmpfs mediante archivo comprimido (`.tar.gz`, `.tgz`, `.zip`) o URL pública/privada de GitHub.
2. **Proyectos (`projects`):** inventario multi-tenant (`omega_rag.dev_projects`), historial de escaneos (`dev_scans`), puntaje bruto vs. efectivo, tendencia ($\Delta$ respecto al escaneo anterior), comparador diff entre dos escaneos (`added`, `resolved`, `unchanged` por `fingerprint`) y borrado en cascada auditado.
3. **Hallazgos y Triaje (`findings`):** bandeja filtrable por proyecto, severidad, regla y estado (`OPEN`, `IN_REVIEW`, `ACCEPTED`, `FALSE_POSITIVE`, `FIXED`), comentarios con redacción automática de secretos y supresiones con fecha de expiración obligatoria (`dev_suppressions`) que recalculan el puntaje efectivo.
4. **Dependencias y SBOM (`sbom`):** inventario multi-ecosistema (`npm`, `pypi`, `maven`, `cargo`, `go`) correlacionado con señales activas y exportación auditada en **CycloneDX 1.5 JSON** y **SPDX 2.3 JSON**.
5. **Políticas (`policies`):** política por defecto del tenant y override por proyecto (editables solo por `ADMIN`), con umbral `failOnSeverity`, acción `MARK_ONLY` / `FAIL_PIPELINE` / `COMMENT_PR`, paquetes permitidos y paquetes bloqueados.
6. **Cadena de suministro y Monitoreo continuo (`supply_chain`):** catálogo curado `dev_supply_chain_cti` con fuentes y licencias verificadas (`OSV.dev CC-BY 4.0`, `CISA / NIST NVD Public Domain`, `OWASP Top 10 CI/CD CC-BY-SA 4.0`, `RustSec CC0 1.0`), cruce automático contra el SBOM de cada proyecto, asistente grounded con citas/abstención explícita y **monitoreo continuo programado** (`DevContinuousMonitorScheduler` + `DevMonitoringService`) sobre el SBOM almacenado sin volver a descargar código, con frecuencia configurable por plan (`PERSONAL: 24h`, `PRO: 6h`, `ENTERPRISE: 1h`), tolerancia a fallos de feeds y alerta visible (`feedStaleWarning`) si un feed falla o supera 48h sin actualizarse.
7. **Mi estación (`workstation`):** auditoría pasiva de la estación de desarrollo (`/api/v1/dev/workstation/audit`, solo lectura sobre configuración/herramientas locales sin exfiltrar credenciales).
8. **Reportes (`reports`):** exportación ejecutiva y técnica por proyecto o para toda la organización en **PDF** y **JSON**, sin fragmentos de código ni valores de credenciales.
9. **CLI y Tokens API (`cli`):** generador de comandos `omega scan` con `--project` y gestión de tokens `REPO_SCAN` (`V13`).
10. **Integración GitHub (`github`):** vinculación de GitHub App en solo lectura (`V14`–`V16`) con comentario único saneado por Pull Request (`<!-- omega-scan-pr -->`).

---

## 2. Garantías de Seguridad y Zero-Retention

- **Cero ejecución de código:** el motor jamás invoca `npm install`, `pip install`, `setup.py`, ni hooks del repositorio.
- **Redacción estricta de credenciales (`SECRET-CREDENTIAL-*`):** los detectores de tokens de GitHub, AWS IAM, proveedores de IA, llaves privadas PEM/OpenSSH, Slack y tokens OMEGA **nunca** almacenan ni devuelven el valor del secreto. Solo persisten `[CREDENTIAL_REDACTED]`, el tipo de credencial, archivo/línea y la guía de rotación paso a paso.
- **Aislamiento multi-tenant:** todas las tablas `dev_*` (`V20`) usan claves foráneas compuestas `(project_id, tenant_id)` con `ON DELETE CASCADE`. Un usuario de otro tenant recibe `404 Not Found` sin revelar si el recurso existe.
- **Trazabilidad en `audit_logs`:** creación/eliminación de proyectos, cambios de triaje, alta/revocación de supresiones, cambios de políticas y exportaciones de SBOM/reportes quedan encadenados con SHA-256.

---

## 3. Benchmark Verificado (Fase 1 Estática + Fase 2 Contexto de Metadatos + Secretos)

Ejecutado mediante `omega/api/tests/test_repo_scanner_benchmark.py` y `test_repo_scanner.py`:

| Métrica / Regla | Resultado medido | Umbral exigido |
|---|---|---|
| **Precisión (Precision)** | `1.00` (100%) | $\ge 0.85$ |
| **Exhaustividad (Recall)** | `1.00` (100%) | $\ge 0.85$ |
| **Tasa de falsos positivos en proyectos limpios** | `0.00` (0%) | $\le 0.10$ |
| Reglas Fase 2 activadas (`PKG-NEW-OR-RECENT-01`, `PKG-MAINTAINER-CHANGE-01`, `PKG-TEMPORAL-CHAIN-01`) | Verificadas activas | Obligatorio |
| Fuga de valores de secretos en DB / JSON / SARIF / PDF | `0` ocurrencias | `0` tolerado |

---

## 4. Estado de los bloques DG y DJ (ya implementados)

- **Bloque DG (Monitoreo continuo):** **Implementado y verificado** en `DevMonitoringService`, `DevContinuousMonitorScheduler`, `DevMonitoringController` (`/api/v1/dev/projects/{projectId}/monitoring` y `/evaluate`), `DevSupplyChainIntelTab.jsx` y `DevMonitoringApiIntegrationTest`. La propuesta original en [docs/propuestas/DG_monitoreo_continuo.md](propuestas/DG_monitoreo_continuo.md) se conserva como referencia histórica de diseño.
- **Bloque DJ (Mi estación de trabajo):** **Implementado y verificado** en `DevWorkstationController` (`/api/v1/dev/workstation/audit`), la pestaña `Mi estación` dentro de `RepoScannerPanel.jsx` y `DevWorkstationApiIntegrationTest`. La propuesta original en [docs/propuestas/DJ_mi_estacion_trabajo.md](propuestas/DJ_mi_estacion_trabajo.md) se conserva como referencia histórica de diseño.
