# Modelo de Amenazas — OMEGA Repo Scanner (Fase 0)

> **Propósito:** Definir la superficie de ataque, reglas de seguridad no negociables, mitigaciones y riesgos residuales antes de implementar el scanner estático para el perfil `DEVELOPER`.

---

## 1. Reglas No Negociables de Diseño

1. **Cero ejecución de código analizado:** el código fuente, scripts (`postinstall`, `setup.py`, `Makefile`, GitHub Actions, etc.) y binarios del repositorio **NUNCA se ejecutan**, importan ni evalúan dinámicamente (`eval`, `exec`, `importlib`, `subprocess`, `npm install`, `pip install`). Solo se aplica **análisis estático** sobre AST, manifiestos, lockfiles y texto plano.
2. **Procesamiento exclusivo en RAM / `tmpfs` con cuotas estrictas:**
   - Límite de tamaño de entrada (`max_bytes`, por defecto 50 MiB, tope estricto 100 MiB).
   - Límite de cantidad de archivos (`max_files`, por defecto 5,000, tope estricto 20,000).
   - Límite de tiempo de análisis (`timeout_seconds`, por defecto 30 s, tope 120 s) con cancelación forzada.
3. **Validación de archivos comprimidos vía `archive_safety.py`:** reutilización obligatoria de `omega/api/archive_safety.py` para bloquear **Zip-Slip** (path traversal `../` y symlinks fuera de raíz) y **bombas ZIP** (ratio de compresión anómalo / tamaño descomprimido acumulado).
4. **Zero-Retention del contenido del cliente:** el árbol de archivos del repositorio se mantiene únicamente en memoria/`tmpfs` durante el análisis y se purga al finalizar o expirar; nunca se persiste código fuente en PostgreSQL ni en disco persistente.
5. **Mitigación contra abuso y evasión:**
   - Autenticación obligatoria JWT + perfil `DEVELOPER` en `backend-java` y `X-Internal-Service-Token` en `omega/api`.
   - Rate limiting por `tenant_id` y cuotas de concurrencia para evitar DoS.
   - **No exponer reglas completas:** las respuestas devuelven únicamente `rule_id`, `evidence` acotada, `location` y `explanation`, sin filtrar el corpus completo de firmas/regex internas para dificultar la evasión dirigida.

---

## 2. Matriz de Amenazas, Mitigaciones y Riesgos Residuales

| ID | Amenaza | Vector / Impacto | Mitigación Obligatoria | Riesgo Residual |
|---|---|---|---|---|
| **T1** | **Ejecución remota de código (RCE) vía código malicioso en el repo** | `setup.py`, `package.json` (`preinstall`/`postinstall`), `.vscode/tasks.json`, macros o `eval` durante el parseo. | Análisis 100% estático (lectura de bytes/AST seguro, `ast.parse` sin ejecución, YAML `safe_load`). Sin shell ni runtime de paquetes. | Vulnerabilidades 0-day en parsers nativos (C/Python) ante entradas malformadas; mitigado ejecutando el worker con usuario no privilegiado, seccomp/read-only rootfs y límites de memoria. |
| **T2** | **Zip-Slip / Symlink Escape** | Entradas `../../etc/passwd` o enlaces simbólicos en `.zip`/`.tar.gz` para leer/sobrescribir archivos del contenedor. | Validación previa estricta con `archive_safety.py` antes de extraer; rechazo de rutas absolutas, `..` y symlinks. | Bajo; depende de mantener `archive_safety.py` cubierto por tests de regresión. |
| **T3** | **Bomba ZIP / Agotamiento de RAM o CPU (DoS)** | Archivos altamente comprimidos, miles de archivos diminutos o ReDoS en expresiones regulares. | Cuotas `max_bytes`, `max_files`, `timeout_seconds`, detección de ratio de compresión en `archive_safety.py` y uso de regex lineales / AST sin backtracking exponencial. | Picos temporales de memoria dentro de la cuota permitida bajo múltiples peticiones simultáneas; mitigado con rate limit y semáforo de concurrencia por worker. |
| **T4** | **Fuga o retención inadvertida de código propietario** | Logs de error, dumps de excepción, caché temporal o respuestas de debug que filtren fragmentos de secretos/código del cliente. | Zero-retention en RAM/`tmpfs`, purga en bloque `finally`, truncamiento de `evidence` y prohibición de loguear contenido fuente en stdout/stderr. | Logs de infraestructura externos si ocurriera un crash no controlado del kernel; mitigado deshabilitando core dumps en el contenedor. |
| **T5** | **Acceso cross-tenant o invocación directa al worker** | Petición directa a `/api/repo/scan` saltando el gateway o consultando `scan_id` ajeno. | Middleware `X-Internal-Service-Token` fail-closed en `omega/api` + verificación de `tenant_id` en `backend-java` mediante `TenantContext` + IDs de escaneo aleatorios de alta entropía. | Compromiso del secreto interno `X-Internal-Service-Token`; mitigado con rotación y almacenamiento exclusivo en variables de entorno/secretos. |
| **T6** | **Evasión / probing de reglas de detección** | Atacante sube repos de prueba automatizados para reconstruir todas las reglas YARA/AST de OMEGA. | Rate limits estrictos por tenant y omisión de patrones regex/firmas completas en `ScanFinding` (solo `rule_id` + explicación humana). | Un actor persistente con múltiples cuentas puede inferir heurísticas generales; mitigado con monitoreo de abuso y rotación/ampliación continua de reglas. |

---

## 3. Controles de Verificación Requeridos antes de Fase 1

- Tests unitarios en `omega/api/tests/` cubriendo: Zip-Slip, bomba ZIP, exceso de `max_files` / `max_bytes`, timeout y ausencia de persistencia en disco tras el escaneo.
- Verificación de `X-Internal-Service-Token` (401 fail-closed) en `POST /api/repo/scan` y `GET /api/repo/scan/{id}`.
