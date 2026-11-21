# Propuesta Técnica — Bloque DG (`[PAUSA]`): Monitoreo Continuo de Dependencias

## 1. Objetivo
Reevaluar periódicamente el inventario de dependencias ya registrado (`omega_rag.dev_dependencies`) contra nuevas actualizaciones de advisories (`OSV MAL-*` y feeds firmados de campañas de supply-chain) **sin volver a descargar ni almacenar el código fuente del repositorio**.

## 2. Arquitectura propuesta (Zero-Retention)
1. **Suscripción por proyecto (`omega_rag.dev_monitor_subscriptions`):**
   - La tabla ya fue aprovisionada en la migración `V20` (`tenant_id`, `project_id`, `enabled`, `frequency_hours`, `last_checked_at`, `last_alert_at`, `feed_stale_warning`).
   - Solo usuarios con rol `ADMIN` o `ANALYST` del tenant pueden activar o pausar el monitoreo de un proyecto.
2. **Job programado (`DevContinuousMonitorScheduler`):**
   - Ejecución cada 6 horas (`@Scheduled(fixedDelayString = "${omega.dev.monitor.interval-ms:21600000}")`), deshabilitada por defecto en perfil `test`.
   - Toma únicamente el último `scan_id` de cada proyecto con `enabled = true` y cruza sus tuplas `(ecosystem, package_name, package_version, purl)` contra el catálogo local de advisories OSV/STIX sincronizado.
3. **Deduplicación y supresiones:**
   - Calcula el `fingerprint = sha256(ruleId + "|" + purl)` de cada coincidencia nueva.
   - Si ya existe un `dev_findings` abierto con ese `fingerprint` en el proyecto o una supresión activa en `dev_suppressions`, **no** genera alerta duplicada.
4. **Salud del feed (`feed_stale_warning`):**
   - Si la última actualización exitosa del catálogo OSV/CTI supera las 48 horas, el estado de monitoreo del proyecto marca `feed_stale_warning = true` y muestra un aviso claro en la UI: *"El catálogo de advisories lleva más de 48h sin actualizarse; la vigilancia continua puede no reflejar campañas recientes."*

## 3. Contratos propuestos (para aprobación antes de implementar)
- `GET /api/v1/dev/projects/{projectId}/monitoring` → estado actual (`enabled`, `frequencyHours`, `lastCheckedAt`, `feedStaleWarning`).
- `PUT /api/v1/dev/projects/{projectId}/monitoring` → activar/desactivar y configurar frecuencia (`6`, `12` o `24` horas), registrando `DEV_MONITORING_UPDATED` en `audit_logs`.
- `POST /api/v1/dev/projects/{projectId}/monitoring/evaluate-now` → ejecución bajo demanda sobre el último SBOM almacenado (sujeta a rate-limit de 5 ejecuciones/hora por proyecto).

## 4. Garantías de seguridad
- **Sin acceso a código ni tokens de GitHub:** opera exclusivamente sobre `purl` y coordenadas de paquetes ya extraídas.
- **Aislamiento multi-tenant:** todas las consultas filtran por `(tenant_id, project_id)` con clave foránea compuesta.
