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
  - `workflow_dispatch`: ejecución manual eligiendo `enforce-new-error` (por defecto), `enforce-all-error` u `observe`.
- **Permisos mínimos y PRs desde forks:** `contents: read` a nivel global; `security-events: write` únicamente en los jobs que publican SARIF; `actions: read` únicamente en CodeQL. En PRs provenientes de forks (`github.event.pull_request.head.repo.fork == true`), GitHub degrada `GITHUB_TOKEN` a solo lectura: el pipeline omite la subida SARIF a Code Scanning (`upload: never` en CodeQL y condición negativa en `upload-sarif@v4`) para no fallar por permisos sin privilegios elevados, conservando el análisis completo, el gate y el artifact descargable.
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
| `PartialParsing` (`sast-security.yml:136`, `release-desktop.yml:158`) | Advertencia de parseo CI | Interpolación `${{ ... }}` directa dentro de `run:` | **Corregido:** expresiones movidas a variables `env:`, mitigando además riesgo de script injection. |
| `Internal matching error` (`release-desktop.yml` pasos `shell: pwsh`) | 4 advertencias de matcher | Regla `gha-curl-pipe-shell` intenta parsear scripts PowerShell como Bash | **Limitación de herramienta documentada:** ninguno de esos 4 pasos usa `curl \| sh`; CodeQL (`actions`) sigue analizando los workflows completos. |

### Política de enforcement y gestión de fingerprints

Evaluada y probada por [`.github/scripts/evaluate_semgrep_gate.py`](../.github/scripts/evaluate_semgrep_gate.py) y [`.github/scripts/test_evaluate_semgrep_gate.py`](../.github/scripts/test_evaluate_semgrep_gate.py) (ejecutada obligatoriamente en CI antes del gate):

1. **Bloqueo ante fallos del escáner:** códigos de salida `>= 2`, reportes JSON/SARIF ausentes o corruptos, errores fatales de Semgrep (`FatalError`) o configuraciones de excepción inválidas/caducadas aplican **fail-closed** (`exit 2`).
2. **Identificación resistente por fingerprint ([`semgrep-accepted-risks.json`](../.github/security/semgrep-accepted-risks.json)):**
   - **Prohibidas las excepciones globales por archivo/regla o con comodines (`*`).**
   - Cada excepción exige `check_id`, `path`, `context_sha256` (hash SHA-256 de la región coincidente + 3 líneas previas y 1 posterior) o `semgrep_fingerprint` real, `max_occurrences` (consumo 1:1), `classification`, `owner`, `reviewed_at`, `expires_at` y `justification` técnica (`>= 20` caracteres).
   - Un desplazamiento de líneas por encima de la función mantiene estable el `context_sha256`, mientras que una segunda copia o una nueva coincidencia en otro método **no hereda la excepción**.
   - Si una excepción caduca (`expires_at < fecha UTC actual`), el evaluador falla solicitando nueva revisión explícita.
3. **Línea base diferencial ([`semgrep-baseline.json`](../.github/security/semgrep-baseline.json)):** distingue deuda preexistente por `(check_id, path, context_sha256)` de hallazgos nuevos.
4. **Modos de control:**
   - `enforce-new-error` *(por defecto en PR y push)*: bloquea cualquier hallazgo **nuevo** de severidad `ERROR`.
   - `enforce-all-error`: bloquea cualquier hallazgo activo `ERROR` (incluyendo deuda preexistente en línea base).
   - `observe`: registra y publica métricas/SARIF sin bloquear por hallazgos de código (pero **sí falla** ante errores técnicos o config inválida).

### Validación funcional Docker / Nginx y activación de Required Status Checks

- La imagen de `omega/frontend/Dockerfile` (`nginxinc/nginx-unprivileged:1.27-alpine`, `USER 101`, `EXPOSE 8080`, `docker-compose.yml` mapeado a `5173:8080`) fue validada funcionalmente ejecutando el contenedor contra un upstream de prueba en red Docker: `uid=101(nginx)`, procesos `nginx` no-root, entrega `HTTP 200` de assets estáticos (`/assets/*.js` con `immutable`), fallback SPA (`200` en rutas cliente), ocultación de versión (`Server: nginx`) y proxy `/actuator/health` + `/api/` reenviando `Host: backend-java:8080` y cabeceras `X-Forwarded-*`.
- **Activación segura de Required Status Checks en `main` (manual tras el merge de PR #1):**
  1. Verificar 2 ejecuciones consecutivas limpias en `main` para confirmar estabilidad de tiempos y ausencia de falsos bloqueos.
  2. En *Settings → Branches → Branch protection / Rulesets (`main`)*, marcar como requeridos únicamente los checks estables en PR internos y externos: `Semgrep SAST (OWASP + OMEGA Rules)` y los checks `CodeQL (java-kotlin)`, `CodeQL (python)`, `CodeQL (javascript-typescript)`, `CodeQL (actions)`.

---

## 5. Operación diaria

### Ejecutar análisis manualmente
- **En GitHub:** *Actions → SAST Security Analysis (CodeQL & Semgrep) → Run workflow*, eligiendo `enforce-new-error`, `enforce-all-error` u `observe`.
- **En local (Semgrep + Gate):**
  ```bash
  pip install "semgrep>=1.90,<2.0" pytest
  python -m pytest .github/scripts/test_evaluate_semgrep_gate.py -v
  semgrep scan --config .semgrep/omega-rules.yml --config p/owasp-top-ten --metrics=off --sarif-output=omega-semgrep.sarif --json-output=omega-semgrep.json omega/ .github/workflows/
  python .github/scripts/evaluate_semgrep_gate.py --report omega-semgrep.json --sarif omega-semgrep.sarif --mode enforce-new-error
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
