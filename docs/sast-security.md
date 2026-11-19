# Arquitectura SAST y Seguridad en CI — OMEGA

Este documento describe el sistema automatizado de análisis estático de seguridad (**SAST**) integrado en OMEGA, su alcance real por lenguaje, la estrategia de adopción progresiva (observación → enforcement) y el procedimiento operativo para gestionar hallazgos y excepciones.

---

## 1. Objetivo

Detectar vulnerabilidades de seguridad de forma continua y reproducible sobre el código fuente real de OMEGA (Java 21, Python 3.11+, JavaScript/React, Rust, Dockerfiles y workflows de GitHub Actions) antes de que lleguen a `main`, complementando —sin reemplazar— las auditorías de dependencias (`supply-chain-audit.yml`), la verificación de integridad del corpus CTI (`cti-feed-review.yml`) y las pruebas funcionales.

---

## 2. Arquitectura y herramientas seleccionadas

| Herramienta | Rol principal | Lenguajes / Objetivos en OMEGA | Integración |
| :--- | :--- | :--- | :--- |
| **GitHub CodeQL** | Análisis semántico profundo y seguimiento de flujos de datos (*taint tracking* interprocedimental) con suite `security-extended`. | `java-kotlin` (compilación manual Maven), `python`, `javascript-typescript`, `actions` (`.github/workflows/`). | Nativa en **GitHub Code Scanning** (pestaña *Security → Code scanning*). |
| **Semgrep** | Análisis rápido basado en AST y reglas OWASP Top 10 + reglas propias de la arquitectura OMEGA. | `p/owasp-top-ten`, `p/java`, `p/python`, `p/javascript`, `p/react`, `p/rust`, `p/dockerfile` + [`.semgrep/omega-rules.yml`](../.semgrep/omega-rules.yml). | Exporta SARIF a **GitHub Code Scanning**, resumen en *Step Summary* y artifact descargable (`omega-semgrep-sast-report`). |
| **VICE / Supply Chain** *(ya existente)* | Secretos, configuración, `npm audit`, `pip-audit` y CycloneDX SBOM. | Todo `omega/`. | [`.github/workflows/supply-chain-audit.yml`](../.github/workflows/supply-chain-audit.yml) (sin alterar). |

### Por qué se complementan sin duplicarse
- **CodeQL** destaca en análisis interprocedimental complejo (por ejemplo, rastrear un parámetro HTTP en un controlador Spring hasta una consulta SQL, petición SSRF o lectura de archivo varios métodos más abajo).
- **Semgrep** cubre los huecos donde CodeQL es menos ágil o no cubre aún todos los artefactos del repo: **Rust** (`omega/sensor-rust/`, `omega/frontend/src-tauri/`), **Dockerfiles**, patrones específicos de React y **reglas personalizadas de OMEGA** (bloqueo de `tarfile.extractall()` por Zip-Slip en `sysdiagnose`, `subprocess(..., shell=True)`, `dangerouslySetInnerHTML`, tokens en `localStorage`, concatenación SQL y bloques `unsafe` en Rust).

### Exclusiones justificadas
- [`.github/codeql/codeql-config.yml`](../.github/codeql/codeql-config.yml) y [`.semgrepignore`](../.semgrepignore) excluyen `node_modules/`, `target/`, `dist/`, `release/`, `binaries/`, `gen/`, `omega/corpus_mvp/` (datos forenses/STIX seed) y los directorios de fixtures de pruebas (`omega/api/tests/`, `omega/backend-java/src/test/`, `*.test.js`) para evitar ruido y consumo innecesario de minutos CI.

---

## 3. Eventos, permisos y controles del pipeline

Definido en [`.github/workflows/sast-security.yml`](../.github/workflows/sast-security.yml):

- **Eventos:**
  - `pull_request` hacia `main` (nunca `pull_request_target`, garantizando aislamiento ante PRs externos).
  - `push` sobre `main`.
  - `schedule`: semanal (`0 4 * * 1`, lunes 04:00 UTC) para detectar nuevas consultas/reglas sobre código existente.
  - `workflow_dispatch`: ejecución manual eligiendo `enforcement_mode` (`observe` o `enforce`).
- **Permisos mínimos:** `contents: read` a nivel global; `security-events: write` únicamente en los jobs que publican SARIF; `actions: read` únicamente en CodeQL.
- **Concurrencia y timeouts:** cancela ejecuciones previas en la misma rama/PR (no en `main`), con `timeout-minutes: 25` para CodeQL y `15` para Semgrep.

---

## 4. Estrategia de hallazgos, línea base y enforcement progresivo

### Resultados de línea base y remediación (antes vs. después)

En la ejecución inicial de Semgrep sobre `omega/` y `.github/workflows/` (run [`44434707108`](https://github.com/andresguerra321/OMEGA/actions/runs/44434707108)) se registraron **36 hallazgos totales** (`1 ERROR`, `35 WARNING`) y `6` advertencias de parseo:

| Hallazgo inicial | Severidad | Clasificación | Estado / Decisión |
| :--- | :--- | :--- | :--- |
| `dockerfile.security.missing-user` (`omega/frontend/Dockerfile:14`) | `ERROR` (High) | **Vulnerabilidad real de configuración** (Nginx ejecutándose como `root`) | **Corregido:** migrado a `nginxinc/nginx-unprivileged:1.27-alpine` (`USER 101`, puerto interno `8080`, `docker-compose.yml` actualizado a `:8080`). |
| `generic.nginx.security.request-host-used` (`omega/frontend/nginx.conf:13,19`) | `WARNING` (Medium) | **Riesgo de Host Header Injection en proxy interno** (`$host` reenviado sin control a `backend-java`) | **Corregido:** fijado `proxy_set_header Host backend-java:8080;` y añadido `server_tokens off;`. |
| `yaml.github-actions.security.github-actions-mutable-action-tag` (32 ocurrencias en `.github/workflows/*.yml`) | `WARNING` (Medium) | **Riesgo de cadena de suministro** (tags mutables `@v4`/`@v7`) | **Corregido:** todas las acciones de los 4 workflows fijadas a **SHAs de commit completos de 40 caracteres**, con actualizaciones semanales vía [`.github/dependabot.yml`](../.github/dependabot.yml). |
| `java.lang.security.audit.crypto.unencrypted-socket` (`WebIntelExtractorService.java:352`) | `WARNING` (Medium) | **Falso positivo para HTTPS / comportamiento esperado para HTTP CTI** | **Riesgo aceptado y documentado** en [`.github/security/semgrep-accepted-risks.json`](../.github/security/semgrep-accepted-risks.json): el socket `Proxy.NO_PROXY` implementa *IP pinning* anti-DNS-rebinding SSRF y actualiza inmediatamente a `SSLSocket` con SNI cuando el esquema es `https://`. |
| `PartialParsing` (`OnboardingTourModal.jsx:518`) | Error de parseo JS | Texto `&` sin entidad en JSX | **Corregido** (`&` → `y`), eliminando el error de parseo JS. |

### Política de enforcement implementada

Evaluada por [`.github/scripts/evaluate_semgrep_gate.py`](../.github/scripts/evaluate_semgrep_gate.py):

1. **Bloqueo ante fallos del escáner:** códigos de salida `>= 2` o errores fatales del motor Semgrep fallan el pipeline inmediatamente (nunca se interpretan como verde).
2. **Riesgos aceptados explícitos ([`semgrep-accepted-risks.json`](../.github/security/semgrep-accepted-risks.json)):** solo se excluyen del bloqueo entradas auditadas por par exacto `(check_id, path)` con clasificación, fecha y justificación técnica, manteniéndolas visibles en el *Step Summary*.
3. **Línea base diferencial ([`semgrep-baseline.json`](../.github/security/semgrep-baseline.json)):** distingue deuda preexistente de hallazgos nuevos.
4. **Modo por defecto (`enforce-new-error`):** bloquea automáticamente cualquier PR o push a `main` que introduzca un hallazgo nuevo de severidad `ERROR` (High/Critical), sin bloquear deuda aceptada ni preexistente. Se mantiene soporte manual (`workflow_dispatch`) para `enforce-all-error` y `observe`.

> La activación de reglas obligatorias (*Required status checks*) en la protección de rama de `main` permanece bajo aprobación manual del mantenedor del repositorio.

---

## 5. Operación diaria

### Ejecutar análisis manualmente
- **En GitHub:** *Actions → SAST Security Analysis (CodeQL & Semgrep) → Run workflow*, eligiendo `observe` o `enforce`.
- **En local (Semgrep):**
  ```bash
  pip install "semgrep>=1.90,<2.0"
  semgrep scan --config .semgrep/omega-rules.yml --config p/owasp-top-ten --metrics=off omega/
  ```

### Revisar alertas y descargar reportes
1. **GitHub Code Scanning:** pestaña *Security → Code scanning* (agrupa alertas de CodeQL y Semgrep por categoría, severidad y commit).
2. **Artifacts del workflow:** dentro de cada ejecución de `SAST Security Analysis`, descarga `omega-semgrep-sast-report` (`omega-semgrep.sarif` y `omega-semgrep.json`, retenidos 30 días).

### Gestionar falsos positivos y excepciones
- **Regla estricta:** nunca suprimas una regla globalmente ni ocultes hallazgos reales para forzar un build verde.
- **En CodeQL:** descarta la alerta desde *Security → Code scanning* indicando el motivo auditado (*False positive* o *Won't fix* con justificación técnica).
- **En Semgrep:** usa supresión puntual en la línea exacta con justificación obligatoria:
  ```python
  # nosemgrep: omega-python-subprocess-shell-true -- <justificación técnica concreta>
  ```
  Toda supresión `nosemgrep` debe ser aprobada explícitamente en revisión de PR.

### Investigar y corregir una vulnerabilidad
1. Verifica el flujo de datos completo (origen no confiable → sanitización → sumidero) y confirma si es explotable en el contexto real de OMEGA.
2. Reproduce el fallo con una prueba unitaria/integración antes de parchearlo.
3. Aplica la corrección en el sumidero o validador (p. ej. consultas parametrizadas, lista de argumentos en `subprocess`, `DOMPurify`, validación anti-Zip-Slip).
4. Confirma que la alerta desaparece en el siguiente run del PR sin introducir regresiones.

---

## 6. Limitaciones conocidas

- **SAST no es una auditoría completa:** CodeQL y Semgrep no validan lógica de negocio multi-tenant (p. ej. bypass de ACL entre tenants o flujos MFA complejos), ni sustituyen pruebas DAST, revisión manual ni pruebas de penetración.
- **C# legado (`omega/scripts/host_sensor_service.cs`):** al ser un archivo único sin proyecto `.csproj`/`.sln`, no se incluye en la matriz de CodeQL para evitar fallos de `autobuild`; su reemplazo definitivo es `omega/sensor-rust/`.
- **Rust en CodeQL:** actualmente el análisis SAST de Rust recae en **Semgrep (`p/rust` + `omega-rust-unsafe-block`)** y `cargo test`/`cargo clippy` en CI.

---

## 7. Mantenimiento del pipeline

- Revisar trimestralmente las versiones de `github/codeql-action`, `actions/checkout`, `actions/setup-java`, `actions/setup-python` y el rango de versión de `semgrep`.
- Cuando se añada un nuevo módulo o lenguaje al repositorio, actualizar `.github/codeql/codeql-config.yml` y la matriz de `sast-security.yml`.
- Cada vez que se detecte un patrón de riesgo recurrente en revisión de código, codificar una regla determinista en `.semgrep/omega-rules.yml` y validarla con un caso vulnerable temporal antes de subirla.
