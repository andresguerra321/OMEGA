# Validación comercial e informes — 25 de noviembre de 2026

Se utilizó la aplicación Tauri de Windows, con un perfil de WebView aislado y una cuenta ficticia de QA. Se inició sesión con contraseña y TOTP reales del entorno de pruebas. Se mantuvieron los datos y cambios de la instalación existente.

## Resultados manuales

- Cuenta → Informes y Cuenta → Documentos y facturación son accesibles desde el menú real.
- Se generaron y descargaron PDF y JSON de Legal, Desarrollo y General mediante sus controles. Se cambió el perfil del espacio ficticio con la confirmación de la interfaz y al terminar se restauró LEGAL.
- La nueva generación de Legal reutilizó la versión existente del día anterior: mismo ID y mismo SHA-256. No se generó otra versión por descargarla.
- El JSON Legal contiene dos eventos con documento, fragmento y página. Los PDF descargados se abrieron con un lector independiente y contienen texto extraíble. No se ejecutó un análisis nuevo para generarlos.
- El saldo de la cuenta se mantuvo en **517 créditos**, igual que al terminar la validación de Mercado Pago anterior. La renovación continuó cancelada y el período pagado se conservó.
- Se guardaron datos ficticios de facturación mediante el formulario y se descargó el comprobante de un pago de prueba. El PDF es legible, está marcado **PRUEBA** y aclara que no es una factura electrónica de venta. No se emitió ningún documento fiscal.
- La política de privacidad se abre en un diálogo con cierre accesible y aparece como **BORRADOR**. Muestra los datos de contacto configurados y señala la información pendiente. No se registró aceptación definitiva de un borrador.
- La cola muestra la notificación del informe como pendiente. No se enviaron correos a destinatarios reales.

## Ejemplos descargados desde la app

Estos archivos contienen evidencia de QA y sirven para revisar estructura y legibilidad; no representan una evaluación profesional de un equipo real.

| Perfil | Archivo | Páginas | SHA-256 |
|---|---|---:|---|
| General | [informe-general-qa.pdf](informe-general-qa.pdf) | 1 | `18547bea28ca7f499d5d3dfbba557836bf5eb2b94fa28d5ee3c37739e28193d3` |
| Desarrollo | [informe-desarrollo-qa.pdf](informe-desarrollo-qa.pdf) | 1 | `75aaa22d9b1850976a1b92e6527ed1395a5ef1ec336b80933d3e2edefb30207f` |
| Legal | [informe-legal-qa.pdf](informe-legal-qa.pdf) | 2 | `3a3a6fd87da7706cc73857d8a73f4ef1c8479c3cd93c71c36a16a4c8dc8ee25c` |

El caso pequeño de Desarrollo cabe en una página. La prueba automatizada adicional genera **230 hallazgos**, comprueba varias páginas y verifica que el último hallazgo y las ubicaciones largas siguen presentes.

## Pruebas automatizadas

- Backend: **40 pruebas aprobadas** de informes, documentos comerciales, facturación/créditos y dossier técnico. Migración V27 validada desde una base PostgreSQL aislada vacía.
- Se repitieron las **4 pruebas de integración de informes** añadiendo acceso delegado y revocación: un permiso retirado deja de permitir listar y descargar la versión. También se comprobó aislamiento entre tenants, eliminación al borrar documentos fuente, reutilización de versiones y exportación sin consumo.
- Interfaz: **95 pruebas aprobadas**. Después de corregir los accesos del menú, se repitieron las **12 pruebas relevantes de navegación e informes**, todas aprobadas. Esas 12 están incluidas en el conjunto anterior, no son un total adicional.
- Compilaciones Maven, Vite e imágenes Docker completadas. Backend y frontend actualizados localmente; se conservaron PostgreSQL y el worker.
- Los fallos de SMTP se comprobaron con un remitente simulado y PostgreSQL aislado: reintento pendiente y envío posterior confirmado, sin realizar una conexión SMTP real.

## Capturas

- [Informes en la app](01-native-informes.png).
- [Datos de facturación y comprobantes](02-native-facturacion.png).
- [Política como borrador](03-native-privacidad-borrador.png).
- [Versiones de los tres perfiles](04-native-tres-perfiles.png).
- [Saldo de créditos conservado](05-native-creditos.png).

## Límites y pendientes externos

No se habilitaron envíos reales, emisión DIAN, rebotes de correo ni publicación definitiva de términos. Faltan identidad fiscal confirmada con RUT, domicilio comercial, condiciones verificadas de proveedores y conservación/respaldos y revisión de los textos finales. Los informes son automatizados y declaran su alcance; Legal no calcula plazos procesales ni certifica obligaciones o contradicciones. General no acredita ausencia de compromiso. Véase [operación comercial](../../commercial-readiness.md).
