# Informes y operación comercial de OMEGA

Implementación inicial: 24 de noviembre de 2026.

## Informes

- Cuenta → Informes permite guardar y descargar versiones PDF/JSON de General, Desarrollo y Legal. Los accesos directos de los expedientes generan estas mismas versiones; el dossier técnico previo sigue disponible en Opciones avanzadas.
- General utiliza documentos, eventos técnicos y observaciones saneadas de evaluaciones guardadas del expediente. Cuenta → Informes incluye historial, comparación y eliminación de detalles; eliminar una evaluación invalida sus versiones General asociadas. No reconstruye resultados efímeros que nunca se registraron. No certifica un dispositivo limpio.
- Desarrollo incluye todos los hallazgos persistidos de las últimas evaluaciones, sin el antiguo límite de 200 en JSON o 15 en PDF. Incluye versión de reglas, commit cuando consta, límites del analizador, ubicación, explicación saneada, triaje y orientaciones de corrección/verificación. Los proyectos sin escaneo figuran como no evaluados.
- Legal incluye inventario y cronología con referencias. La selección literal de pasajes sobre posibles obligaciones y valores y sus revisiones están disponibles en la interfaz, PDF y JSON. Se informa cuántos fragmentos se revisaron y si se alcanzó el límite de 200 pasajes. El registro de revisión conserva cita, fuente, criterio, autor, fecha y revisión; se declara el límite de 500 registros cuando se supera. Los extractos de más de 700 caracteres se identifican como abreviados. No se determinan automáticamente exigibilidad de obligaciones, deudas, contradicciones ni vencimientos procesales. Una revisión posterior genera una versión nueva sin reescribir las anteriores.
- Cada versión tiene UUID, fecha, formato y hashes separados para PDF y JSON. Los bytes descargados permanecen estables. Los mismos resultados por usuario/perfil reutilizan la versión existente. Un hash técnico no constituye firma digital ni anclaje externo.
- Crear/exportar desde resultados existentes cuesta cero créditos. No se invocan analizadores ni proveedores de IA al hacerlo. Una nueva evaluación usa las reglas de créditos de su módulo. No se generan informes vacíos sin evidencia o resultados registrados.
- Las versiones se conservan en PostgreSQL, incluidos textos derivados; no son archivos originales. El usuario puede eliminar una versión desde sus opciones. El borrado de documentos invalida los informes de su expediente; eliminar expedientes/proyectos elimina los informes asociados. Eliminar un proyecto también invalida los informes agregados que lo incluían. Las descargas vuelven a comprobar tenant y permisos de expediente. Una membresía vencida no bloquea la descarga de versiones accesibles existentes.
- El listado muestra hasta 100 versiones recientes. No hay una purga automática por antigüedad: la política definitiva debe reflejar este comportamiento y el tratamiento real de respaldos.

## Documentos comerciales y consentimiento

`GET /api/v1/public/commercial` expone los textos y su estado. Se consultan antes del registro, en el checkout y en Cuenta → Documentos y facturación. La aceptación es expresa, no está preseleccionada y se registra con usuario, tenant, versión y fecha. La versión deriva de un hash de los textos efectivos y de la identidad incorporada; modificar el texto exige aceptar la nueva versión. El registro público y el checkout comprueban la versión cuando los documentos están publicados.

Las plantillas de `src/main/resources/commercial/` son **borradores**. Publicar exige identidad completa y textos revisados independientes:

```dotenv
OMEGA_SELLER_LEGAL_NAME=
OMEGA_SELLER_NIT=
OMEGA_SELLER_ADDRESS=
OMEGA_SUPPORT_EMAIL=
OMEGA_PRIVACY_EMAIL=
OMEGA_COMMERCIAL_DOCUMENTS_DIR=/app/commercial-reviewed
OMEGA_COMMERCIAL_DOCUMENTS_PUBLISHED=false
```

El directorio debe contener `terms.txt` y `privacy.txt` y ser legible por el backend. En Docker debe montarse explícitamente, preferiblemente en solo lectura. Solo después de revisar esos archivos se activa la publicación. Completar la identidad sin un directorio revisado no publica las plantillas. Las ventas en modo `live` se bloquean mientras estos documentos sigan sin publicar; las pruebas de Mercado Pago pueden continuar en modo `test`.

La identidad y los contactos facilitados se configuran en el archivo local de despliegue, excluido de Git. No se incorpora la cédula del titular a los archivos versionados ni se deduce un NIT de ella. Pendientes: RUT/identificación fiscal, domicilio comercial, proveedores y países efectivos de tratamiento, condiciones contractuales de IA, conservación y respaldos, procedimiento de derechos y revisión jurídica de las condiciones.

## Facturación

Cuenta → Documentos y facturación permite guardar datos del cliente y descargar comprobantes de pagos con aprobación registrada. El backend limita estos datos a quienes gestionan la cuenta. Los comprobantes identifican el estado actual del pago y se marcan como prueba en modo test. **No son facturas fiscales ni contienen un CUFE inventado.**

La automatización de emisión fiscal figura como `NOT_CONFIGURED`. El usuario ha elegido gestionar la facturación fiscal manualmente; ver [procedimiento operativo](billing-manual.md). Es necesario confirmar con el RUT las obligaciones del vendedor, contar con la ruta habilitada de facturación que corresponda y validar los datos tributarios. No se fija una tarifa de IVA sin determinar su aplicabilidad. La dirección y el correo de facturación guardados no se transmiten automáticamente a un proveedor fiscal. OMEGA no registra todavía documentos fiscales emitidos externamente ni certifica su envío.

## Correo transaccional

Se reutiliza el SMTP existente. La tabla `transactional_mail` registra eventos de pago aprobado, rechazo/cancelación de pago, reversión, cancelación de renovación y disponibilidad de informe. Los eventos de renovación aprobada utilizan el mismo flujo de cobros. Las claves únicas evitan encolar otra vez el mismo evento. La entrega ocurre separada de la activación del plan.

Los avisos utilizan la plantilla compartida de OMEGA en modo claro por defecto y oscuro donde el cliente lo admite, con una alternativa de texto. El isotipo pequeño se incluye mediante Content-ID; se eliminó el banner 3D y no se requieren imágenes remotas. Asunto, cuerpo y metadatos se escapan para mostrarlos como texto. Ver [pruebas y vistas del diseño actual](qa/2026-11-25-mail-minimal/README.md).

```dotenv
OMEGA_TRANSACTIONAL_MAIL_ENABLED=false
OMEGA_SMTP_HOST=
OMEGA_SMTP_PORT=587
OMEGA_SMTP_USERNAME=
OMEGA_SMTP_PASSWORD=
OMEGA_SMTP_FROM=
```

La entrega permanece desactivada por defecto. Para pruebas se usa un servidor/buzón aislado, sin destinatarios reales. Con SMTP habilitado, se reintenta cada cinco minutos hasta cinco intentos; el estado final fallido queda visible. La interfaz permite reintentar fallos elegibles del propio usuario cuando el envío está habilitado; no reinicia notificaciones pendientes o enviadas. Se obtiene la dirección del usuario activo al enviar. Los correos no adjuntan informes ni contienen datos documentales. Tras enviarse se elimina el cuerpo de la cola. No se guardan respuestas de error SMTP con contenido sensible.

En el despliegue local del titular se habilitó `OMEGA_TRANSACTIONAL_MAIL_ENABLED=true` el 25 de noviembre de 2026, reutilizando el SMTP y remitente de los códigos de verificación. Se comprobó conexión TLS y autenticación sin enviar un mensaje adicional. Los seis avisos pendientes de cuentas QA se marcaron como omitidos y se eliminó su cuerpo antes de activar el envío. Las credenciales permanecen en la configuración local excluida de Git. La factura fiscal manual sigue entregándose por separado; estos avisos no la adjuntan.

`SENT` significa que el servidor SMTP aceptó el mensaje, no que el destinatario lo leyó o lo recibió en su bandeja. SMTP no garantiza entrega exactamente una vez si el proceso falla después de enviar y antes de confirmar la transacción. No hay todavía procesamiento de rebotes/quejas ni recordatorios previos al vencimiento. Verificar SPF, DKIM y DMARC del dominio antes de habilitar envíos reales. Revisar la cola pendiente antes de activarla por primera vez.

## Referencias de la propuesta

- [OWASP WSTG: estructura, evidencia, limitaciones y recomendaciones de informes](https://wstg.owasp.org/v4.2/5-Reporting/).
- [DIAN: habilitación y obligación de facturación electrónica](https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx). No usar los valores históricos en UVT de esa página como umbral actualizado sin verificar la normativa aplicable.
- [SIC: Circular Externa 002 de 2024, tratamiento de datos en sistemas de IA](https://sedeelectronica.sic.gov.co/transparencia/normativa/circular-externa-2-de-2024-de-la-superintendencia-de-industria-y-comercio-lineamientos-sobre-el-tratamiento-de-datos).

## Validación de perfiles y respaldo

Ver [flujos implementados](roles-workflows.md) y [pruebas en escritorio](qa/2026-11-25-roles/README.md). Los scripts de respaldo y restauración aislada se probaron con una base QA; no se restauró sobre la base de la aplicación. La sesión nativa se mantiene en memoria y una instalación con IA configurada permite verificar ese motor sin pedir una clave adicional al usuario.
