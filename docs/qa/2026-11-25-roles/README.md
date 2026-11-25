# Validación de perfiles — 25 de noviembre de 2026

Actualización posterior: el usuario autorizó completar el PDF Legal. Ver [cierre de pendientes](../2026-11-25-pending/README.md); la exclusión descrita al final corresponde al alcance original de esta prueba.

Pruebas manuales realizadas en el ejecutable Tauri de OMEGA, con WebView2, backend local y una cuenta QA con membresía de prueba. Se conservaron los cambios visuales existentes. No se enviaron correos reales ni se realizaron cobros reales.

## Recorridos comprobados

- **Legal:** carga e indexación de un PDF ficticio, identificación de dos pasajes, confirmación con nota y consulta de la fuente en página 1. Autor y fecha visibles. [Captura](01-legal-revision.png).
- **General:** verificación de enlace, guardado en «Análisis personales», lectura de observaciones y recomendaciones y descarga PDF/JSON. [Captura](02-general-evidencia.png).
- **Desarrollo:** análisis estático de un manifiesto ficticio con un hook sospechoso; no se ejecutó el hook. Se verificó regla, ubicación, guía específica y contribución de 35 puntos. La comparación mostró un hallazgo nuevo respecto al escaneo anterior. Se descargó el PDF de Desarrollo y se comprobó su contenido. [Captura](03-desarrollo-guia.png).
- **Créditos:** saldo QA de 517 a 505: indexación Legal 1, escaneo Desarrollo 10 y enlace 1. Los informes no consumieron créditos. El perfil QA se devolvió a Legal.

El PDF General descargado tiene dos páginas e incluye la evaluación guardada. SHA-256: `535f5b00f90a04e57506056432ae425098094139e819cebf30c924262d6a948f`. El PDF Desarrollo descargado contiene regla y puntaje; SHA-256: `ddc9dd84902ac767672f86c95a0d497de6066360592f73c7e7082366257e6dff`.

## Comprobaciones automáticas

- Batería backend de 52 pruebas: informes, membresías, créditos, permisos, versiones, evidencia y revisión documental; sin fallos.
- Regresión tras corregir el puntaje: 15 pruebas backend; sin fallos. Tras ajustar el resumen General: 13 pruebas; sin fallos. Estas ejecuciones se solapan y no se suman.
- Batería completa de interfaz: 104 pruebas; sin fallos. Los últimos cambios posteriores fueron únicamente textos de conservación de originales; frontend compilado y actualizado después.
- Respaldo y restauración real en una base QA aislada: 26 cuentas, 28 usuarios, 3 pagos y 3 informes. El respaldo validó su formato y checksum; no se restauró sobre la base de la aplicación.
- Migraciones V28 y V29 aplicadas. La reparación de contribuciones existentes se contrastó en la interfaz nativa.

## Límites

El contenido del PDF Legal se excluyó expresamente. La facturación fiscal queda pendiente de proveedor y configuración comercial; el reintento de correo se probó con entrega deshabilitada. No se validaron en esta sesión hardware USB real, todos los sensores del equipo ni entrega a buzones reales. Los textos comerciales continúan como borradores y las ventas live siguen condicionadas a su publicación.
