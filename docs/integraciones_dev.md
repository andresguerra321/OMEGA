# Integraciones para Desarrolladores (`CLI`, `GitHub Action`, `SARIF` y `GitHub App`)

## 1. CLI (`omega scan <ruta>`)

### Instalación y uso básico
La CLI utiliza únicamente la biblioteca estándar de Python (`argparse`, `urllib`, `tarfile`, `fnmatch`) más `pydantic`/`jsonschema` en modo `--offline` o `--format sarif`.

```bash
# Exportar token de API de alcance REPO_SCAN (nunca pasarlo por argumento si es evitable)
export OMEGA_API_TOKEN="omega_scan_..."

# Analizar repositorio contra el servidor OMEGA asociándolo a un proyecto y aplicando su política
python omega/cli/omega_cli.py scan . --url https://tu-omega.example --project mi-servicio --format sarif --output omega-results.sarif --fail-on HIGH

# Modo sin red (solo detectores estáticos locales)
python omega/cli/omega_cli.py scan . --offline

# Vista previa de archivos a empaquetar sin subir nada
python omega/cli/omega_cli.py scan . --preview
```

### Códigos de salida y evaluación de políticas
- `0`: limpio, hallazgos suprimidos/aceptados o por debajo del umbral `--fail-on` y política `PASS`/`WARN`.
- `1`: hallazgos activos con severidad `>= --fail-on` o violación de política del servidor con acción `FAIL_PIPELINE` (incluidos paquetes bloqueados).
- `2`: error de argumentos/uso (`argparse`).
- `3`: error de red, autenticación, cuota (`429`) o URL `http://` fuera de `localhost`.
- `4`: escaneo rechazado por límites locales o del servidor (`50 MiB`, `5,000` archivos).
- **Asociación con proyectos y supresiones:** pasando `--project <nombre>` o `--project-id <uuid>`, el servidor registra el escaneo en el historial del proyecto (`omega_rag.dev_scans`), descuenta automáticamente las supresiones vigentes (`dev_suppressions`) del puntaje efectivo y devuelve `policy_evaluation` para que la CLI y GitHub Actions respeten la política configurada por el administrador.

### Exclusión de secretos y `.gitignore`
- **Siempre excluidos** (incluso con `--include-ignored`): `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.pypirc`, `credentials.json`, `secrets.json`, `.git/`, `node_modules/`, `__pycache__/`.
- El parser propio de `.gitignore` (sin `subprocess` ni `git`) evalúa el `.gitignore` raíz con patrones glob y negaciones (`!`).

---

## 2. GitHub Action (`.github/actions/omega-scan`)

- Action `composite` que ejecuta `omega_cli.py`, publica un resumen saneado en `$GITHUB_STEP_SUMMARY` y sube `omega-results.sarif` a GitHub Code Scanning (`github/codeql-action/upload-sarif` fijado por SHA completo).
- Guarda el token de API como secreto de repositorio/organización (`OMEGA_API_TOKEN`) y la URL base como variable (`OMEGA_URL`).
- Workflow listo para copiar en [docs/examples/omega-repo-scan.yml](examples/omega-repo-scan.yml) con permisos mínimos explícitos (`contents: read`, `security-events: write`).

---

## 3. Tokens de API (`REPO_SCAN`): creación y revocación

- **Crear:** `POST /api/v1/api-tokens` (`ADMIN` o `ANALYST`). El valor en texto plano (`omega_scan_...`) se muestra una única vez; en PostgreSQL solo se almacena el hash SHA-256 (`V13__api_tokens.sql`).
- **Revocar:** `DELETE /api/v1/api-tokens/{tokenId}` (`ADMIN` o el usuario creador). La revocación es inmediata y queda registrada en `audit_logs`.
- **Cuotas mensuales por plan:** `PERSONAL` (`30` escaneos/mes), `PRO` (`300`/mes), `ENTERPRISE` (`3000`/mes), además del límite opcional `maxUses` por token.

---

## 4. Integración con GitHub App (Solo lectura + Comentario único en PR)

### Requisitos de despliegue
- **Requiere modo `CLOUD_MANAGED`** (URL pública HTTPS para recibir webhooks de GitHub). **No aplica a `SELF_HOSTED`** local sin exposición pública.

### Permisos congelados de la GitHub App
Antes de instalar la App en repositorios reales, los permisos deben quedar fijados exclusivamente a:
- **Repository → Metadata:** `Read-only` (obligatorio).
- **Repository → Contents:** `Read-only` (descarga del tarball en RAM/`tmpfs`, sin persistencia).
- **Repository → Pull requests:** `Read and write` **únicamente** para publicar y actualizar el comentario único (`<!-- omega-scan-pr -->`). No se modifica código, ramas ni estados de merge.
- **Check Runs:** No habilitado (`checks: write` no se solicita).

### Almacenamiento y rotación de la clave privada de la App
- La clave privada PKCS#8 (`OMEGA_GITHUB_APP_PRIVATE_KEY`) y el secreto de webhook (`OMEGA_GITHUB_WEBHOOK_SECRET`) viven exclusivamente en variables de entorno o gestor de secretos del servidor; **nunca** en el repositorio ni en logs.
- **Rotación:** generar una nueva clave privada en la configuración de la GitHub App, actualizar `OMEGA_GITHUB_APP_PRIVATE_KEY` en el gestor de secretos/entorno, reiniciar el servicio y revocar la clave anterior en GitHub. Los tokens de instalación se generan bajo demanda (1 h de vida).

### Qué se guarda y qué no (Zero-Retention)
- **Se guarda:** metadatos de instalación (`installation_id`, repositorios seleccionados), estado temporal anti-replay (`X-GitHub-Delivery`), contadores de cuota y eventos de auditoría SHA-256.
- **No se guarda:** código fuente, tarballs ni fragmentos de evidencia en comentarios de PR (los comentarios muestran únicamente severidad, regla, archivo y línea, con redacción de secretos y escape de Markdown/`@menciones`).

### Límites conocidos y prueba manual pendiente en vivo
- Los semáforos de concurrencia (`2` escaneos simultáneos por instalación) operan **por instancia** en memoria; el tope diario por repositorio (`20` escaneos/día, `omega_rag.github_repo_daily_usage` en `V16`) y la cuota mensual del tenant (`omega_rag.repo_scan_usage`) son **persistentes y atómicos en PostgreSQL**.
- `omega.github.collaborators-only` es `true` por defecto (seguro para repositorios públicos).
- **Prueba manual pendiente en vivo (GitHub App real):**
  1. Configurar `OMEGA_GITHUB_APP_ID`, `OMEGA_GITHUB_APP_PRIVATE_KEY`, `OMEGA_GITHUB_WEBHOOK_SECRET` y `OMEGA_GITHUB_APP_BOT_LOGIN` en un entorno `CLOUD_MANAGED` con HTTPS público.
  2. Instalar la GitHub App en un repositorio privado de pruebas y vincularla como `ADMIN` vía `/api/v1/integrations/github/state` + `/link`.
  3. Abrir un PR que modifique `package.json`, verificar el comentario único `<!-- omega-scan-pr -->`, hacer un push adicional y confirmar que el comentario se actualiza en el mismo hilo.
  4. Desinstalar la App en GitHub y confirmar que el webhook `installation` (`deleted`) desvincula la instalación en OMEGA.
