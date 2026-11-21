# Ciclo de Vida de Datos, Retención, Supresión y Backups — Perfil LEGAL (Q9)

## 1. Qué se elimina y qué se conserva en una «Supresión a petición»

| Categoría de dato | ¿Se elimina al borrar el expediente (`DELETE /api/v1/expedientes/{id}`)? | Mecanismo |
| --- | --- | --- |
| Documento original (PDF/DOCX/PNG/JPEG) | **Nunca se almacena** (Zero-Retention; temporal purgado al terminar extracción) | `IngestTemporaryFiles.purge()` |
| Metadatos del expediente (`omega_rag.expedientes`) | **Sí, inmediato** | Transacción SQL |
| Inventario de documentos (`omega_rag.documents`) | **Sí, en cascada** | `ON DELETE CASCADE` |
| Fragmentos de texto y embeddings (`omega_rag.document_chunks`) | **Sí, en cascada** | `ON DELETE CASCADE` |
| Eventos de cronología (`omega_rag.legal_timeline_events`) | **Sí, en cascada** | `ON DELETE CASCADE` |
| Permisos del expediente (`omega_rag.expediente_permissions`) | **Sí, en cascada** | `ON DELETE CASCADE` |
| Historial de chat del asistente | **Nunca se persiste** (efímero en memoria del navegador) | Sin tabla de persistencia |
| Pista de auditoría (`omega_rag.audit_logs`) | **Se conserva inmutable (solo IDs y hashes)** | Cadena SHA-256 sin contenido, nombres de archivo ni PII |

## 2. Procedimiento recomendado de «Supresión a petición» del cliente

1. **Exportar dossier de entrega:** Desde el detalle del expediente, pulsar **Exportar dossier (PDF)** y/o **Exportar paquete técnico (JSON)** (Q3). Entregar al cliente el archivo junto con el hash SHA-256 del paquete como *verificación técnica de integridad*.
2. **Ejecutar supresión en cascada:** Un `ADMIN` o propietario (`ANALYST` con `WRITE`) ejecuta **Eliminar expediente** y confirma la acción. Esto elimina inmediatamente documentos, fragmentos, embeddings, cronología y permisos en PostgreSQL y registra `EXPEDIENTE_DELETED` (solo ID) en `audit_logs`.
3. **Registrar en bitácora de supresiones del operador:** Anotar el `expedienteId`, la fecha UTC y el ID del evento `EXPEDIENTE_DELETED` en el registro interno del despacho para gestionar copias de seguridad.

## 3. Retención, copias de seguridad (backups) y restauración

- **Limitación inherente a copias de seguridad:** Borrar un expediente en PostgreSQL elimina las filas activas inmediatamente, pero **no purga retroactivamente snapshots o dumps históricos** que el operador conserve en disco o cinta hasta que dichos backups expiren según su política de retención.
- **Política recomendada de retención de backups:** Definir una ventana acotada (p. ej., 30 días de retención rotativa con cifrado en reposo en volumen controlado por el despacho) y documentarla en la política de tratamiento de datos.
- **Procedimiento obligatorio al restaurar un backup:**
  1. Restaurar el backup en un entorno aislado (sin exponerlo todavía a los usuarios).
  2. Consultar la lista de eventos `EXPEDIENTE_DELETED` ocurridos entre la fecha del backup y la fecha actual (desde la bitácora de supresiones o la cadena de auditoría más reciente).
  3. Re-ejecutar la eliminación en cascada de esos `expedienteId` antes de poner el servicio nuevamente en producción, evitando la "resurrección" de expedientes suprimidos.
