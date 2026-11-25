# Prueba manual de OMEGA — 24 de noviembre de 2026

## Entorno y alcance

Se recorrió la interfaz real con clics, formularios, selección de archivos y descargas. Primera pasada: Edge, `http://127.0.0.1:5173`. Segunda pasada después de los cambios del usuario: **OMEGA Desktop Tauri 2.1.0, Windows x86_64, WebView2**, compilado desde el código actual. Se confirmó el puente nativo con `get_desktop_runtime_info`.

La compilación de desarrollo de Desktop carga la interfaz local y utiliza el backend existente en `127.0.0.1:8080`. Se inició en modo CLOUD_MANAGED para no ejecutar el asistente que vuelve a configurar Docker. Esto valida el shell nativo y su interfaz; no equivale a probar un instalador MSI/NSIS ni una instalación limpia SELF_HOSTED.

Se utilizaron tres cuentas ficticias: General individual, Desarrollador individual y organización Legal. Credenciales, secretos TOTP y claves de recuperación quedaron fuera del repositorio. Los documentos y manifiestos de prueba contienen datos sintéticos. No se completaron cobros reales, alertas externas ni acciones de contención del equipo.

## Resultado vigente de membresías

**Segunda ejecución completada con Mercado Pago:** checkout de prueba aprobado por COP 59.900, Pro activado por el backend, acceso real a Legal y Desarrollador en Desktop, créditos consumidos correctamente y renovación de prueba cancelada conservando el período pagado. El saldo final de esa cuenta ficticia es 517 créditos. La entrega espontánea de eventos desde Mercado Pago sigue pendiente de comprobar; la URL pública sí aceptó una notificación simulada con firma válida (HTTP 202).

| Cuenta / perfil | Sin pago | Con membresía vigente |
| --- | --- | --- |
| Individual / General | Acceso gratuito con créditos limitados | Acceso según plan |
| Individual / Desarrollador | Selección de membresía | Acceso al perfil elegido |
| Individual / Legal | Selección de membresía | Acceso al perfil elegido |
| Organización / cualquier perfil | Selección de membresía | Acceso según plan y puestos |
| Cuenta antigua sin clasificar | Confirmación del tipo de cuenta / membresía | Acceso según plan |

El perfil no se sustituye silenciosamente por General. Un titular individual puede pulsar explícitamente «Continuar con General gratis». Desactivar Mercado Pago o poner `OMEGA_BILLING_ENFORCE=false` ya no concede funciones de pago. El backend rechaza acceso profesional sin membresía con HTTP 402 y permite autenticación, recuperación, configuración y facturación.

Estas reglas se verificaron con pruebas de interfaz para las seis combinaciones de tipo y perfil, incluyendo activación y vencimiento. En Desktop se comprobó manualmente el bloqueo de Desarrollador individual y organización Legal, así como el cambio explícito a General gratuito.

## Recorridos ejecutados

| Área | Evidencia observada | Estado |
| --- | --- | --- |
| Registro individual General | Validación de campos vacíos, clave de recuperación y alta real | Correcto |
| Registro individual Desarrollador | Perfil profesional conservado; rol interno ANALYST y titular individual | Correcto |
| Registro organización Legal | Rechaza registro sin confirmación de administrador; después crea ADMIN | Correcto |
| Inicio de sesión y TOTP | Alta de autenticador, confirmación OTP, respaldo y accesos posteriores con OTP | Correcto |
| Configuración inicial | Comprueba IA existente y exige protección 2FA; no se cambiaron claves del proveedor | Correcto |
| Cambio de perfil | Confirmación explícita; navegación Dev y Legal conservada al recargar en web | Correcto en primera pasada |
| Facturación | Entrada visible en Cuenta; precios mensuales/anuales, créditos, consumos e historial | Correcto |
| Desktop / membresía Dev | Presenta planes antes de entrar a módulos profesionales | Correcto |
| Desktop / membresía Legal organización | Presenta planes y no ofrece acceso gratuito organizacional | Correcto |
| Desktop / General gratuito | Cambio explícito desde cuenta individual Dev y entrada a General | Correcto |
| Desktop / crédito de enlace | Verificación de `example.com`; actividad registra un crédito usado; saldo 30 → 29 | Correcto |
| Enlaces web | Consulta pasiva de `example.com`, sin contacto al destino; muestra fuentes y limitaciones | Correcto |
| Amenazas | Búsqueda Pegasus y apertura de indicadores | Correcto |
| Asistente CTI | Respuesta real de IA con seis citas y páginas del corpus | Correcto |
| Equipos Android, iPhone y PC | Diferencia web/Desktop y advierte ausencia de sensor; controles no disponibles deshabilitados | Correcto para el entorno disponible |
| Flota individual | Registro del equipo y heartbeat; contador 0/1 → 1/1 | Correcto |
| Ajustes | Perfil, ética, motor de IA, RAG y corpus indexado cargan | Inspección de pantalla correcta |
| Desarrollo / proyecto | Creación de proyecto ficticio | Correcto en primera pasada |
| Desarrollo / ZIP | Escaneo estático del ZIP; historial y dependencia lodash en SBOM | Correcto en primera pasada |
| Desarrollo / pestañas | Hallazgos, dependencias, políticas, reportes, integración y estación cargan | Inspección de pantalla correcta |
| Legal / expediente | Aceptación auditada de proveedores y creación de caso ficticio | Correcto en primera pasada |
| Legal / actividad y acceso | Actividad auditada y acceso del propietario | Correcto en primera pasada |
| Legal / exportación | Descarga JSON estructuralmente válido y PDF con cabecera válida | Correcto; documento aún no indexado |
| Auditoría organización | Verificación SHA-256 de 2/2 eventos de la cuenta de prueba | Correcto |
| Separación de cuentas | La cuenta Dev nueva no ve los proyectos de la primera; la organización Legal no ve el caso de la primera | Correcto como comprobación manual de listas; no sustituye auditoría de aislamiento |
| Mercado Pago / checkout | Pago de prueba aprobado por COP 59.900, vendedor y compradora comprobados | Correcto |
| Desktop / Pro | 500 créditos del plan + 30 de bienvenida; acceso a los perfiles profesionales | Correcto |
| Desktop / documento Legal | Confirma reserva de 3; indexa PDF sin OCR y cobra 1 | Correcto |
| Desktop / consulta Legal | Cita verificable del documento y página; cobra 2 | Correcto |
| Desktop / cronología | Extrae 2026-11-20 y 2026-11-23 del PDF sintético con sus citas | Correcto |
| Desktop / manifiesto directo | Confirma 10 créditos, analiza package.json y genera SBOM | Correcto |
| Desktop / saldo e idempotencia | 530 → 529 → 527 → 517; actualizar pago no duplica ni reinicia créditos | Correcto |
| Desktop / cancelación | Cancela renovación en Mercado Pago y conserva Pro hasta la fecha pagada | Correcto |
| Webhook público simulado | Salud pública 200; firma válida aceptada con 202; evento procesado con cero reintentos | Correcto; no prueba entrega espontánea del proveedor |

## Fallos de la primera pasada y cambios posteriores

1. **Carga documental y MinIO:** el entorno inicial tenía retención activada y MinIO no estaba disponible. Un PDF válido provocó `ObjectStorageException` / conexión rechazada; la respuesta llegó al cliente como 401, cerró sesión y dejó una fila PROCESSING. Reintentar el mismo hash devolvió 409. Se reprodujo también con un archivo distinto tras iniciar sesión de nuevo.
   - Después, el usuario desactivó la retención y añadió manejo de errores de almacenamiento y marcado de ingesta fallida. Estos cambios se conservaron al compilar y actualizar backend.
   - **Repetido y correcto en Desktop con Pro confirmado por Mercado Pago:** ingesta, texto extraído, cita verificada y dos eventos de cronología. No se concedió Pro mediante SQL para saltar la regla comercial.
2. **Manifiesto directo:** `package.json` válido devolvía 400 aunque la UI anunciaba compatibilidad. El mismo manifiesto dentro de un ZIP se analizaba y llenaba SBOM.
   - Se conservó el soporte de manifiestos directos añadido por el usuario, se ejecutaron seis pruebas del scanner y se reconstruyó/aplicó el worker. El manifiesto directo se analizó correctamente desde Desktop, con confirmación de gasto y exportaciones CycloneDX/SPDX.
3. **Políticas del propietario individual:** el titular ANALYST quedaba en modo lectura.
   - El usuario modificó las comprobaciones de propietario. Se conservaron los cambios. **Pendiente de repetir con membresía activa.**
4. **Navegación compacta:** la vista de 390 × 844 mostraba etiquetas generales en el perfil Dev. La página de precios no presentaba desbordamiento horizontal del documento.
   - El usuario añadió las etiquetas del perfil a la navegación compacta. Cambios conservados. **Pendiente de repetir para Dev/Legal con membresía activa.**

Las capturas 01–07 pertenecen a la primera pasada. No representan necesariamente la versión actual. Las capturas 08–10 corresponden a Desktop con el control de membresías; 11–16 documentan la aprobación, activación, uso y cancelación de la prueba. Se detectaron cambios y un nuevo despliegue de frontend del usuario durante la ejecución: se conservaron y se repitió el acceso a Legal y al saldo Pro en la interfaz actualizada, sin volver a certificar todas las pantallas visuales.

## Mercado Pago: diagnóstico actual

- Modo real observado del backend: `test`; configuración sensible conservada sin imprimir secretos.
- La preparación de suscripción con el correo proporcionado por el usuario fue rechazada por el proveedor. El motivo reconocido exige comprador y vendedor del mismo entorno.
- La interfaz ahora explica el requisito de una cuenta compradora de prueba distinta del vendedor, en lugar de mostrar únicamente un error genérico.
- Los primeros rechazos no concedieron membresía. Posteriormente se completó el pago de prueba y se activó Pro mediante la factura aprobada.
- El usuario facilitó después el User ID y nombre de usuario de la compradora. La consulta a `/users/{id}` confirmó ambos datos, pero no devolvió un correo. No se pidió su contraseña.
- Los alias inferidos a partir del nombre y del ID no se consideran correos verificados: el proveedor rechazó su uso con `User bad request`. Un diagnóstico posterior recibió HTTP 429 `local_rate_limited`; se detuvieron los reintentos.
- **Resuelto:** el usuario inició sesión con la compradora en una ventana invitada; su perfil mostró el correo interno correcto. Ese correo permitió crear el checkout. Se utilizó una tarjeta oficial de prueba, titular APRO y documento ficticio. La aprobación de COP 59.900 se verificó de nuevo mediante las APIs de facturas y pagos.
- Se corrigieron dos bloqueos observados en el flujo real: `limit` inválido en búsqueda de facturas y rechazo del indicador `live_mode=true` en pagos entre cuentas de prueba verificadas. Se mantiene la comprobación del vendedor, su etiqueta de prueba/producción, importe, moneda y vínculo con la factura. Los errores de proveedores ya responden 502 sin fingir que expiró la sesión.
- **Resultado:** el backend concilió el pago, entregó 500 créditos del plan una sola vez y mantuvo 30 de bienvenida. Indexar el documento cobró 1, consultar Legal cobró 2 y escanear el manifiesto cobró 10. Saldo 517 después de actualizar el pago nuevamente.
- **Cancelación comprobada:** se canceló la renovación de prueba desde Desktop, manteniendo Pro y el saldo hasta la fecha pagada. El perfil de la cuenta se devolvió a Legal después de probar Desarrollador.
- **Pendiente:** verificar el envío espontáneo del webhook desde la configuración del proveedor. No se observó un evento del proveedor durante la compra. Se comprobó por separado que la URL pública responde salud 200 y acepta una notificación simulada con firma válida (202). La cola procesó ese evento simulado sin reintentos. La activación observada se produjo mediante conciliación con la API de Mercado Pago.
- Referencia: [cuentas de prueba de Mercado Pago](https://www.mercadopago.com.co/developers/es/docs/subscriptions/additional-content/your-integrations/test/accounts).

## Observación adicional de Desktop

Recargar la compilación nativa de desarrollo volvió al login y `/auth/me` respondió 401, incluso sin reiniciar el backend entre ambas acciones. La implementación actual usa autenticación bearer sin cookies para Tauri y conserva el token en RAM. Debe revisarse el alcance del texto «Recordar sesión en este equipo (30 días)» en Desktop. No se debilitó la seguridad ni se introdujo persistencia de tokens para resolverlo durante esta tarea. Falta contrastarlo con el instalador final.

## Comprobaciones técnicas

- Frontend de la primera pasada: 93 pruebas pasaron; las 10 pruebas de navegación/facturación/membresía volvieron a pasar entonces. El usuario cambió las pantallas de pricing durante la prueba; esa nueva suite visual no se volvió a ejecutar en esta pasada.
- Backend de esta continuación: 15 pruebas de integración de facturación, 5 de reglas/modos y 1 de tratamiento de errores externos pasaron. Incluyen paginación de facturas, conciliación idempotente y separación de vendedores de prueba/reales. Se utilizó una base temporal aislada que después se eliminó. Las comprobaciones anteriores de política comercial y acceso siguen documentadas en la primera pasada.
- Worker: seis pruebas de repositorios pasaron; soporte de manifiesto directo desplegado y repetido manualmente desde Desktop.
- Compilación Vite y `cargo build --offline`: correctas.
- Imágenes frontend/backend recompiladas y aplicadas localmente conservando la configuración vigente. Backend saludable al finalizar la actualización.
- `git diff --check`: sin errores de espacios. Se preservaron modificaciones anteriores del usuario.

## Fuera de la cobertura completada

No se certifican cobros con dinero real, envío espontáneo del webhook desde Mercado Pago, un instalador nuevo, otros sistemas operativos, dispositivos físicos USB, vigilancia del host, cuarentena, contención, alertas a terceros ni todas las combinaciones de documentos y permisos de colaboradores. La revisión amplia detecta problemas reproducibles; no equivale a aprobar todo el proyecto para producción.

## Capturas

- [Planes anuales en web](02-pricing-general-anual.png)
- [Respuesta CTI con citas](03-general-asistente.png)
- [Rechazo inicial de manifiesto directo](04-developer-scan-error.png)
- [Carga documental que cerraba sesión](05-legal-upload-cierra-sesion.png)
- [Pricing compacto inicial](07-mobile-pricing.png)
- [Desktop: Desarrollador exige membresía](08-desktop-developer-membresia.png)
- [Desktop: un crédito usado](09-desktop-general-credito.png)
- [Desktop: organización Legal exige membresía](10-desktop-legal-membresia.png)
- [Mercado Pago: confirmación con tarjeta de prueba](11-mercadopago-confirmacion-test.png)
- [Mercado Pago: pago de prueba aprobado](12-mercadopago-pago-test-aprobado.png)
- [Desktop: Pro activado con 530 créditos](13-desktop-pro-530-creditos.png)
- [Desktop: documento Legal y cita verificada](14-desktop-legal-documento-cita.png)
- [Desktop: SBOM generado](15-desktop-developer-sbom.png)
- [Desktop: renovación cancelada y 517 créditos](16-desktop-renovacion-cancelada-517-creditos.png)
- [Mercado Pago: suscripción de prueba cancelada en la cuenta compradora](17-mercadopago-suscripcion-test-cancelada.png)
