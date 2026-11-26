# Organizaciones y Espacios Multi-Perfil con Facturación Compartida (Fase 0 — Análisis y Diseño)

- **Estado:** Propuesta en revisión (Fase 0 — solo análisis, sin cambios de código)
- **Rama de trabajo:** `feat/organizaciones-espacios`
- **Próxima migración Flyway:** `V30` (última verificada en repositorio: `V29__repair_scanner_finding_contributions.sql`)
- **Documentos base auditados:** `docs/billing-mercadopago.md`, `docs/roles-workflows.md`, `docs/threat_model_legal.md`

---

## 0. Hallazgos verificados contra el código actual

Antes de modelar la solución se contrastó cada supuesto del requerimiento contra el código fuente real (`omega/backend-java` y `omega/frontend`):

1. **Grafo `graphify-out/`:** No existe directorio `graphify-out/` en el repositorio actual, por lo que el mapa de impacto se construyó mediante inspección estática completa de las 29 migraciones SQL (`V1..V29`), repositorios JPA/`JdbcTemplate`, filtros de seguridad y componentes React.
2. **Valores reales de `TenantEntity.accountType`:** En `V26__billing_credits_and_account_identity.sql` (`chk_tenants_account_type`) existen exactamente **tres** valores: `'INDIVIDUAL'`, `'ORGANIZATION'` y `'UNCLASSIFIED'` (valor por defecto al migrar o antes de clasificar).
3. **Usos reales de perfil (`TenantProfile`) en backend:** Se contabilizaron **95 referencias** a `TenantProfile` / `.getProfile()` / `.profile()` repartidas en **14 clases Java** (detalle exacto en §1.1). Esto confirma que el perfil **debe seguir viviendo en `omega_rag.tenants`** (1 espacio = 1 `tenant_id` = 1 `TenantProfile`).
4. **Identidad de usuario (`UserEntity`), login actual, MFA y llaves foráneas:**
   - `omega_rag.users` tiene `tenant_id UUID NOT NULL` (`updatable = false` en JPA) y restricción `UNIQUE (tenant_id, email)` (`uq_users_tenant_email`). `AuthService.authenticateLogin` resuelve por `(tenantSlug, email)` o por correo único activo (`409` si existen varias filas activas para el mismo correo).
   - `UserEntity` almacena la credencial (`password_hash`) y el segundo factor (`mfa_enabled`, `mfa_totp_secret`, `mfa_backup_codes_json`). Hoy `AuthService.finishLoginOrMfaChallenge` solo exige 2FA cuando `user.isMfaEnabled() && !trustedDevice`, por lo que un login con cookie/token de dispositivo de confianza emite sesión sin verificar segundo factor.
   - Diez tablas referencian directamente `omega_rag.users(id)`: `expedientes.owner_id`, `expediente_permissions.user_id`, `audit_logs.actor_user_id`, `credit_reservations.actor_user_id`, `personal_analysis_workspaces.user_id`, `commercial_acceptances.user_id`, `api_tokens.created_by_user_id`, `password_reset_tokens.user_id`, `account_recovery_keys.user_id` y `mfa_challenges.user_id`.
   - **Implicación clave:** Cada persona conserva **un único `users.id` canónico** y toda pertenencia (incluido su espacio raíz) se registra explícitamente en `workspace_memberships`, leyendo el rol efectivo desde BD en cada petición.
5. **Doble punto de lectura de suscripción y cupos:** Además del paquete `com.omega.platform.billing` (`BillingService`, `CreditService`, `AccountSeatService`, `AccountAccessService`, `BillingController`, `BillingAccessConfiguration`, `CommercialDocuments`), existen `CommercialBillingController` (`com.omega.platform.web`) y `CommercialSaasService` (`com.omega.platform.saas`), que también consultan `subscriptions` por `tenant_id` y aplican el tope de flota (`max_devices`: 1 / 5 / 25). El resolver de facturación debe cubrir ambos paquetes.
6. **Autenticación no interactiva (CI y Webhooks GitHub):** `ApiTokenAuthenticationFilter` (`omega_scan_...`) y `GitHubPullRequestScannerService` fijan `TenantContext` al `tenant_id` del espacio `DEVELOPER`. Cuando sus operaciones consumen créditos (`CreditMeteringConfiguration` → `CreditService`), el cargo debe resolverse transparentemente hacia el `billing_tenant_id` de la organización sin alterar el `tenant_id` donde se guardan `dev_projects`, `dev_scans` y `dev_findings`.

---

## 1. Mapa de impacto completo (`tenant_id`, facturación, usuarios y perfil)

### 1.1 Backend Java (`omega/backend-java`)

| Dominio | Clases afectadas | Dependencia actual de `tenant_id` / `profile` | Acción requerida |
| :--- | :--- | :--- | :--- |
| **Facturación, créditos y acceso comercial** | `BillingService`, `CreditService`, `CreditMeteringConfiguration`, `AccountSeatService`, `AccountAccessService`, `BillingPolicy`, `BillingController`, `BillingAccessConfiguration`, `CommercialDocuments`, `CommercialBillingController` | Todas indexan `subscriptions`, `credit_grants`, `credit_reservations`, `billing_checkouts`, `billing_payments`, `billing_customer_details` y `commercial_acceptances` directamente por `scope.tenantId()`. `BillingPolicy.freeWorkspace` evalúa `(accountType == INDIVIDUAL && profile == GENERAL)`. | Introducir `BillingAccountResolver` (`resolveBillingTenantId(workspaceTenantId)`). Suscripción, bolsa de créditos, puestos, datos fiscales y comprobantes usan `billingTenantId`; `profile` sigue leyéndose del `workspaceTenantId` activo. **No se tocan** `MercadoPagoClient`, firma de webhook ni conciliación de pagos. |
| **Flota SaaS e invitaciones** | `CommercialSaasService`, `PilotOpsService`, `PilotOpsController` | `CommercialSaasService` busca suscripción por `tenantId` y limita `devices` activos por tenant (`1 / 5 / 25`). `PilotOpsService` invita miembros verificando `AccountSeatService.requireSeatAvailable(tenantId)`. | `CommercialSaasService` resuelve la suscripción por `billingTenantId` y cuenta dispositivos activos agregados en los espacios que comparten ese `billingTenantId`. `PilotOpsService` crea/asocia membresías respetando el tope global de puestos de la organización. |
| **Autenticación, JWT y contexto de seguridad** | `JwtService`, `JwtAuthenticationFilter`, `AuthService`, `AuthController`, `AuthDtos`, `OmegaPrincipal`, `TenantScope`, `TenantContext`, `UserRepository`, `ApiTokenAuthenticationFilter` | `JwtService` firma `(sub=userId, tid=tenantId, role, email)`. `JwtAuthenticationFilter` exige `userRepository.findActiveUserInActiveTenant(userId, tenantId)` donde `u.tenantId = :tenantId` y confía en el `role` del JWT. | Mantener **JWT de un solo `tid`** (Regla #1). Añadir claim `mfa_at` (epoch seconds de verificación real de 2FA; omitido en logins por dispositivo de confianza). `JwtAuthenticationFilter` valida membresía activa en `workspace_memberships` (incluido el espacio raíz) y **carga el `role` efectivo desde BD en cada petición**, nunca desde el JWT. Añadir `POST /api/v1/auth/switch-workspace`. |
| **Perfil de espacio y aislamiento Legal / Dev / General** | `ProfileConfigController` (13 refs), `DocumentIngestionService` (12), `TenantProfileConfigService` (9), `TenantEntity` (7), `HybridRagQueryService` (5), `LegalQuotaService` (2), `LegalDocumentAiService` (1), `ProfessionalReportController` (1), `ExpedienteService`, `DeveloperSecurityService`, `GeneralSecurityService` | Las 95 referencias leen el perfil y filtran datos estrictamente por `TenantContext.get().tenantId()`. `ProfileConfigController` llama `credits.requirePaid(scope.tenantId())` al pasar a `DEVELOPER` o `LEGAL`. | **Cero cambios en las consultas de dominio**: cada espacio conserva su propio `tenants.id` y su propio `TenantProfile`. Bloquear que el espacio pagador (`billing_tenant_id`) adopte perfil `LEGAL`. `credits.requirePaid(scope.tenantId())` delega al `BillingAccountResolver`. |
| **Informes profesionales y auditoría** | `ReportSnapshotService`, `ProfessionalReportController`, `AuditLogService` | `report_snapshots` y `audit_logs` están encadenados y aislados por `tenant_id` de cada espacio. | Los informes técnicos/legales siguen aislados por espacio. En Fase 5 se añade un informe ejecutivo **exclusivo de organización** alimentado solo por conteos agregados y consumo de créditos, jamás por tablas de contenido o evidencia. |

### 1.2 Tablas PostgreSQL (`omega_rag.*`, migraciones `V1..V29`)

Clasificación exhaustiva de las **55 sentencias `CREATE TABLE`** existentes en `V1..V29` (`10 + 8 + 3 + 9 + 14 + 11 = 55`):

1. **Tablas de facturación y comercio (10 tablas — resuelven vía `billing_tenant_id` en Diseño A, sin migrar PK/FK):**
   - `billing_plans` (catálogo global, sin `tenant_id`).
   - `subscriptions` (`UNIQUE (tenant_id)` → fila única en `billing_tenant_id`).
   - `billing_checkouts` (`tenant_id` → `billing_tenant_id`).
   - `billing_payments` (`tenant_id` → `billing_tenant_id`).
   - `billing_events` (bitácora idempotente de eventos/webhooks de pasarela; `tenant_id` nullable resuelto al `billing_tenant_id`).
   - `credit_grants` (`tenant_id` → bolsa compartida en `billing_tenant_id`).
   - `credit_reservations` (`tenant_id` = `billing_tenant_id` para bloqueo atómico de saldo; se agrega columna nullable `workspace_tenant_id UUID` en `V30` para medir consumo por espacio sin exponer contenido).
   - `credit_allocations` (asignación FIFO `reservation_id ↔ grant_id`, ligada transitivamente al `billing_tenant_id`).
   - `billing_customer_details` (`PRIMARY KEY (tenant_id)` → `billing_tenant_id`).
   - `commercial_acceptances` (`PRIMARY KEY (tenant_id, user_id, version)` → `billing_tenant_id`).
2. **Tablas de identidad, credenciales, MFA y gobierno (8 tablas existentes + 3 tablas nuevas en `V30`):**
   - Existentes: `tenants` (1 espacio con su `profile`), `users` (identidad canónica con credenciales y MFA), `password_reset_tokens` (`user_id` canónico), `account_recovery_keys` (`user_id` canónico), `mfa_challenges` (`user_id` canónico), `auth_rate_limits` (control de intentos por IP/correo, sin `tenant_id`), `tenant_invitations`, `transactional_mail`.
   - Nuevas en `V30`: `organizations`, `organization_members`, `workspace_memberships` (detalle en §3).
3. **Catálogos globales de inteligencia y cola transversal sin `tenant_id` (3 tablas):**
   - `campaigns` (catálogo global STIX 2.1, `V3`), `ioc_indicators` (indicadores globales IoC, `V3`), `corpus_discovery_queue` (cola global de curaduría documental, `V6`).
4. **Tablas operativas estrictamente aisladas por espacio (34 tablas — usan siempre el `tid` del JWT y NUNCA pasan por `BillingAccountResolver`):**
   - **Secreto profesional `LEGAL` (9 tablas):** `expedientes`, `expediente_permissions`, `documents`, `document_chunks`, `legal_timeline_events`, `legal_document_ai_consents`, `legal_rate_limit_windows`, `legal_indexing_inflight`, `legal_document_observations`.
   - **Seguridad `DEVELOPER` (14 tablas):** `dev_projects`, `dev_scans`, `dev_findings`, `dev_finding_comments`, `dev_suppressions`, `dev_dependencies`, `dev_policies`, `dev_monitor_subscriptions`, `api_tokens`, `repo_scan_usage`, `github_app_installations`, `github_oauth_states`, `github_webhook_deliveries`, `github_repo_daily_usage`.
   - **Seguridad `GENERAL`, telemetría, flota, informes y auditoría por espacio (11 tablas):** `devices` (aislado por espacio en operación, contabilizado en bolsa compartida frente a `max_devices` de la organización), `osint_monitored_assets`, `personal_analysis_workspaces`, `analysis_evaluations`, `recorded_analysis_jobs`, `report_snapshots`, `audit_logs` (cadena SHA-256 propia por espacio), `alert_dispatches`, `ai_usage_quotas`, `product_telemetry_events`, `support_tickets`.

### 1.3 Pantallas y pruebas en Frontend (`omega/frontend`)

| Archivo | Estado actual | Impacto planificado (Fase 4) |
| :--- | :--- | :--- |
| `src/App.jsx` y `src/components/SpatialNavPill.jsx` | Construyen `NAV_ITEMS` según `profile` del tenant único en sesión; no existe selector de espacio. | Añadir selector compacto de espacio activo en la cabecera (solo visible si el usuario pertenece a >1 espacio o gestiona una organización). Al cambiar de espacio: reemitir JWT, limpiar cachés locales de expedientes/proyectos/chat y recargar `profileConfig` + `billingSummary`. |
| `src/components/MembershipGate.jsx` | Bloquea el módulo si `!state.summary?.workspaceAccess`. Ofrece bajar a `GENERAL` gratis solo cuando `accountType === 'INDIVIDUAL'`. | Evaluar elegibilidad por espacio (`workspaceAccess` resuelto en backend combinando el `profile`/`accountType` del espacio activo con la suscripción pagada del `billing_tenant_id`). Si un miembro sin rol de facturación entra a un espacio cuya organización expiró, mostrar aviso claro hacia el administrador de la organización en lugar de formulario de cobro roto. |
| `src/components/BillingPanel.jsx` y `CommercialBillingPanel.jsx` | Asumen 1 cuenta = 1 espacio; muestran historial de movimientos crudos (`operation_code`) y formulario de clasificación `INDIVIDUAL` vs `ORGANIZATION`. | Mostrar si el plan cubre una organización multi-espacio, desglose de créditos consumidos **por espacio** (solo nombre del espacio, perfil y créditos gastados, sin detalle de documentos ni repositorios) y restringir mutaciones de plan/checkout a `ORG_OWNER` / `ORG_ADMIN` del espacio pagador. |
| `src/components/AccountSettingsPanel.jsx` | Secciones fijas (`cuenta`, `plan`, `informes`, `comercial`, `permisos`, etc.) y cambio de perfil directo sobre el tenant actual. | Incorporar sección **Organización y espacios** para `ORG_OWNER` / `ORG_ADMIN` (crear espacio con su perfil, asignar miembros, ver consumo por espacio y puestos ocupados). |
| `src/components/OnboardingTourModal.jsx` / flujo post-login | Pregunta perfil o arranca en el único espacio del usuario. | Onboarding *"¿Qué haces tú?"* que enrute al usuario recién invitado al espacio cuyo `TenantProfile` coincida con su rol/profesión (si tiene varios disponibles) o guíe al dueño de organización a crear sus espacios iniciales. |
| `src/components/accountBillingNavigation.test.js`, `profileAdaptive.test.js`, `legalNavigation.test.js` | Prueban `MembershipGate`, precios desde menú de cuenta y navegación adaptativa por perfil. | Mantener 100% en verde las pruebas actuales y añadir cobertura para selector de espacio, `MembershipGate` multi-espacio y consola de organización. |

---

## 2. Comparativa de diseños de facturación y recomendación

### 2.1 Diseño A: Espacio principal de facturación (`billing_tenant_id`) + `BillingAccountResolver`

- **Cómo funciona:**
  - Se crea `omega_rag.organizations` como entidad de gobierno (nombre, slug, `owner_user_id`, `billing_tenant_id`), y en `omega_rag.tenants` se añaden dos columnas opcionales (`organization_id UUID NULL`, `billing_tenant_id UUID NULL`).
  - Para cuentas individuales o legadas sin organización: `organization_id IS NULL` y `billing_tenant_id IS NULL`.
  - Un único componente `BillingAccountResolver.resolveBillingTenantId(UUID workspaceTenantId)` devuelve `COALESCE(tenant.billing_tenant_id, tenant.id)` tras validar que tanto el espacio hijo como el tenant pagador estén activos y pertenezcan a la **misma** `organization_id`.
  - `subscriptions`, `credit_grants`, `credit_reservations`, `billing_checkouts`, `billing_payments`, `billing_customer_details` y `commercial_acceptances` permanecen en sus tablas actuales sin cambiar sus llaves primarias ni foráneas; todas las lecturas/escrituras comerciales usan `billingTenantId`.
  - En `credit_reservations` se añade únicamente `workspace_tenant_id UUID NULL REFERENCES omega_rag.tenants(id)` para saber cuántos créditos consumió cada espacio (Fase 3) mientras el bloqueo `pg_advisory_xact_lock` y el descuento FIFO de `credit_grants` siguen ocurriendo de forma atómica bajo un solo `billingTenantId`.

### 2.2 Diseño B: Migrar suscripción y créditos a `organization_id`

- **Cómo funciona:**
  - Se reemplaza o duplica `tenant_id` por `organization_id` en `subscriptions`, `credit_grants`, `credit_reservations`, `billing_checkouts`, `billing_payments` y `billing_customer_details`.
  - Obliga a una de dos cosas: (1) crear organizaciones sintéticas ("organización de 1 persona") para todas las cuentas `INDIVIDUAL` existentes y hacer backfill de datos históricos, o (2) soportar llaves polimórficas `(tenant_id NULL, organization_id NULL)` con `CHECK (num_nonnulls(...) = 1)` en 7 tablas críticas.

### 2.3 Matriz comparativa

| Criterio | Diseño A (`billing_tenant_id` + `BillingAccountResolver`) | Diseño B (`organization_id` en tablas de facturación) |
| :--- | :--- | :--- |
| **Regla #3 (Aditivo, cuentas actuales intactas, reversa limpia)** | **Cumple al 100%.** Columnas `NULL` aditivas; una cuenta actual sin organización resuelve `COALESCE(NULL, id) = id` sin backfill destructivo. | **Riesgo alto.** Exige backfill de todas las filas históricas o restricciones polimórficas complejas difíciles de revertir sin pérdida de datos. |
| **Regla #4 (No tocar flujo Mercado Pago ni webhook)** | **Cumple al 100%.** `billing_checkouts.tenant_id` sigue siendo un `tenants.id` real (`billing_tenant_id`). El webhook, `external_reference` y la conciliación funcionan sin tocar una sola línea de Mercado Pago. | **Incumple o fuerza parches.** El webhook y la conciliación leen `billing_checkouts.tenant_id` y `subscriptions.tenant_id`; migrarlos a `organization_id` obliga a reescribir el flujo de acreditación de pagos. |
| **Atomicidad de créditos y puestos (concurrencia)** | **Simple y probada.** `CreditService.lock(billingTenantId)` serializa en PostgreSQL todas las reservas concurrentes de todos los espacios de la misma empresa sobre los mismos `credit_grants`. | Equivalente si todo migra, pero propenso a condiciones de carrera si conviven saldos por `tenant_id` y por `organization_id`. |
| **Atribución de consumo por espacio (Fase 3)** | Se resuelve limpiamente con una sola columna aditiva `workspace_tenant_id` en `credit_reservations`. | Igual requeriría `workspace_tenant_id` para desglosar por espacio. |
| **Radio de impacto en pruebas existentes** | Mínimo (`BillingIntegrationTest` y `BillingRulesTest` siguen operando igual cuando `billing_tenant_id IS NULL`). | Muy alto (rompe fixtures SQL y repositorios de facturación actuales). |

### 2.4 Recomendación definitiva

**Se recomienda el Diseño A (`billing_tenant_id` + `BillingAccountResolver` respaldado por tabla `omega_rag.organizations`).**

Satisface las cinco reglas no negociables con riesgo mínimo: mantiene intactos Mercado Pago, webhooks, planes y cuentas individuales legadas, garantiza atomicidad FIFO en la bolsa compartida mediante el mismo `advisory lock` de `CreditService`, y añade `organizations` únicamente donde aporta valor real (gobierno de espacios, administradores de organización e informes agregados).

> **Invariante de seguridad del resolver (en BD y en código):**
> Un espacio `T` solo puede tener `billing_tenant_id = B` si:
> 1. `B = T` (cuenta sin organización o espacio principal de la organización), **o**
> 2. `T.organization_id IS NOT NULL`, `B.organization_id = T.organization_id`, y `B.id = organizations.billing_tenant_id`.
> Esto se blinda con llave foránea compuesta en PostgreSQL (`FOREIGN KEY (organization_id, billing_tenant_id)` contra un índice único `(id, billing_tenant_id)` en `organizations`), impidiendo por construcción que un espacio apunte al `billing_tenant_id` de otra organización.

---

## 3. Modelo de pertenencia, roles y cambio seguro de espacio

### 3.1 Estructura de datos (`V30`), orden de creación y topes opcionales por espacio

1. **`omega_rag.organizations`**
   - `id UUID PRIMARY KEY`
   - `name VARCHAR(160) NOT NULL`
   - `slug VARCHAR(80) NOT NULL UNIQUE`
   - `billing_tenant_id UUID NOT NULL UNIQUE REFERENCES omega_rag.tenants(id)`
   - `owner_user_id UUID NOT NULL REFERENCES omega_rag.users(id)`
   - `legacy_legal_payer BOOLEAN NOT NULL DEFAULT FALSE` *(excepción heredada únicamente si una cuenta preexistente a `V30` ya tenía `profile = 'LEGAL'` al convertirse en organización, evitando mover filas de facturación)*
   - `active BOOLEAN NOT NULL DEFAULT TRUE`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `UNIQUE (id, billing_tenant_id)` (soporte para FK compuesta desde `tenants`).
2. **Columnas aditivas en `omega_rag.tenants`**
   - `organization_id UUID NULL REFERENCES omega_rag.organizations(id)`
   - `billing_tenant_id UUID NULL REFERENCES omega_rag.tenants(id)`
   - `credit_limit_override INTEGER NULL CHECK (credit_limit_override IS NULL OR credit_limit_override >= 0)` *(diseño preparado para tope opcional de créditos por espacio; sin aplicar enforcement aún)*
   - `device_limit_override INTEGER NULL CHECK (device_limit_override IS NULL OR device_limit_override >= 0)` *(diseño preparado para tope opcional de dispositivos por espacio; sin aplicar enforcement aún)*
   - `CHECK ((organization_id IS NULL AND billing_tenant_id IS NULL) OR (organization_id IS NOT NULL AND billing_tenant_id IS NOT NULL))`
   - `FOREIGN KEY (organization_id, billing_tenant_id) REFERENCES omega_rag.organizations(id, billing_tenant_id) DEFERRABLE INITIALLY IMMEDIATE`
3. **`omega_rag.organization_members`** (gobierno administrativo de la organización, **sin** acceso automático a datos de espacios)
   - `(organization_id UUID, user_id UUID)` PK + índice `idx_organization_members_user_id (user_id)`
   - `org_role VARCHAR(24) NOT NULL CHECK (org_role IN ('ORG_OWNER', 'ORG_ADMIN', 'MEMBER'))`
   - `active BOOLEAN NOT NULL DEFAULT TRUE`, `created_at`, `created_by_user_id`
4. **`omega_rag.workspace_memberships`** (única fuente de verdad de acceso y rol por espacio, **incluido el espacio raíz**)
   - `(tenant_id UUID REFERENCES omega_rag.tenants(id), user_id UUID REFERENCES omega_rag.users(id))` PK + índice `idx_workspace_memberships_user_id (user_id)`
   - `role VARCHAR(24) NOT NULL CHECK (role IN ('ADMIN', 'ANALYST', 'CLIENT'))`
   - `active BOOLEAN NOT NULL DEFAULT TRUE`, `created_at`, `updated_at`, `granted_by_user_id`
   - **Backfill + trigger de sincronización + FKs compuestas en `V30`:** Se inserta una membresía raíz para cada fila existente en `omega_rag.users` (`ON CONFLICT DO NOTHING`), se instala el trigger `AFTER INSERT OR UPDATE OF role, active ON omega_rag.users` (`sync_root_workspace_membership()`) y se re-apuntan las 8 llaves foráneas compuestas `(tenant_id, user_id)` (`expedientes`, `expediente_permissions`, `documents`, `osint_monitored_assets`, `devices`, `ai_usage_quotas`, `api_tokens` y `legal_document_ai_consents`) hacia `workspace_memberships(tenant_id, user_id)` conservando `ON DELETE RESTRICT/CASCADE`. La reversa documentada aborta con mensaje explícito si existen membresías o dueños/actores cruzados entre tenants antes de restaurar las FKs y eliminar tablas/columnas.
5. **Columna aditiva en `omega_rag.credit_reservations`**
   - `workspace_tenant_id UUID NULL REFERENCES omega_rag.tenants(id) ON DELETE SET NULL` (registra en qué espacio se originó el gasto; jamás guarda nombres de archivos, casos ni repositorios).
6. **Deprecación controlada de `omega_rag.users.role` (sincronización hasta Fase 2a):**
   - `users.role` queda en **desuso funcional** como fuente de autorización.
   - **Usos directos auditados hoy:** SQL en `BillingJobReconciler.java:19` (y migración histórica `V26:7`); JPA/Java en `UserEntity`, `JwtAuthenticationFilter.java:117`, `AuthService.java` (altas, challenge MFA, emisión de token y `/me`), `PilotOpsService.java` (aceptación de invitación), `AccountIdentityController.java:36-43` y `ContainmentAuthorizationService.java:33-34`.
   - **Puente Fase 1 → Fase 2a:** Durante Fase 1 el trigger `sync_root_workspace_membership()` replica automáticamente todo `INSERT`/`UPDATE` de `users.(role, active)` hacia `workspace_memberships`, por lo que `AccountSeatService` cuenta desde ya sobre `workspace_memberships` sin brechas. En Fase 2a todos los lectores pasan a `workspace_memberships.role`.
6. **Orden determinista de creación entre `organizations` y `tenants` (2 pasos en una misma `@Transactional`):**
   - **Alta inicial de organización:** (Paso 1) se inserta o toma el `tenants` pagador administrativo con `organization_id = NULL, billing_tenant_id = NULL`; (Paso 2) se inserta `organizations` apuntando `billing_tenant_id` a ese `tenant.id`; (Paso 3) se actualiza el `tenant` pagador fijando `(organization_id, billing_tenant_id)` y se insertan `organization_members` y `workspace_memberships`. La FK `DEFERRABLE INITIALLY IMMEDIATE` permite además operaciones atómicas de reasignación controlada dentro de una transacción si fuera necesario.
   - **Alta de espacios hijos:** como `organizations` ya existe, cada espacio hijo se inserta en un único `INSERT INTO omega_rag.tenants (..., organization_id, billing_tenant_id)` seguido de su `workspace_memberships`.
7. **Diseño de topes opcionales por espacio (diferido, sin implementar aún):**
   - Cuando `credit_limit_override` o `device_limit_override` son `NULL` (valor por defecto), el espacio consume libremente de la bolsa global del `billing_tenant_id`. En una fase futura, `CreditService` y `CommercialSaasService` evaluarán bajo el mismo lock `billing:<billingTenantId>` el menor entre el saldo/cupo disponible de la organización y `(override - usoDelEspacioEnPeriodo)`, permitiendo acotar el consumo por cliente en consultoras sin dividir la suscripción.

### 3.2 Espacio pagador, conversión sin mover facturación, titularidad y custodia `LEGAL`

1. **Espacio pagador administrativo/neutro y excepción heredada `LEGAL`:**
   - En **organizaciones nuevas**, el espacio pagador (`organizations.billing_tenant_id`) **tiene prohibido el perfil `LEGAL`** (solo `GENERAL` o `DEVELOPER`), y ningún espacio pagador existente puede cambiar su perfil hacia `LEGAL` (`ProfileConfigController` + trigger en BD).
   - **Única excepción heredada (`legacy_legal_payer = TRUE`):** Blindada por trigger en BD (`pre_v30_billing_history`): solo puede ser `TRUE` si la cuenta ya tenía perfil `LEGAL` **y** registraba un pago aprobado en `billing_payments` o una suscripción con plan distinto de `FREE` / `paid_verified = TRUE` **antes de `V30`** (una fila `FREE` no califica). Conserva las mismas protecciones reforzadas (no desactivable ni borrable mientras existan espacios hijos, y una transferencia de titularidad de la organización **no** concede membresía ni lectura sobre ese espacio `LEGAL` heredado).
   - **Bloqueo de baja o borrado:** Trigger en BD y validación de servicio prohíben desactivar (`active = false`) o eliminar el espacio pagador mientras exista cualquier otro espacio (`tenants.id <> billing_tenant_id`) en la organización.
   - **Exclusividad de facturación:** Solo `ORG_OWNER` o `ORG_ADMIN` de la organización pagadora pueden crear checkouts, cambiar plan, cancelar suscripción o editar `billing_customer_details`. Un `ADMIN` de un espacio hijo no pagador recibe `403 Forbidden`.
2. **Conversión a organización (`INDIVIDUAL` u `ORGANIZATION` preexistente) y transferencia de titularidad:**
   - **Prohibición absoluta de mover filas de facturación:** En ninguna conversión se mueven filas de `subscriptions`, `billing_payments`, `billing_checkouts`, `credit_grants`, `credit_reservations`, `credit_allocations` ni `billing_customer_details` a otro `tenant_id`, preservando intactos los `external_reference` y la conciliación de Mercado Pago. La conversión **siempre** adopta como `billing_tenant_id` el tenant que ya paga (cubriendo tanto cuentas `INDIVIDUAL` como cuentas `ORGANIZATION` ya existentes sin fila en `organizations`).
   - **Transferencia de titularidad (`ORG_OWNER`):** Ejecutable solo por el `ORG_OWNER` actual con `mfa_at` reciente (`<= 15 min`) hacia otro miembro activo con `mfa_enabled = true`; degrada al titular saliente a `ORG_ADMIN`, actualiza `organizations.owner_user_id` (y `tenants.owner_user_id` del espacio pagador solo si no es `LEGAL`), **sin otorgar `workspace_memberships` en ningún espacio `LEGAL`** (incluido un pagador `LEGAL` heredado), y audita `ORG_OWNERSHIP_TRANSFERRED`.
3. **Secreto profesional `LEGAL`, doble custodio recomendado y reemplazo diferido 72 h:**
   - Ser `ORG_OWNER` u `ORG_ADMIN` **nunca** otorga membresía implícita en espacios `LEGAL` ni permisos en `expediente_permissions`. Las altas ordinarias en un espacio `LEGAL` solo las ejecuta un `ADMIN` activo de ese espacio `LEGAL`.
   - **Mínimo 2 `ADMIN` recomendados:** Advertencia visible cuando un espacio `LEGAL` tiene `< 2` `ADMIN` activos y bloqueo para que el último `ADMIN` activo se degrade o desactive a sí mismo.
   - **Reemplazo auditado de custodio (`custodian-handover`):** Solo se habilita si el sistema verifica en BD que **no queda ningún `ADMIN` activo con `mfa_enabled = true`** en ese espacio `LEGAL`. Inicia una **espera obligatoria de 72 horas** enviando aviso inmediato a los administradores previos (cancelable si alguno recupera acceso); el **`ORG_OWNER` nunca puede designarse a sí mismo** (`targetUserId <> owner_user_id`). Al cumplirse el plazo, solo escribe el alta del nuevo `ADMIN` en `workspace_memberships`, sin leer ni exponer expedientes/documentos y registrando `LEGAL_CUSTODIAN_REPLACED`.

### 3.3 Regla de conteo de puestos (`AccountSeatService`), rol `CLIENT` y tokens API

- **Puestos (`max_users`):** Se bloquean sobre `billing_tenant_id` y cuentan **personas humanas activas distintas** (`COUNT(DISTINCT wm.user_id)`) con membresía activa de rol **`ADMIN` o `ANALYST`** en espacios activos de la organización (sincronizados por trigger desde `users` en Fase 1). El rol **`CLIENT` no consume puesto**. `AccountSeatService.assignWorkspaceMembership` solo valida cupo y escribe la membresía: **no autoriza** al invocador y únicamente puede llamarse desde servicios/endpoints que ya hayan verificado permisos explícitos.
- **Alcance del rol `CLIENT`:** Estricto modo lectura sobre recursos expresamente habilitados (p. ej. consulta de estado puntual o expedientes con permiso de lectura); **no puede ejecutar operaciones medidas con consumo de créditos** (análisis IA, indexación, escaneos SAST/YARA, triaje forense ni emisión de tokens CI).
- **Flota (`max_devices`):** Bolsa compartida global entre todos los espacios activos bajo el mismo `billing_tenant_id`.
- **Ciclo de vida de `api_tokens` (`omega_scan_...`):** En Fase 2a, al perder la membresía activa en `workspace_memberships` (o pasar a `CLIENT` / usuario inactivo), los `api_tokens` creados por ese usuario en ese espacio quedan invalidados en autenticación y se revocan (`revoked_at = now()`).

### 3.4 Login de invitados, cuentas duplicadas, `mfa_at` y cambio de espacio (`switch-workspace`)

1. **Login de miembros invitados y cuentas duplicadas legadas:**
   - **Invitación a correo nuevo o existente:** Correo nuevo crea su `UserEntity` canónico (disparando su membresía raíz por trigger); correo ya existente en `users` reutiliza su `users.id` canónico agregando fila en `workspace_memberships`. `AuthService.authenticateLogin` resuelve por membresía activa en el `tenantSlug` indicado o entra al espacio principal del usuario único.
   - **Cuentas duplicadas legadas con el mismo correo:** **Se pospone su fusión** fuera de este ciclo; siguen operando de forma aislada y compatible desambiguando mediante `tenantSlug`.
2. **Rol efectivo leído de BD en cada petición (Fase 2a):**
   - `JwtAuthenticationFilter` valida en cada request `users.active`, `tenants.active` y `workspace_memberships.active` para `(sub, tid)`, cargando el **`workspace_memberships.role` en vivo desde PostgreSQL** (nunca del JWT).
3. **Política de MFA (`mfa_at`), dispositivos de confianza y step-up TOTP (Fase 2a):**
   - **MFA obligatorio en multi-membresía:** Todo usuario con `> 1` membresía activa (o rol `ORG_OWNER` / `ORG_ADMIN`) debe tener `user.isMfaEnabled() == true`.
   - **Claim `mfa_at` y exclusión de `trusted-device`:** `JwtService` emite `mfa_at` solo tras verificación real de 2FA; un login por **dispositivo de confianza emite `mfa_at = null`**, que nunca sirve para cambiar de espacio ni para entrar a espacios `LEGAL` de organización.
   - **Alcance de `mfa_at` reciente en `LEGAL`:** La exigencia de `mfa_at` reciente (`<= 15 min`) aplica **solo a espacios `LEGAL` que pertenecen a una organización (`organization_id IS NOT NULL`)**; las cuentas `LEGAL` existentes sin organización no cambian (`R8`). Se evalúa **al iniciar sesión en el espacio, en `switch-workspace` y en acciones sensibles** (no en cada petición ordinaria).
   - **Step-up TOTP de un solo uso y rate-limit:** Cada código TOTP usado en step-up se marca/consume para impedir replay dentro de su ventana temporal y aplica límite estricto de intentos en `omega_rag.auth_rate_limits`.
4. **Cambio de espacio (`POST /api/v1/auth/switch-workspace`):**
   - Valida membresía activa en `targetTenantId`, `user.isMfaEnabled() == true` y `mfa_at` vigente (o consume `totpCode` de un solo uso), emite **JWT HS256 de UN solo `tid`** rotando la cookie `HttpOnly` y audita `WORKSPACE_SWITCHED` en origen y destino.

### 3.5 Regla comercial de acceso pagado por espacio (Regla #5)

`BillingPolicy.workspaceAccess(accountType, profile, subscriptionStatus)` se mantiene intacta:
- Si el espacio pertenece a una organización (`organization_id IS NOT NULL`), su `accountType` es siempre `'ORGANIZATION'`. Por tanto, `BillingPolicy.freeWorkspace` devuelve **`false`** para **todos** sus espacios (incluso un espacio con perfil `GENERAL` dentro de una organización requiere pago verificado en `billing_tenant_id`).
- Solo una cuenta `INDIVIDUAL` sin organización y en perfil `GENERAL` conserva acceso gratuito.
- Ningún cambio de espacio, creación de espacio ni cambio de perfil permite operar en `ORGANIZATION`, `DEVELOPER` o `LEGAL` si el `billing_tenant_id` resuelto no tiene estado pagado verificado (o ventana de gracia pospago previamente confirmada).

---

## 4. Riesgos de seguridad y matriz de pruebas

| # | Riesgo de seguridad | Mitigación de diseño | Prueba automatizada concreta |
| :--- | :--- | :--- | :--- |
| **R1** | **Fuga cross-space (IDOR / confusión de `tenantId`)** al leer expedientes, documentos, chunks RAG, proyectos Dev o activos OSINT. | `tenantId` de datos sale **únicamente** de `TenantContext` (poblado por el `tid` único del JWT o `ApiToken`). Prohibido recibir `tenantId` por query/header/body en endpoints de dominio. | **Test de integración:** Usuario con membresía en Espacio A y Espacio B usa JWT del Espacio A para pedir por UUID un expediente/documento/proyecto del Espacio B → recibe `404`/`403` y cero bytes filtrados. |
| **R2** | **Violación del secreto profesional `LEGAL` por el dueño o admin de la organización.** | `ORG_OWNER` / `ORG_ADMIN` no concede `workspace_memberships` sobre espacios `LEGAL` ni permisos en `expediente_permissions`; alta de miembros en espacio `LEGAL` restringida al `ADMIN` de ese espacio `LEGAL`; informes de dueño sin acceso a tablas de dominio. | **Test de integración:** `ORG_OWNER` de Org X intenta: (a) `switch-workspace` hacia un espacio `LEGAL` donde no es miembro → `403`; (b) auto-agregarse como miembro de ese espacio `LEGAL` desde endpoints de Org Admin → `403`; (c) consultar informe ejecutivo → verifica que el JSON/PDF no contenga nombres de expedientes, documentos ni clientes. |
| **R3** | **Escalada horizontal entre organizaciones (Admin de Org X gestionando Org Y o apuntando `billing_tenant_id` ajeno).** | Todos los endpoints `/api/v1/organizations/**` validan pertenencia `ORG_OWNER`/`ORG_ADMIN` sobre la organización resuelta; FK compuesta `(organization_id, billing_tenant_id)` impide enlazar facturación de otra organización. | **Test de integración:** Admin de Org X intenta listar/crear espacios, cambiar miembros o consumir créditos contra `organizationId` / `billingTenantId` de Org Y → `403`/`404` y constraint SQL rechaza referencias cruzadas. |
| **R4** | **Cambio de espacio o entrada a `LEGAL` organizacional sin MFA real, por `trusted-device` o con `mfa_at` vencido.** | `switch-workspace` exige `user.isMfaEnabled() == true` y `mfa_at` vigente; `trusted-device` emite token sin `mfa_at`; espacios `LEGAL` con `organization_id IS NOT NULL` exigen `mfa_at` reciente (`<= 15 min`) al entrar, cambiar de espacio y en acciones sensibles; step-up TOTP es de un solo uso con `auth_rate_limits`. | **Test de integración:** (a) `mfa_enabled = false` → `403 MFA_REQUIRED`; (b) sesión `trusted-device` (`mfa_at = null`) intenta `switch-workspace` o entrar a espacio `LEGAL` de organización → `403 MFA_STEP_UP_REQUIRED`; (c) `mfa_at` antiguo (`> 15 min`) al cambiar a `LEGAL` de organización o reúso del mismo código TOTP → `403`/`429`; (d) cuenta `LEGAL` sin organización sigue entrando igual que hoy (`R8`). |
| **R5** | **Bypass de pago (`paid_verified`) creando espacio `DEVELOPER`/`LEGAL` o espacio `ORGANIZATION` sin suscripción activa.** | Crear un espacio hijo o entrar a cualquier espacio `ORGANIZATION` pasa por `AccountAccessService` / `BillingAccessConfiguration` usando `BillingAccountResolver`. | **Test de integración:** Organización sin suscripción pagada intenta crear espacio `DEVELOPER`/`LEGAL` o invocar endpoints protegidos de análisis/escaneo → `402 Payment Required` (`MEMBERSHIP_REQUIRED`). |
| **R6** | **Condición de carrera (doble gasto) en bolsa de créditos compartida o exceso de puestos concurrentes.** | `CreditService.reserve` y `AccountSeatService.requireSeatAvailable` ejecutan `pg_advisory_xact_lock` sobre la llave canónica `billing:<billingTenantId>`, serializando operaciones de todos los espacios hijos. | **Test de concurrencia en PostgreSQL aislado:** Dos hilos en Espacio A y Espacio B con saldo compartido de `10` créditos intentan reservar `8` créditos simultáneamente → exactamente uno gana y el otro recibe `402 INSUFFICIENT_CREDITS`. |
| **R7** | **Fuga de estado en cliente o colisión multi-pestaña tras `switch-workspace` (cookie `HttpOnly`).** | Al cambiar de espacio en frontend se purgan estados locales (`activeExpedienteId`, documentos en memoria, historial de chat, proyectos Dev); si otra pestaña envía petición esperando un espacio distinto, el backend igual aísla por el `tid` del token/cookie y se añade interceptor de sincronización (`storage` / `BroadcastChannel` `omega:workspace-switched`) para refrescar pestañas hermanas de inmediato. | **Test de componente frontend:** Al ejecutar cambio de espacio, el árbol React desmonta el módulo previo, limpia el expediente activo y actualiza `NAV_ITEMS` al nuevo `profile`. |
| **R8** | **Regresión en cuentas individuales o existentes sin organización.** | `organization_id` y `billing_tenant_id` son `NULL` para cuentas existentes; `V30` hace backfill de su `workspace_memberships` raíz; `BillingAccountResolver` devuelve `tenantId`. | **Test de regresión:** Suite completa actual (`BillingIntegrationTest`, `BillingRulesTest`, pruebas de aislamiento `LEGAL`, `TenantProfileMigrationAndEndpointTest`) + test explícito de cuenta `INDIVIDUAL` preexistente operando sin cambios de comportamiento. |
| **R9** | **Mutación no autorizada de facturación por el `ADMIN` de un espacio hijo (no pagador).** | `AccountAccessService.canManageBilling` exige rol `ORG_OWNER` / `ORG_ADMIN` sobre la organización pagadora (o dueño de cuenta individual); ser `ADMIN` de un espacio hijo solo permite administrar ese espacio. | **Test de integración:** Un usuario con rol `ADMIN` en un espacio hijo no pagador (y `MEMBER` en la organización) invoca crear checkout, cancelar suscripción o editar datos fiscales → recibe `403 Forbidden`. |
| **R10** | **Persistencia de privilegios obsoletos tras cambio o revocación de rol en base de datos.** | `JwtAuthenticationFilter` resuelve `role` y estado activo desde `workspace_memberships` en BD en cada petición, ignorando el rol del JWT para autorización. | **Test de integración:** Usuario autenticado con JWT emitido cuando era `ADMIN` es cambiado en BD a `CLIENT` (o `active = false` en `workspace_memberships`); su siguiente petición con el **mismo JWT** a una ruta de `ADMIN` falla de inmediato con `403`/`401` sin reemitir token. |

---

## 5. Plan de implementación por fases y criterios de aceptación

Cada fase se entregará en commits pequeños y atómicos sobre `feat/organizaciones-espacios`, ejecutando las suites reales de pruebas antes de cerrar la fase.

### Fase 1 — Modelo de datos (`V30`) + `BillingAccountResolver`
- **Alcance:**
  - Migración `V30__organizations_and_shared_billing_spaces.sql` (con reversa comentada cubriendo backfill, triggers, funciones, columnas y tablas) creando `organizations` (`legacy_legal_payer`), `organization_members` (índice `user_id`), `workspace_memberships` (índice `user_id`, backfill raíz y trigger `sync_root_workspace_membership()` sobre `users`), columnas `organization_id` / `billing_tenant_id` / overrides opcionales en `tenants` (FK compuesta `DEFERRABLE` y triggers de protección de pagador) y `workspace_tenant_id ON DELETE SET NULL` en `credit_reservations`.
  - Entidades/repositorios mínimos y servicio `BillingAccountResolver`.
  - Cableado de `BillingAccountResolver` en `BillingService`, `CreditService`, `BillingJobReconciler`, `AccountSeatService` (`ADMIN`/`ANALYST` únicos vía `workspace_memberships` sincronizada por trigger, excluyendo `CLIENT` y auditando todos los caminos de alta), `AccountAccessService` (bloqueando checkout/cancelación a `ADMIN` de espacios no pagadores), `CommercialDocuments`, `CommercialBillingController`, `ProfileConfigController` y `CommercialSaasService` (flota compartida).
- **Criterios de aceptación:**
  1. `V30` aplica limpio sobre esquema con `V1..V29` y documenta el SQL exacto de rollback (incluyendo backfill y triggers).
  2. Una cuenta sin organización (`billing_tenant_id IS NULL`) se comporta idénticamente a `v2.2.0`.
  3. Dos espacios de una misma organización comparten suscripción, tope de puestos (`ADMIN`/`ANALYST` únicos; `CLIENT` no suma; ningún camino de alta evade el tope), bolsa de dispositivos y bolsa de créditos del `billing_tenant_id`.
  4. El resolver y la BD rechazan usar un `billing_tenant_id` de otra organización, crear una organización nueva con pagador `LEGAL` o cambiar un pagador neutro a `LEGAL` (permitiendo únicamente un pagador `LEGAL` heredado preexistente sin mover filas de facturación), desactivar/borrar el espacio pagador teniendo espacios hijos, o ejecutar checkout/cancelación desde un `ADMIN` de espacio no pagador.
  5. `BillingIntegrationTest`, `BillingRulesTest`, suites `LEGAL` y nuevas pruebas de `BillingAccountResolver` y tope de puestos pasan en verde.

### Fase 2a — Membresías multi-espacio, rol en vivo desde BD, `mfa_at`, revocación de `api_tokens` y `switch-workspace`
- **Alcance:**
  - `JwtAuthenticationFilter` resolviendo `role` efectivo desde `workspace_memberships` en cada petición, bloqueo de operaciones medidas para rol humano `CLIENT`, e invalidación/revocación de `api_tokens` cuando su creador pierde membresía activa `ADMIN`/`ANALYST`.
  - Claim `mfa_at` en `JwtService` (excluido en `trusted-device`), MFA obligatorio para multi-membresía, exigencia de `mfa_at` reciente al entrar/cambiar/operar acciones sensibles en espacios `LEGAL` de una organización (sin afectar cuentas `LEGAL` sin organización), step-up TOTP de un solo uso con `auth_rate_limits` y `POST /api/v1/auth/switch-workspace`.
  - Login e invitaciones sobre `UserEntity` canónico (la fusión de cuentas duplicadas legadas queda pospuesta; siguen operando por `tenantSlug`).
- **Criterios de aceptación:**
  1. Usuario del Espacio A obtiene `403`/`404` sobre datos del Espacio B; cambiar su rol en BD o revocar su membresía surte efecto inmediato sin reemitir JWT e invalida sus `api_tokens`.
  2. `switch-workspace` falla con `403` sin MFA activo, desde `trusted-device` sin `mfa_at`, al reusar código TOTP o hacia un espacio `LEGAL` organizacional sin `mfa_at` reciente; cuentas `LEGAL` sin organización no cambian.

### Fase 2b — Gobierno de Organización, conversión sin mover facturación, titularidad y reemplazo de custodio
- **Alcance:**
  - Endpoints `/api/v1/organizations` para `ORG_OWNER` / `ORG_ADMIN`: conversión de cuentas `INDIVIDUAL` y `ORGANIZATION` existentes usando siempre el tenant pagador actual como `billing_tenant_id` (sin mover filas de facturación), creación de espacios hijos, gestión de miembros, transferencia de titularidad y reemplazo de custodio `LEGAL` (solo si quedan 0 `ADMIN` activos con MFA, espera de 72 h con aviso previo, prohibición de auto-designación del `ORG_OWNER` y cero lectura de datos).
- **Criterios de aceptación:**
  1. `ORG_ADMIN` de Organización X recibe `403`/`404` sobre Organización Y.
  2. La conversión preserva intactos `subscriptions`, `billing_checkouts`, `billing_payments` y `credit_*` en su `tenant_id` original.
  3. `ORG_OWNER` / `ORG_ADMIN` **no** puede leer datos de un espacio `LEGAL`; el reemplazo de custodio exige 0 `ADMIN` con MFA, respeta la espera de 72 h, impide auto-designación del `ORG_OWNER` y queda auditado.

### Fase 3 — Bolsa de créditos compartida y consumo visible por espacio (sin exponer contenido)
- **Alcance:**
  - Registro automático de `workspace_tenant_id` en cada `CreditService.reserve(...)` originado desde cualquier espacio (incluyendo escaneos por JWT, `ApiToken` y webhooks GitHub).
  - Endpoint y proyección en el resumen de facturación con desglose por espacio del periodo actual: `(workspaceId, workspaceName, profile, creditsConsumed, creditsReserved, operationsCount)` **sin** incluir nombres de archivos, casos, URLs ni repositorios.
- **Criterios de aceptación:**
  1. Operaciones en espacios `GENERAL`, `DEVELOPER` y `LEGAL` de una misma organización descuentan atómicamente de la misma bolsa de créditos.
  2. El desglose por espacio cuadra exactamente con las reservas/consumos del periodo y contiene **cero** metadatos sensibles de dominio.
  3. Un espacio sin pago verificado en su `billing_tenant_id` recibe `402` en toda ruta profesional.

### Fase 4 — Frontend: selector de espacio, consola de organización, onboarding y `MembershipGate`
- **Alcance (cumpliendo estrictamente el sistema de diseño Anti-Slop de OMEGA en `AGENTS.md`):**
  - Selector de espacio en navegación superior (con indicador de perfil `GENERAL` / `DEVELOPER` / `LEGAL`, prompt de TOTP si hace falta step-up MFA, limpieza total de estado en cliente al cambiar y sincronización entre pestañas).
  - Consola de organización dentro de `AccountSettingsPanel` (pestañas/secciones limpias sin card-in-card: espacios, miembros y puestos, consumo de créditos por espacio) y vista adaptada en `BillingPanel`.
  - Onboarding *"¿Qué haces tú?"* que dirija al usuario al espacio acorde a su función o asista en la creación inicial de espacios.
  - `MembershipGate` adaptado por espacio.
- **Criterios de aceptación:**
  1. `accountBillingNavigation.test.js`, `profileAdaptive.test.js`, `legalNavigation.test.js` y los nuevos tests de selector/consola/gate pasan en verde, además de `npm run build`.
  2. Cero emojis en UI, paleta `#0A0A0C` / `#0F131B` / `#2F6FED`, íconos vectoriales Lucide y microcopia clara en español.

### Fase 5 — Informe ejecutivo del dueño de organización
- **Alcance:**
  - Generación y exportación (vista + PDF/JSON verificable) del informe ejecutivo para `ORG_OWNER` / `ORG_ADMIN` con **solo métricas agregadas**: puestos activos vs. contratados, espacios activos por perfil, créditos consumidos por espacio y por tipo de operación (`operation_code`), volumen agregado de evaluaciones/escaneos/consultas completadas y estado de suscripción.
- **Criterios de aceptación:**
  1. El informe ejecutivo no consulta ni expone títulos de expedientes, nombres de documentos, fragmentos RAG, nombres de repositorios, hallazgos específicos ni URLs/correos analizados.
  2. Prueba automatizada con datos sensibles sembrados en espacios `LEGAL` y `DEVELOPER` verifica ausencia total de dichos strings en el payload y en el PDF generado.

---

## 6. Decisiones arquitectónicas aprobadas

1. **Diseño de facturación:** Aprobado **Diseño A** (`billing_tenant_id` + `BillingAccountResolver` respaldado por `omega_rag.organizations`), sin mover jamás filas de facturación entre tenants. El espacio pagador tiene prohibido `LEGAL` en organizaciones nuevas (permitido solo como excepción heredada preexistente a `V30`) y no puede desactivarse ni borrarse mientras existan espacios hijos.
2. **Conteo de puestos (`max_users`):** Personas humanas activas únicas (`COUNT(DISTINCT user_id)`) con rol **`ADMIN` o `ANALYST`** en `workspace_memberships` (sincronizada por trigger desde `users`); el rol **`CLIENT` no consume puesto** ni ejecuta operaciones medidas.
3. **Flota (`max_devices`):** Bolsa compartida global entre todos los espacios bajo el mismo `billing_tenant_id` (dejando preparado en diseño el tope opcional de créditos y dispositivos por espacio).
4. **Custodia y secreto profesional `LEGAL`:** Mínimo 2 `ADMIN` recomendados por espacio `LEGAL`, `mfa_at` reciente para espacios `LEGAL` de organización (al entrar, cambiar de espacio y acciones sensibles) y reemplazo de custodio diferido 72 h (solo con 0 `ADMIN` activos con MFA, sin auto-designación del `ORG_OWNER` y cero lectura de datos).
