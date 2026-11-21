# Propuesta: Persistencia Opcional de Historial de Consultas por Expediente (LEGAL)

> **Estado:** Propuesta arquitectónica (NO implementada; hoy el historial del asistente es estrictamente efímero en memoria del navegador).

## 1. Motivación
Por defecto, OMEGA **no persiste** preguntas ni respuestas del asistente legal para minimizar la superficie de datos confidenciales y el riesgo de descubrimiento procesal involuntario. Sin embargo, despachos con equipos múltiples podrían solicitar retener opcionalmente un cuaderno de notas de consultas por expediente.

## 2. Diseño propuesto (Opt-in por tenant)
- **Activación explícita:** bandera `legal_chat_history_retention_days` en configuración del tenant (por defecto `0` = desactivado). Solo modificable por `ADMIN` y auditado.
- **Modelo de datos:** tabla `omega_rag.legal_case_chat_turns(id, tenant_id, expediente_id, user_id, question_text, answer_text, citations_json, created_at, expires_at)` con clave foránea `ON DELETE CASCADE` hacia `omega_rag.expedientes(id)`.
- **Borrado en cascada y expiración:**
  - Al borrar el expediente (`DELETE /api/v1/expedientes/{id}`), se eliminan en cascada todos los turnos asociados.
  - Job programado diario elimina turnos con `expires_at < NOW()`.
  - Botón explícito "Purgar historial de consultas" para `ADMIN` / propietario.
- **Riesgos a validar con abogado:** retención frente a secreto profesional, impacto en backups de PostgreSQL y si las preguntas internas del abogado deben excluirse siempre del dossier exportable.
