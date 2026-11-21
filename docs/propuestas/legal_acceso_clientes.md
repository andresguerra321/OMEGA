# Propuesta [PAUSA — Q12]: Acceso de Clientes Externos (Solo Lectura)

> **Estado:** Propuesta de diseño (NO implementada; requiere aprobación antes de escribir código).

## 1. Objetivo
Permitir que un despacho comparta uno o más expedientes específicos con un cliente externo en modo **estrictamente solo lectura**, con expiración automática, revocación inmediata y trazabilidad completa en `audit_logs`.

## 2. Arquitectura propuesta
- **Invitación firmada de un solo uso:** El propietario del expediente o un `ADMIN` genera una invitación dirigida a un correo electrónico y una lista explícita de `expedienteIds` con fecha de expiración obligatoria (p. ej., 7, 15 o 30 días, máximo 90).
- **Almacenamiento seguro del token:** Solo se guarda el hash SHA-256 del token de invitación en `omega_rag.legal_client_invitations(id, tenant_id, invited_email_hash, token_hash, expediente_ids_json, expires_at, revoked_at, created_by)`.
- **Alcance estricto en backend:**
  - Al aceptar la invitación, se crea/asocia un usuario con rol `CLIENT` y grants `READ` exclusivamente sobre los `expedienteIds` autorizados, con columna `expires_at` en `expediente_permissions`.
  - `ExpedienteAuthorizationService` valida `expires_at > NOW()` y `revoked_at IS NULL` en cada petición.
  - El cliente **no** puede ver la lista de otros expedientes, **no** puede gestionar permisos, **no** puede subir/borrar/reindexar documentos ni ver el panel de incidencias del administrador.
- **Revocación inmediata:** Un clic del propietario o `ADMIN` marca `revoked_at = NOW()` y revoca las sesiones activas del cliente; el siguiente request devuelve `403`.
- **Auditoría:** `CLIENT_INVITATION_CREATED`, `CLIENT_INVITATION_ACCEPTED`, `CLIENT_ACCESS_REVOKED`, `CLIENT_ACCESS_EXPIRED` (sin correos en texto plano ni nombres de documentos).

## 3. Modelo de amenazas y riesgos

| Amenaza | Riesgo | Mitigación propuesta |
| --- | --- | --- |
| Reenvío del enlace de invitación a terceros | Acceso no autorizado al expediente | Exigir verificación de identidad + MFA obligatorio al activar la cuenta cliente; token de un solo uso con expiración corta (48 h para aceptar). |
| Escalada horizontal a otros expedientes del despacho | Fuga entre clientes del mismo despacho | Aislamiento en `ExpedienteAuthorizationService` + `LegalFirmSearchService` limitado exclusivamente a grants vigentes con `expires_at > NOW()`. |
| Acceso indefinido tras cerrar el caso | Exposición residual | Expiración obligatoria y revocación automática opcional al cambiar el expediente a estado `CLOSED` o `ARCHIVED`. |
| Filtración de correos en logs o auditoría | Exposición de PII | Almacenar solo hash del correo en auditoría; mostrar correos únicamente en el flujo de gestión autenticado por `ADMIN`/propietario. |
