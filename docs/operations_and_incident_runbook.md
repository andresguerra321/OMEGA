# Runbook de Operación Local / On-Premise, Backups y Respuesta a Incidentes — OMEGA

Este manual operativo cubre la administración de **OMEGA** en instalaciones **locales / on-premise** (estación de trabajo del operador o servidor interno del despacho/equipo con Docker Desktop) para soportar pilotos de **`DEVELOPER`** y **`LEGAL`**.

---

## 1. Verificación de Salud y Monitoreo Local

### 1.1 Estado de servicios y planes
```powershell
# Salud técnica de Spring Boot
Invoke-RestMethod http://127.0.0.1:8080/actuator/health

# Estado público unificado (base de datos, modo Zero-Retention y cuotas por plan)
Invoke-RestMethod http://127.0.0.1:8080/api/v1/public/status
```

### 1.2 Diagnóstico de contenedores locales
```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```
- **Servicios esperados:** PostgreSQL (`pgvector/pgvector:pg16`), `omega-minio` (`127.0.0.1:9000` API / `127.0.0.1:9001` consola, solo accesible desde loopback), `omega-backend` (`8080`) y `omega-api` (`8000` en red interna).

### 1.3 Diagnóstico de documentos atascados en `LEGAL`
Si un despacho reporta que un PDF lleva más de 10 minutos en `PROCESSING`, el administrador del espacio puede consultar:
- Endpoint: `GET /api/v1/legal/admin/document-issues`
- Muestra documentos con código `PROCESSING_STUCK`, `UNSAFE_PDF`, `INVALID_FORMAT` o `TEXT_UNAVAILABLE` sin exponer el contenido del expediente.

---

## 2. Copias de Seguridad y Restauración Local

Ejecuta el script automatizado [backup_local.ps1](file:///c:/Users/andre/OneDrive/Escritorio/proyectos/CAMPUS/OMEGA/omega/scripts/backup_local.ps1) antes de actualizar versiones o semanalmente durante un piloto:

```powershell
powershell -ExecutionPolicy Bypass -File omega/scripts/backup_local.ps1
```

### Qué respalda
1. **Esquema `omega_rag` en PostgreSQL (`pg_dump -Fc`)**: usuarios, tenants, proyectos `DEVELOPER`, vectores/fragmentos `LEGAL`, cadena `audit_logs`, tickets de soporte e invitaciones.
2. **Manifiesto SHA-256 (`SHA256SUMS.txt`)**: huella criptográfica del volcado para verificar que no sufrió corrupción.
3. **Bóveda MinIO (`omega-vault`)**: si el piloto tiene `OMEGA_STORAGE_RETENTION_ENABLED=true`, sincroniza o exporta el volumen `omega_minio_data`.

### Procedimiento de Restauración (`pg_restore`)
```powershell
# Restaurar un volcado .dump en el contenedor local de PostgreSQL
Get-Content .\backups\<timestamp>\omega_pg.dump -AsByteStream |
  docker exec -i omega-postgres pg_restore -U omega_admin -d omega_cti --clean --if-exists
```
Tras restaurar, verifica siempre la integridad de la cadena de auditoría:
- `GET /api/v1/audit-logs/verify` → debe responder `{"valid": true}`.

---

## 3. Playbook de Respuesta a Incidentes y Baja de Piloto

### Escenario A: Rotación de secretos locales (`OMEGA_JWT_SECRET` / `INTERNAL_SERVICE_TOKEN`)
1. Genera nuevos secretos de 256 bits en PowerShell:
   ```powershell
   python -c "import secrets; print('OMEGA_JWT_SECRET=' + secrets.token_hex(32)); print('INTERNAL_SERVICE_TOKEN=' + secrets.token_hex(32))"
   ```
2. Actualiza `omega/.env` y reinicia `backend-java` y `omega/api`.
3. Todas las sesiones JWT previas y tokens de dispositivo recordado quedan invalidados de inmediato.

### Escenario B: Revocación inmediata de un token CLI o suspensión de un espacio
- **Token CLI (`omega_scan_...`):** desde **Cuenta y Ajustes → Recuperación y Flota → Tokens de API (CLI / CI)** haz clic en **Revocar**, o invoca `DELETE /api/v1/api-tokens/{tokenId}`.
- **Suspender un tenant completo:**
  ```sql
  UPDATE omega_rag.tenants SET active = FALSE WHERE slug = '<slug-del-piloto>';
  ```
  `JwtAuthenticationFilter` y `ApiTokenService` rechazan en el acto cualquier petición de un tenant con `active = FALSE`.

### Escenario C: Finalización de Piloto y Purga Verificable de Datos (Derecho de Supresión)
Cuando un despacho o equipo finaliza su piloto y solicita la destrucción certificada de sus datos:
1. Si `omega-vault` estuvo activo, elimina el prefijo del tenant en MinIO (`tenants/<tenant_id>/`).
2. En PostgreSQL, ejecuta dentro de transacción:
   ```sql
   DELETE FROM omega_rag.tenants WHERE id = '<tenant_id>';
   ```
   *(Todas las tablas `documents`, `rag_chunks`, `expedientes`, `dev_projects`, `dev_scans`, `product_telemetry_events`, `tenant_invitations` y `support_tickets` tienen `ON DELETE CASCADE`).*
3. Entrega al cliente el hash final de verificación o constancia del borrado.
