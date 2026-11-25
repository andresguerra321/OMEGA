# Cierre de pendientes antes del release

25 de noviembre de 2026. El usuario detuvo la publicación y autorizó completar también el PDF Legal. Esta validación amplía la [prueba anterior de perfiles](../2026-11-25-roles/README.md); el release continúa detenido.

## Cambios

- PDF Legal: pasajes literales, documento, página y fragmento; conteos y límites de cobertura; criterio de revisión, estado, autor, fecha y revisión. PDF y JSON utilizan el mismo registro de revisión. Los informes anteriores permanecen inmutables; cambiar una revisión y generar de nuevo crea otra versión.
- Facturación manual: la interfaz distingue el comprobante del proceso fiscal manual y no promete emisión o entrega automática. Se documentó el [procedimiento](../../billing-manual.md).
- Privacidad: el borrador declara el historial automático de observaciones saneadas, su eliminación, las revisiones documentales y la ausencia de purga automática por antigüedad. No se publicó como documento definitivo.

## Evidencia

- **20 pruebas backend sin fallos**, incluidas autorización y concurrencia de revisiones, PDF/JSON con fuentes, inmutabilidad de versiones, cola de correo y comprobantes.
- Regresión final después de mejorar los textos de datos ausentes: **9 pruebas backend sin fallos**; se solapan con las anteriores. Linter sin errores, con advertencias existentes.
- **104 pruebas de interfaz sin fallos**.
- **SMTP local real:** JavaMailSender se conectó por TCP a un servidor de pruebas en 127.0.0.1, que recibió el mensaje para la dirección registrada. Se comprobaron asunto, cuerpo, destinatario y actualización de cola. No se contactó un servidor externo ni se enviaron correos reales.
- **App Tauri:** se generó y descargó un PDF Legal de dos páginas con dos pasajes, uno confirmado. La extracción de texto comprobó valor, criterio, estado y autor; el hash coincidió con el mostrado en la app. Se inspeccionó visualmente la página del registro y la [pantalla de facturación manual](facturacion-manual.png). El [PDF QA](informe-legal-qa.pdf) contiene únicamente datos ficticios.
- PDF final: `5a7e1601-d170-44a3-b8c0-8398d4147335`, SHA-256 `4c0895264d85b936dafa1ee776fd02357e859e9d682ac14562997d6560a0b2f7`. Vistas de [página 1](pdf-legal-pagina-1.png) y [página 2](pdf-legal-pagina-2.png). Saldo QA confirmado en 505 créditos después de exportar: sin consumo adicional.
- Backend y frontend locales compilados y actualizados. No se cambió la versión ni se creó un tag o release.

## Pendientes que requieren configuración del titular

Actualización posterior de correo: el titular confirmó el SMTP existente y autorizó reutilizar su remitente. Se verificaron TLS y autenticación y se activó el envío transaccional en el despliegue local. Antes se omitieron los seis avisos QA pendientes, sin contactar esos destinatarios. Queda por contrastar la llegada efectiva de un aviso real a la bandeja; no se enviaron mensajes adicionales durante esta comprobación.

NIT del RUT y domicilio comercial publicable; identificar proveedores y condiciones reales de tratamiento, definir conservación y revisar/publicar documentos comerciales; contrastar entrega a la bandeja del destinatario. La facturación fiscal permanece manual y requiere la habilitación aplicable del titular. OMEGA no conserva todavía las facturas emitidas externamente ni constancia de su envío.

Los rebotes y quejas de correo dependen del proveedor elegido y no se implementaron con un formato supuesto. Esta sesión no sustituye pruebas con hardware USB real o sensores completos.
