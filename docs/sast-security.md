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

## 4. Estrategia de adopción progresiva (Observación → Enforcement)

1. **Etapa inicial — Observación (`observe`, valor por defecto actual):**
   - Ejecuta CodeQL y Semgrep completos en cada PR y push a `main`.
   - Publica todos los hallazgos en **Security → Code scanning**, en el *Step Summary* del workflow y como artifact SARIF/JSON.
   - **No bloquea el merge** por deuda preexistente sin triar, pero **sí falla** si ocurre un error técnico de ejecución del scanner (código de salida `>= 2` en Semgrep o fallo de compilación Maven en CodeQL).
2. **Etapa de control — Enforcement (`enforce`):**
   - Una vez revisada y clasificada la línea base inicial de alertas en `main`:
     - Cambiar el default de `ENFORCEMENT_MODE` a `enforce` (o usar `--baseline-commit` en PRs para bloquear exclusivamente hallazgos **nuevos** de severidad `ERROR` / High-Critical).
     - Activar el check requerido `CodeQL` y `Semgrep SAST` en las reglas de protección de la rama `main`.

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
