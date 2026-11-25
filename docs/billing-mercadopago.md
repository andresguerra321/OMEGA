# Suscripciones, créditos y pruebas de Mercado Pago

## Modelo comercial

La identidad se compone de tres datos independientes:

- Tipo de cuenta: individual u organización.
- Perfil del espacio: General, Desarrollador o Legal.
- Plan: Gratis (`FREE`), Pro (`PRO`) o Enterprise (`ENTERPRISE`).

Una desarrolladora independiente puede tener **Cuenta individual · Desarrollador · Pro**, sin ser administradora de una organización. El titular individual usa el rol interno `ANALYST` y puede gestionar su propio pago, perfil y dispositivos. Crear miembros requiere una organización y puestos disponibles.

Solo **General con cuenta individual** permite acceso gratuito. Desarrollador, Legal y cualquier organización requieren Pro o Enterprise. El perfil elegido se conserva: una cuenta sin membresía ve los planes antes de entrar a sus módulos, sin cambiarla silenciosamente a General. Un titular individual puede elegir explícitamente continuar con General gratis. Las APIs también rechazan el acceso sin pago con HTTP 402. Comprar créditos no sustituye la membresía.

| Plan | Mensual COP | Anual COP | Créditos por mes | Puestos | Dispositivos |
| --- | ---: | ---: | ---: | ---: | ---: |
| Gratis | 0 | — | 30 de bienvenida, una vez | 1 | 1 |
| Pro | 59.900 | 599.000 | 500 | 1 | 5 |
| Enterprise | 299.900 | 2.999.000 | 3.000 | 5 | 25 |

Los precios y límites de venta están en `omega_rag.billing_plans`. El anual se paga anticipadamente y entrega una bolsa mensual, anclada a la fecha inicial del período pagado. Los puestos se comparten en una organización; una cuenta individual no admite miembros adicionales. Revisar la presentación tributaria del precio antes de habilitar ventas reales.

Recarga: 200 créditos por COP 29.900, mediante un pago único. Caduca doce meses después del pago y requiere un plan de pago para comprarla. No hay recarga ni sobreconsumo automáticos.

## Operaciones conectadas al saldo

| Operación existente | Créditos |
| --- | ---: |
| Consulta de IA pública/general | 1 |
| Consulta privada en un expediente Legal | 2 |
| Imagen analizada con IA | 3 |
| Verificar un enlace o escanear un activo OSINT | 1 |
| Escaneo YARA en servidor | 5 |
| Análisis forense estándar y auditoría USB móvil | 15 |
| Análisis profundo de captura de PC | 30 |
| Repositorio hasta 5 MiB comprimidos | 10 |
| Repositorio de más de 5 y hasta 25 MiB comprimidos | 25 |
| Auditoría de estación de desarrollo | 5 |
| Indexar documento con texto | 1 por cada bloque iniciado de 10 páginas |
| Indexar documento que requirió OCR | 3 por cada bloque iniciado de 10 páginas |
| Reindexar texto ya conservado | 1 por cada bloque iniciado de 10 páginas |

Las tarifas son una configuración comercial inicial; no son una medición del costo de los proveedores. Cada operación medida registra telemetría estructurada (`billing.credit_usage operation=... credits=... durationMs=... uploadBytes=... outcome=...`) en los logs del backend Java para medir latencia, tamaño de entrada y consumo real por crédito antes de abrir ventas en modo `live`. Los tamaños admitidos por los motores y sus validaciones siguen siendo obligatorios. Los análisis de archivos admiten como máximo 20 archivos y 25 MiB de entrada agregada; los repositorios conservan además las defensas contra archivos comprimidos peligrosos del motor existente. La indexación admite hasta 1.000 páginas por operación y mantiene los límites de tamaño existentes.

Las funciones propuestas en la conversación que todavía no tienen un endpoint propio —por ejemplo, generar correcciones con IA o comparar documentos con IA— no se simulan ni se cobran. La cronología heurística existente, consultar resultados, buscar en el catálogo local, administrar proyectos y exportar datos existentes no consumen créditos.

El escudo local conserva sus controles de propiedad del sensor. Ejecutar IA con Ollama **en la infraestructura del cliente**, con `OMEGA_DEPLOYMENT_MODE=SELF_HOSTED` y el modo soberano local habilitado, no consume créditos de IA. Ollama ejecutado en un servidor administrado por OMEGA sí consume recursos y se factura con créditos. Las funciones profesionales continúan requiriendo plan de pago.

## Reserva, confirmación y devolución

PostgreSQL guarda las asignaciones (`credit_grants`), reservas (`credit_reservations`) y sus distribuciones (`credit_allocations`). Un bloqueo transaccional por cuenta evita gastar el mismo saldo desde varias solicitudes. Se utilizan primero los créditos próximos a vencer.

Las operaciones de al menos 3 créditos requieren autorización de gasto mediante `X-Omega-Credit-Limit`. Sin ella, el servidor responde 409 con `OMEGA_CREDIT_QUOTE:<cantidad>:<operación>` **antes de ejecutar el trabajo facturable**. La aplicación muestra una confirmación accesible y repite la solicitud con el límite aceptado. El servidor vuelve a calcular el costo; el cliente nunca decide cuánto se descuenta. Un cliente API de escaneo debe enviar explícitamente un límite de 10 o 25 créditos. Las ejecuciones automáticas de GitHub consumen de la misma bolsa y conservan sus límites de frecuencia y uso de tokens.

En documentos se reserva el máximo de OCR después de inspeccionar el archivo. Al finalizar la tarea asíncrona se confirma el consumo y se devuelve la diferencia cuando no fue necesario OCR. Las auditorías móviles mantienen su reserva mientras el trabajo está pendiente. Un proceso periódico liquida resultados aunque la aplicación se cierre.

Los fallos sin resultado liberan la reserva. Un análisis que termina sin amenazas es un resultado válido. Las devoluciones son idempotentes. Los créditos incluidos caducan en el siguiente período mensual; las recargas mantienen su vigencia propia. Una cancelación conserva el período ya pagado, sin emitir nuevos créditos después de vencer.

Una reserva que siga sin liquidarse después de 24 horas se libera para que una caída del proceso no bloquee indefinidamente el saldo. Las operaciones soportadas tienen entradas y tiempos acotados; un resultado excepcionalmente tardío no vuelve a descontar una reserva liberada.

## Configuración del backend

Por defecto `OMEGA_MP_MODE=disabled`: no se crean pagos ni suscripciones remotas. Las reglas de membresía y créditos se aplican siempre, también en desarrollo y aunque la variable antigua `OMEGA_BILLING_ENFORCE` sea false. Desactivar la pasarela no habilita funciones de pago. El modo `test` permite comprobar Mercado Pago con usuarios y tarjetas de prueba; `live` utiliza cobros reales. No hay endpoint de simulación que permita obtener Pro en producción. El antiguo `PUT /saas/subscription` ya no puede activar planes.

Configurar estas variables únicamente en el backend que gestiona la facturación, nunca en Vite, Tauri ni archivos públicos:

```dotenv
OMEGA_MP_MODE=test
OMEGA_MP_ACCESS_TOKEN=<credencial del vendedor de prueba>
OMEGA_MP_SELLER_ID=<id numérico del vendedor de prueba>
OMEGA_MP_WEBHOOK_SECRET=<secreto de firma de tu integración>
OMEGA_PUBLIC_BASE_URL=https://backend-de-pruebas.example.com
OMEGA_BILLING_RETURN_URL=https://app-de-pruebas.example.com
```

`OMEGA_MP_MODE` admite `disabled`, `test` y `live`. Cuando se activa exige credenciales y URLs HTTPS. Antes de crear un checkout se consulta el vendedor y se verifica que sea una cuenta de prueba en modo `test`. Al verificar un pago también se comprueban vendedor, entorno, monto y moneda. No se debe inferir el entorno solamente por el prefijo del token.

En el flujo de Suscripciones con cuentas de prueba se observó un pago aprobado con `live_mode=true`. Por eso el modo `test` exige verificar mediante `/users/me` que el vendedor configurado tiene la etiqueta `test_user`, además de comprobar su `collector_id`. El modo `live` exige vendedor real y `live_mode=true`. Un vendedor real nunca se acepta como vendedor de pruebas.

La búsqueda de facturas de suscripciones rechaza los límites explícitos probados (`limit=100` y `limit=20`). Se usa el tamaño predeterminado del proveedor y el desplazamiento `offset`, hasta el máximo de historial consultado por OMEGA. Los errores del servicio externo responden 502 y no deben convertirse en un cierre de sesión 401.

En Docker Compose, las variables de `omega/.env` ya se cargan mediante `env_file`; para un despliegue central también pueden inyectarse directamente en el contenedor del backend. No guardar credenciales reales en el repositorio.

El endpoint público de notificaciones es:

```text
POST https://backend-de-pruebas.example.com/api/v1/billing/webhooks/mercadopago
```

La aplicación Tauri abre el checkout en el navegador externo mediante un comando nativo que permite exclusivamente URLs HTTPS de Mercado Pago. Esta modificación requiere recompilar el cliente de escritorio; actualizar solo los archivos web de un binario antiguo no añade el comando.

Activar los tópicos `payment`, `subscription_preapproval` y `subscription_authorized_payment`. Se valida la firma HMAC-SHA256 de Mercado Pago usando los headers `x-signature`, `x-request-id`, el parámetro `data.id` y la frescura del timestamp `ts` (ventana por defecto de `300s`, configurable vía `OMEGA_MP_WEBHOOK_MAX_AGE_SECONDS`, para rechazar repeticiones antiguas con HTTP `401`). La notificación entra a una cola persistente y recibe 202; el backend consulta el recurso auténtico en la API y procesa el resultado. El cuerpo recibido no activa planes. La conciliación automática se ejecuta cada cinco minutos; el botón de actualización de Mi plan también consulta a Mercado Pago.

Una suscripción `authorized` no activa el plan: hace falta un pago aprobado de su factura recurrente. Un pago pendiente o rechazado no concede un período ni créditos nuevos. Si un cobro de renovación falla o queda pendiente al vencer el período (sin cancelación voluntaria ni reembolso), la cuenta conserva acceso durante un **período de gracia configurable de 5 días** (`OMEGA_BILLING_GRACE_DAYS`, rango `0..14`) sin emitir nuevos créditos mensuales hasta confirmar el pago; si el usuario cancela explícitamente su renovación, conserva el acceso hasta el final del período ya pagado y luego vuelve a Gratis.

### Despliegue central HTTPS vs. instalación de escritorio

La pasarela de facturación y la recepción de webhooks de Mercado Pago operan **exclusivamente en un backend central con HTTPS público** (`OMEGA_PUBLIC_BASE_URL`). Las instalaciones de escritorio locales (Tauri/Docker en la máquina del usuario) no reciben webhooks de Mercado Pago; para operar membresías y cobros reales deben apuntar al backend central HTTPS.

## Cómo probar sin cobrar dinero real

1. Crear la aplicación de Mercado Pago y consultar las instrucciones de pruebas de **Suscripciones**, que pueden diferir de las de Checkout Pro.
2. Preparar vendedor y comprador de prueba de Colombia, usando las credenciales indicadas por Mercado Pago para ese flujo. El comprador debe ser distinto del vendedor. No usar tarjetas ni cuentas bancarias reales.
3. Configurar las variables anteriores con `test`. Usar un backend de pruebas con HTTPS público: Mercado Pago no puede llamar a un `localhost` ni a la aplicación de escritorio.
4. Configurar el webhook y su secreto en el panel de Mercado Pago.
5. Registrar una cuenta individual con perfil Desarrollador. Debe aparecer como individual y conservar su perfil Desarrollador. En modo de pagos de prueba, sus acciones profesionales requieren un pago; el enlace Cuenta → Mi plan y créditos está disponible en todos los perfiles.
6. Abrir **Cuenta → Mi plan y créditos**, seleccionar Pro mensual y, en Opciones de suscripción, indicar el correo del comprador de prueba cuando corresponda. Continuar en el checkout de Mercado Pago.

   Si el panel solo muestra User ID y usuario, iniciar sesión con la compradora en una ventana invitada de Mercado Pago y copiar el correo interno visible en su perfil. La consulta pública `/users/{id}` no necesariamente devuelve ese correo. No inventarlo a partir del User ID ni compartir contraseñas con el asistente.
7. Usar las tarjetas oficiales de prueba y los datos de simulación vigentes de Mercado Pago. Probar aprobación, rechazo y pendiente. Actualizar el estado en OMEGA; solo la aprobación debe dar Pro y 500 créditos mensuales, además de la bienvenida que conserve la cuenta.
8. Repetir una notificación del mismo pago: no debe duplicar créditos. Enviar una firma incorrecta: debe responder 401 sin registrar un evento válido. No usar el modo disabled para evaluar esa respuesta, porque responde 503 al no estar configurado.
9. Probar una operación de costo mayor: cancelar la confirmación debe conservar el saldo; aceptarla debe consumir lo indicado; una caída del motor debe devolver la reserva. Un repositorio pequeño debe costar 10 tanto por URL como por archivo.
10. Probar una recarga, cancelar renovación, reembolsar y verificar aislamiento entre dos cuentas. La cancelación debe detener cobros futuros y conservar el acceso hasta la fecha pagada; el reembolso debe retirar el beneficio correspondiente.

La prueba de punta a punta en Sandbox ya fue ejecutada contra Mercado Pago mediante túnel HTTPS público (`cloudflared`) con cuentas oficiales de vendedor y comprador de prueba (evidencia en `docs/qa/2026-11-24-manual/README.md`: aprobación de Pro + 500 créditos, consumo real de créditos, y cancelación de renovación conservando el período pagado). Las pruebas automatizadas del repositorio utilizan PostgreSQL aislado y dobles del proveedor; no crean cobros remotos.

Fuentes oficiales: [cuentas de prueba](https://www.mercadopago.com.co/developers/es/docs/your-integrations/test/accounts), [suscripción con pago pendiente](https://www.mercadopago.com.co/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments), [webhooks](https://www.mercadopago.com.co/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks), [referencia de Suscripciones](https://www.mercadopago.com.co/developers/es/reference/online-payments/subscriptions/overview).

## Cuentas y despliegues existentes

La migración V26 cambia el código del plan gratuito de `PERSONAL` a `FREE`. No borra documentos, usuarios ni resultados. Un antiguo plan asignado manualmente no concede acceso profesional sin un pago verificado. Revisar los clientes existentes antes de desplegar esta política en una instalación que ya tenga contratos comerciales.

Los registros nuevos guardan el tipo de cuenta y el titular explícitamente. Los históricos que no pueden distinguirse de una organización permanecen `UNCLASSIFIED`: en Mi plan y créditos, su administrador puede confirmar el tipo. Elegir individual exige que el espacio tenga un único usuario y cambia su rol interno a `ANALYST`, conservando la titularidad y todos sus datos. No se degradan automáticamente administradores de organizaciones por tener un solo miembro.

La primera versión evita suscripciones recurrentes superpuestas: los cambios de plan se realizan al terminar el período pagado. No incluye prorrateo de upgrades ni descuentos personalizados. Una creación cuyo resultado sea incierto se bloquea contra duplicados y se concilia; no reintentar cobros manualmente sin comprobar el panel de Mercado Pago. La recuperación automática de creaciones inciertas examina como máximo 1.000 suscripciones remotas por pasada y registra las que requieran revisión.
