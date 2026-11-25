# Diseño de correo transaccional

25 de noviembre de 2026. El titular confirmó la recepción de la prueba SMTP inicial y pidió aplicar el diseño de OMEGA.

## Implementación

Los avisos existentes de pagos, membresías e informes usan ahora MIME con alternativas de texto y HTML, remitente visible «OMEGA Security», banner del proyecto incluido por Content-ID, fondo obsidiana y superficies oscuras. Se reutiliza `mail/omega-banner.jpg`, la imagen de los códigos de verificación; no se agregaron imágenes remotas ni dependencias.

El asunto y el contenido de la cola se escapan antes de insertarlos en HTML. Se conservan destinatario registrado, permisos, eventos, reintentos y borrado del cuerpo después del envío. Los documentos fiscales manuales no se adjuntan con esta modificación.

## Validación

- Dos pruebas de plantilla/transporte: HTML y texto recibidos por SMTP local real, banner MIME, nombre del remitente, destinatario registrado y escape de contenido.
- Cuatro pruebas de integración de informes y correo: fallo, reintento y limpieza del contenido, entre los comportamientos comprobados. Todas pasaron.
- Previsualización del HTML extraído del mensaje MIME capturado: [390 píxeles](correo-movil.png) y [800 píxeles](correo-escritorio.png). En ambas, la anchura del documento coincide con el viewport. La captura móvil inicial de la CLI no representaba el viewport móvil y fue sustituida por una comprobación mediante emulación explícita.
- Backend local compilado, actualizado y saludable. SMTP habilitado y configuración conservada.
- Una muestra del nuevo HTML se envió al mismo destinatario autorizado para la prueba inicial. El servidor la aceptó con el asunto «OMEGA - Prueba del diseño de correo». Falta confirmación del titular sobre cómo se muestra en su cliente de correo; no se afirma compatibilidad visual comprobada en todas las versiones de Gmail u Outlook.

La base temporal de integración se retiró. No se publicaron releases ni se realizaron cobros.
