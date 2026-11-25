# Facturación manual de OMEGA

Decisión del titular: gestionar manualmente la facturación fiscal, sin contratar por ahora una API. La aplicación registra pagos y permite descargar comprobantes; no emite facturas fiscales.

## Flujo operativo

1. Verificar el pago aprobado registrado y su referencia de Mercado Pago. Revisar también su estado actual por si hubo devolución o reversión. No usar una captura del comprador como confirmación del pago.
2. Obtener los datos del cliente en Cuenta → Documentos y facturación, con los permisos de gestión correspondientes. Confirmar el correo al que se entregará la factura. El correo de facturación puede ser distinto del correo de acceso.
3. Emitir la factura que corresponda mediante la solución habilitada del titular. Este paso requiere completar previamente los datos y requisitos del emisor; OMEGA no los inventa ni los verifica.
4. Entregar los documentos emitidos al cliente por el canal acordado y conservar, en un registro administrativo privado, la relación entre referencia del pago, número de factura, fecha y constancia de envío. No incluir datos fiscales de clientes en Git.
5. Tramitar correcciones o devoluciones en la solución de facturación y mantener su relación con el pago. Cancelar una renovación no equivale a anular un pago o una factura.

## Qué hace la aplicación

- Guarda datos del cliente y pagos verificados; restringe el acceso a quienes gestionan su cuenta.
- Identifica los comprobantes de prueba y explica que son documentos distintos de una factura fiscal.
- Encola avisos transaccionales de pagos e informes. Estos avisos usan el correo del usuario registrado; no adjuntan una factura fiscal ni acreditan su entrega manual.

## Qué falta para operar

Completar NIT del RUT, domicilio comercial y habilitación aplicable del titular; revisar y publicar las condiciones comerciales con los proveedores y plazos reales. Configurar SMTP y comprobar el buzón del dominio antes de habilitar avisos reales. El transporte SMTP se ha probado contra un servidor local aislado; esa prueba no demuestra entrega a un proveedor externo.
