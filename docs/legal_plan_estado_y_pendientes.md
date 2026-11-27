# Estado y pendientes del Plan del Módulo Legal (Copiloto del Litigante)

- **Fecha de corte:** 26 de noviembre de 2026
- **Rama activa:** `feat/legal-ficha-caso` (`HEAD` base: `532ae45`, apilada sobre `feat/organizaciones-espacios` `af329ee`)
- **Estado de fusión a `main`:** Pendiente (acordado fusionar a `main` tras completar y verificar la Ruta mínima P0: `F0 + F1 + F3 + W13`).
- **Migraciones Flyway aplicadas y validadas:** hasta `V37` (`V34__google_sign_in.sql`, `V35__google_desktop_handoff.sql`, `V36__legal_case_sheet.sql`, `V37__legal_f0_parties_and_membership_guards.sql`).

---

## Decisiones de arquitectura aprobadas

1. **Partes múltiples desde el inicio (W2 / C1):** Adoptada la tabla `omega_rag.legal_case_parties` (`CLIENT`, `COUNTERPARTY`, `OTHER`) con `normalized_name` calculado exclusivamente por una única función en Java (`LegalNameNormalizer`), manteniendo doble escritura con `expedientes.client_name` y `expedientes.counterparty_name`.
2. **Aprobación de contenido jurídico orientativo:** El `ADMIN` / titular de cada espacio aprueba las plantillas/reglas orientativas antes de habilitarlas en su espacio (con cita normativa y fecha de verificación).
3. **Invitación de cuentas individuales existentes (C6):** Permitido invitar a una persona con cuenta `INDIVIDUAL` previa a espacios de una organización activa, conservando su espacio personal raíz aislado y exigiendo MFA / `mfa_at` reciente para operar y cambiar de espacio.
4. **Salida a `main`:** Fast-forward / fusión limpia tras completar la Ruta mínima P0 (`F0 + F1 + F3 + W13`).

---

## 1. Completado y verificado

### Fase F0 completa (`C1` a `C8`) — 100% cerrada
- **`C1` · Normalización única y partes múltiples:**
  - `LegalNameNormalizer.java` (NFD sin tildes, `ñ -> n`, minúsculas `Locale.ROOT`, separadores a espacio, signos eliminados, espacios colapsados y escape literal de `%`, `_`, `\`).
  - `LegalCasePartyService.java` y tabla `omega_rag.legal_case_parties` (`V37`) con clave foránea compuesta `(tenant_id, expediente_id)`, backfill idempotente y doble escritura desde `LegalCaseService` y `ExpedienteService`.
  - `LegalConflictService` consulta únicamente `legal_case_parties.normalized_name` (cero transformación de texto en SQL en tiempo de ejecución).
- **`C2` · Control de acceso, rate limit y cierre de oráculo en `/api/v1/legal/conflicts`:**
  - `@PreAuthorize("hasAnyRole('ADMIN', 'ANALYST')")` en `LegalConflictController` (`CLIENT` recibe `403`).
  - Límite por usuario (`CONFLICT:<userId>`, `30/min` configurable) en `LegalQuotaService` sobre `omega_rag.legal_rate_limit_windows` (`429 Too Many Requests`).
  - `excludeCaseId` filtrado únicamente sobre filas accesibles (`WHERE NOT (accessible AND id = ?)`), eliminando el oráculo sobre `restrictedMatches`.
  - Auditoría `LEGAL_CONFLICT_CHECK` sin registrar el nombre consultado y respuestas uniformes sin enumeración entre espacios.
- **`C3` · Guard único de perfil `LEGAL`:**
  - `LegalProfileAccessConfiguration` (`order = 10`, después de `BillingAccessConfiguration` en `order = 0`) protege `/api/v1/legal/**` y rechaza `GENERAL` y `DEVELOPER` con `403`, manteniendo `402` para cuentas sin plan activo.
  - Prueba parametrizada + verificación contra `RequestMappingHandlerMapping` cubriendo todas las rutas bajo `/api/v1/legal/**`.
- **`C4` · Beans de seguridad obligatorios:**
  - Retirado `@Autowired(required = false)` en dependencias de seguridad de `AuthService`, `TwoFactorService`, `WorkspaceMfaPolicyService`, `LoginRateLimiter`, `PilotOpsService`, `ProfessionalReportService`, `AccountIdentityController`, `ExpedienteService` y `ForensicDossierExportService`.
  - Añadido `SecurityWiringValidator` (`SmartInitializingSingleton`) con pruebas fail-fast en `MandatorySecurityBeansTest`.
- **`C5` · Revisión de seguridad MFA / `mfa_at` / TOTP de un solo uso / 15 min:**
  - `mfa_at` nunca se emite en logins por dispositivo de confianza ni en logins (contraseña o Google) sin desafío 2FA completado; `omega_trusted_device` solo se emite tras `/api/v1/auth/mfa/verify`.
  - `TwoFactorService` con bloqueo atómico anti-replay TOTP (`REQUIRES_NEW` + advisory lock), `noRollbackFor` + `FOR UPDATE` en `confirmEmailSetup` y `resendEmailLoginChallenge`, límite de intentos y limpieza en línea + programada (`purgeExpiredMfaState()`).
  - `ProfessionalReportService.download` y `delete` exigen `mfa_at <= 15 min` en informes de expedientes de espacios `LEGAL` de organización.
  - Auditoría independiente completada con veredicto **`PASS` en `C1`–`C8`**.
- **`C6` · Pendientes de Fase 2b aplicados a Legal:**
  - `ExpedienteService.grantPermission` valida membresía activa en `workspace_memberships` (no `users.tenant_id`).
  - Protección del último `ADMIN` activo de un espacio en `AccountSeatService` (`409 Conflict`) y en triggers de BD `V37` (`trg_workspace_memberships_require_admin` y `trg_users_require_workspace_admin`), preservando la transición `UNCLASSIFIED -> INDIVIDUAL` en `AccountIdentityController`.
  - Invitación y reuso canónico de cuentas individuales existentes hacia organizaciones activas (`V37` + `PilotOpsService.findCanonicalUserInSameOrganization`).
- **`C7` · Numeración Flyway + CI:**
  - Migración de ficha del caso renumerada a `V36__legal_case_sheet.sql` (encima de `V34` y `V35` de Google OIDC) + nueva `V37__legal_f0_parties_and_membership_guards.sql`.
  - `FlywayMigrationFromV29Test` (siembra en `V29`, migra a `V37`, valida con `Flyway.validate()` y ejecuta reversas de `V37` y `V36`) integrado como paso previo en `.github/workflows/backend-tests.yml`.
- **`C8` · Exportes forenses v2 con ficha del caso:**
  - `ForensicDossierExportService` actualizado a `schemaVersion = "omega-dossier-v2"`, con la ficha completa en JSON y PDF, y `computePackageHash` con tramas UTF-8 prefijadas por longitud sin colisiones de delimitador ni `null`.

### Adelantado de Fase F1
- Campos de ficha del caso en backend y frontend (`LegalCaseEditor.jsx`, `ExpedientesPanel.jsx`) con alerta orientativa no bloqueante de conflicto.
- Tabla `omega_rag.legal_case_parties` y normalización única ya en producción de rama.

### Evidencia de pruebas al cierre de F0
- `mvn -B clean test`: **307/307** en verde (`0` fallos, `0` errores, `0` omitidas).
- `npm test` (frontend): **123/123** en verde.
- `vite build`: compilación de producción limpia (`2894` módulos).
- `npx oxlint src`: **0 errores**.

---

## 2. Pendiente para la Ruta mínima (P0)

### Fase F1 restante (`W1` cierre, `W2` resto, `W9` parcial)
- **`W1` · Ficha del caso (cierre):**
  - Validación de caracteres de control en DTOs.
  - Lista configurable de etapas sugeridas por tipo de proceso (permitiendo texto libre).
  - Filtros paginados en el listado de expedientes por `processType`, `caseStage`, `courtName`, `status` y búsqueda por partes sobre `legal_case_parties.normalized_name`.
  - Auditoría de edición registrando únicamente los nombres de los campos modificados (sin almacenar sus valores).
  - UI de filtros y visualización de ficha en el listado y detalle del caso + pruebas de frontend y backend.
- **`W2` · Conflictos de intereses v2 (resto):**
  - Endpoints y UI para agregar/editar/eliminar partes adicionales (`CLIENT`, `COUNTERPARTY`, `OTHER`) en el expediente.
  - Constancia de verificación de conflicto consultable/descargable (quién consultó, cuándo, conteos; sin nombre en claro).
  - Ajuste opcional por espacio para muralla ética (ocultar incluso el conteo `restrictedMatches`).
  - Prueba de rendimiento sobre dataset sintético amplio e índice `pg_trgm` condicional si está disponible.
- **`W9` parcial · Dossier:**
  - Incluir listado completo de partes múltiples (`legal_case_parties`) y constancia de verificación de conflictos en el dossier PDF/JSON.

### Fase F3 (`W3` — Matriz hechos-pruebas)
- Migración aditiva con reversa: tablas `legal_facts`, `legal_evidence` y `legal_fact_evidence` con claves compuestas `(tenant_id, expediente_id)` y columna `version` para bloqueo optimista.
- API CRUD + permisos por caso (`CLIENT` bloqueado en escritura y operaciones medidas).
- Alertas orientativas de riesgo de autenticidad por tipo de prueba (sin hash, captura sin metadatos, sin cadena de custodia, copia sin autenticar, fuente sin fecha), con fuente citada y aviso orientativo.
- Vista de huecos (hechos sin prueba y pruebas sin hecho).
- IA opcional para sugerir hechos candidatos desde fragmentos indexados con cita obligatoria y abstención sin base.
- Exportación de la matriz al dossier PDF/JSON + pestaña **Pruebas** en frontend y pruebas completas.

### `W13` · Orden del repositorio y salida a `main`
- Fusión limpia de `feat/legal-ficha-caso` a `main` y etiqueta de versión.
- Limpieza de ramas obsoletas (`develop`, `codex/mail-template-ci`, `feat/organizaciones-espacios`, `feature/legal-quality`) y revisión de ramas de Dependabot.
- Actualización de `docs/legal_expedientes.md` y `docs/legal_requisitos_para_validar.md`, notas de versión y ensayo de migración con respaldo/reversa.

---

## 3. Pendiente para el Plan completo (post-P0)

- **Fase F4 (`W4` y `W5`):**
  - **`W4` · Contraste del relato con los documentos:** registro del relato del cliente, extracción de afirmaciones y contraste con fragmentos indexados («inconsistencia a verificar», con cita, estado `EXTRACTED`/`CONFIRMED`/`DISMISSED`, operación medida con confirmación de costo, `CLIENT` bloqueado).
  - **`W5` · Revisión adversarial:** puntos débiles y objeciones probables de la contraparte con fragmentos citados obligatorios, marcados como hipótesis y calificables como útil/no útil.
- **Fase F5 (`W6` y `W7`):**
  - **`W6` · Checklist previo a radicar:** plantillas versionadas en BD (`legal_checklist_templates` en estado `DRAFT`/`APPROVED` aprobado por el `ADMIN` del espacio, con referencias normativas) e instancias por expediente (`PENDING`/`DONE`/`NA`, nota y prueba asociada).
  - **`W7` · Calendario de términos asistido:** motor de reglas versionado con días hábiles/festivos y tabla dorada contrastada con fuentes oficiales; propone fechas que siempre confirma el abogado.
- **Fase F6 (`W8`):**
  - Marco de paquetes por área habilitable por espacio y primer paquete: **Contratos** (extracción de cláusulas, partes y vencimientos integrados con `W7`; backlog: Laboral, Familia/sucesiones, Administrativo).
- **Fase F7 (`W10`, `W11` restante y cierre):**
  - **`W10` · Seguridad y privacidad transversal:** actualizar `docs/threat_model_legal.md`, extender pruebas de retención y borrado en cascada (Ley 1581 de 2012), matriz de permisos por rol, nuevos eventos de auditoría y escaneo estático en CI.
  - **`W11` · Interfaz:** consolidar pestañas del espacio de caso (`Ficha`, `Documentos`, `Cronología`, `Pruebas`, `Términos`, `Checklist`, `Conflictos`, `Asistente`, `Informes`) bajo el sistema de diseño de `AGENTS.md`.
  - **`W12` (opcional, no bloqueante):** validación con abogados usando kit de 3 casos sintéticos.

---

## Cómo retomar en la próxima sesión

1. Situarse en `feat/legal-ficha-caso` (confirmar que `mvn -B test` y `npm test` siguen en verde).
2. Iniciar **Fase F1 restante** con migración `V38` (constancia de conflictos / ajuste de muralla ética / filtros normalizados de `W1` y endpoints CRUD de partes adicionales de `W2`).
3. Continuar con **Fase F3 (`W3` Matriz hechos-pruebas)** y cerrar salida a `main` (`W13`).
