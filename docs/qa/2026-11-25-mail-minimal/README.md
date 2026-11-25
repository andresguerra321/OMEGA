# Correo minimalista y corrección de pruebas backend

25 de noviembre de 2026. Sustituye visualmente la [plantilla oscura anterior](../2026-11-25-mail/README.md).

## Plantilla compartida

Se conserva y completa `OmegaEmailTemplate`, ya incorporada en la rama del usuario. Pagos, informes, códigos 2FA, recuperación e invitaciones comparten estructura. El componente admite también el contenido de alertas y un CTA opcional; esta modificación no activa nuevos canales de alerta.

- Claro por defecto, modo oscuro mediante `prefers-color-scheme`, metadatos `color-scheme` y ajustes para clientes con `data-ogsc`.
- Tablas de presentación, CSS inline, contenedor de 540 px y envoltura específica para Outlook clásico. Sin banner 3D ni kicker redundante.
- Isotipo Ω PNG transparente de 48 × 48, mostrado a 24 px e incluido mediante Content-ID. No se necesitan imágenes remotas.
- Párrafos, resumen de metadatos, código monoespaciado, CTA único opcional y URL visible. Solo se aceptan destinos HTTPS válidos, sin credenciales incrustadas.
- Preheader oculto, motivo del envío con la cuenta del destinatario y enlace al soporte configurado. Si no existe contacto de soporte específico, los emisores usan el remitente configurado.
- Los códigos de acceso y recuperación permanecen fuera del preheader. No se modifican vencimiento, intentos, destinatarios, permisos o validación de códigos.
- Asunto, contenido, metadatos, destinatario y enlaces se escapan al insertarlos en HTML. Se mantienen texto alternativo, reintentos y limpieza del cuerpo después de enviar.

## Revisión visual y SMTP

Se comprobaron 16 combinaciones de cuatro tipos (pago, 2FA, aviso de seguridad e informe), dos anchuras (390/800 px) y dos modos (claro/oscuro). El [registro de dimensiones](layout-checks.json) confirma ausencia de desbordamientos.

- [Pago en escritorio claro](pago-800-light.png).
- [Pago en móvil oscuro](pago-390-dark.png).
- [Código 2FA claro](2fa-390-light.png) y [oscuro](2fa-390-dark.png).
- [Aviso de seguridad](seguridad-800-dark.png).
- [Informe en móvil claro](informe-390-light.png).

Las muestras contienen datos ficticios. Pasaron 12 pruebas específicas de plantilla, transporte SMTP real local y recuperación de cuenta. Se envió una única muestra al destinatario autorizado, asunto «OMEGA - Nueva plantilla clara y oscura»; el servidor SMTP la aceptó. El backend local se actualizó conservando las credenciales existentes.

Estas capturas verifican el HTML y las media queries en un navegador. No equivalen a pruebas de cada versión de Gmail, Apple Mail u Outlook; algunos clientes aplican inversión automática de colores o limitan CSS. No se adjuntan facturas fiscales con este cambio.

## Causa del fallo en GitHub Actions

El run `45630338177` ejecutó 244 pruebas y encontró 40 fallos: suites funcionales antiguas registraban cuentas gratuitas antes de usar funciones ahora pagadas. Al completar ese requisito apareció también la confirmación explícita de consumo de créditos, ausente en los clientes de prueba antiguos.

`PaidWorkspaceFixture` se importa únicamente en esas suites funcionales: provisiona membresía Enterprise verificada para permitir sus equipos de prueba, concede créditos QA y añade el límite de consumo explícito a sus solicitudes MockMvc. Las suites de facturación conservan sus cuentas gratuitas y pruebas negativas. No se desactiva ningún control ni se cambia la política de producción.

Las pruebas de cuotas consultan el plan realmente activo para comprobar el mismo límite y sus condiciones de carrera. La reproducción local completa se realiza en Linux con Testcontainers, una base separada por suite y los recursos SQL/corpus del repositorio.

La última ejecución completa local ejecutó 248 pruebas: 246 pasaron y quedaron dos supuestos de cuotas sobre PERSONAL. Después de corregirlos se repitieron sus dos suites (6 pruebas), todas aprobadas. La confirmación completa del commit final corresponde al run de GitHub Actions asociado al PR.

El [run completo del PR](https://github.com/andresguerra321/OMEGA/actions/runs/45700109267) pasó después de esas correcciones. El PR también descubrió dos problemas previos de herramientas: el pin VICE 1.4.2 no estaba publicado y Semgrep 1.99 fallaba al importar `pkg_resources`. Se fijó VICE 3.5.0, se añadió setuptools 80.9.0 para el Semgrep fijado y se exige que produzca ambos reportes antes de continuar. Se conserva el umbral VICE 90 y el evaluador Semgrep fail-closed; sus seis pruebas pasaron.
