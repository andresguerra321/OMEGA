# Flujos de los perfiles

Actualizado: 25 de noviembre de 2026. Incluye la ampliación autorizada del PDF Legal.

## General

Las evaluaciones compatibles guardan observaciones saneadas en PostgreSQL: verificación de enlaces, archivos, YARA, indicadores, análisis de dispositivos y persistencia del equipo. No se conserva el archivo original ni una captura completa del dispositivo. Sin expediente explícito, se usa un espacio privado del usuario, «Análisis personales».

Cuenta → Informes muestra el historial, recomendaciones, límites y comparación de dos evaluaciones del mismo tipo. Los valores desconocidos no se convierten en cero. Eliminar un detalle invalida los informes General asociados; consultar otra vez un trabajo USB completado no lo vuelve a crear. No se reconstruyen resultados antiguos que nunca se guardaron.

El informe General incorpora las evaluaciones guardadas, además de la evidencia existente. Guardar y descargar resultados existentes cuesta cero créditos. El resultado no certifica ausencia de amenazas.

## Desarrollo

Hallazgos y Triaje muestra por defecto el último escaneo de cada proyecto. El historial se activa en Opciones avanzadas. Cada regla incluye orientación de corrección, ubicación y verificación; marcar un hallazgo como resuelto no prueba su corrección.

Políticas y Reportes compara las huellas de las dos últimas evaluaciones: nuevas, persistentes y no detectadas en la última. Una ausencia puede responder a diferencias de cobertura. El PDF y JSON de Desarrollo incluyen orientación y comparación. La contribución de cada hallazgo se obtiene del desglose del analizador cuando no viene en el hallazgo; V29 repara registros previos afectados sin reescribir informes históricos.

## Legal

Expedientes → Pasajes y revisión identifica menciones literales de obligaciones y valores en texto ya indexado. Conserva cita, documento, fragmento y página para contrastar la fuente. Confirmar o rechazar requiere una nota; se registra autor, fecha y revisión para evitar sobrescribir cambios concurrentes.

La revisión no determina exigibilidad, deudas ni conclusiones jurídicas. El PDF y el JSON incluyen pasajes, fuentes, cobertura y registro de revisión con criterio, autor, fecha y revisión. Después de modificar una revisión, se genera una nueva versión del informe; las versiones guardadas previamente conservan sus bytes originales.

## Operación

- Los accesos comprueban usuario, organización y permisos del expediente. Las pruebas incluyen aislamiento, permisos de lectura y revisiones concurrentes.
- La sesión nativa permanece en memoria. La opción web de recordar sesión no se presenta como persistencia nativa.
- Una instalación con IA configurada permite verificar y usar ese motor antes de completar el segundo factor obligatorio.
- Documentos y facturación muestra fallos de notificación y permite reintentar los elegibles cuando el correo está habilitado. La facturación fiscal se gestiona manualmente por decisión del usuario; su automatización sigue sin configurar. Los comprobantes de pago no son facturas fiscales. Ver [procedimiento manual](billing-manual.md).
- `omega/scripts/backup_local.ps1` copia el dump binario sin redirección de PowerShell; `test_backup_restore.ps1 -BackupFile <ruta>` prueba la restauración en un contenedor aislado y temporal.

Ver [evidencia de validación](qa/2026-11-25-roles/README.md) y [pendientes comerciales](commercial-readiness.md).
