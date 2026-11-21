# Temporales de documentos

Los formatos admitidos por perfil se documentan en `legal_expedientes.md`. El original no se conserva de forma permanente.

Spring/Tomcat recibe multipart en `spring.servlet.multipart.location`, configurado como
`OMEGA_MULTIPART_TMP_DIR` o, por defecto, `<omega.ingest.temp-dir>/multipart`.
La ingesta usa un segundo archivo UUID en `omega.ingest.temp-dir`
(`OMEGA_INGEST_TMP_DIR`, por defecto `/tmp/omega_ingest`).
El cierre de la petición elimina el spool multipart; el procesador elimina su archivo en `finally`.

En Docker Compose, `/tmp/omega_ingest` es tmpfs; el subdirectorio multipart comparte ese montaje.
En el host o con una ruta alternativa puede ser disco: no se afirma retención exclusiva en RAM.
El operador debe montar ambas ubicaciones en almacenamiento volátil si exige esa propiedad.

Un barrido cada minuto reintenta eliminaciones fallidas y elimina huérfanos reconocibles
con más de 24 horas. No recorre subdirectorios arbitrarios ni elimina los PDF registrados como activos.
Los fallos emiten códigos técnicos y contadores, sin rutas, contenido ni trazas.
Tras una caída del proceso, los temporales pueden existir hasta el barrido por antigüedad.

La auditoría nueva conserva identificadores, hashes, estados fijos, contadores y fechas.
No conserva nombres de archivo ni mensajes de excepción. No se reescriben cadenas históricas:
los metadatos históricos que no cumplen esa política se ocultan en la API y en exportes,
manteniendo sus compromisos hash. Su eliminación física exigiría una política específica
de retención de auditoría y copias de seguridad; no se promete borrado retroactivo de backups.

Consultar con READ no modifica estados documentales. El endpoint nuevo
`POST /api/v1/expedientes/{id}/documents/mark-reindex-required` requiere WRITE y rol
ADMIN o ANALYST; marca explícitamente el cambio de modelo y queda auditado.
Los endpoints existentes conservan sus rutas y formas de respuesta.
