# Expedientes LEGAL

OMEGA ayuda a consultar documentos; **no ofrece asesoría legal**. Los resultados automáticos
requieren revisión profesional. Un SHA-256 ofrece verificación técnica de integridad;
no constituye firma, certificación jurídica ni garantía de autenticidad.

## Almacenamiento

Se guardan metadatos, hash SHA-256 del archivo recibido y fragmentos de texto con página o segmento,
sección, orden, número estimado de tokens y embeddings. Son datos confidenciales del tenant.
No se guarda permanentemente el original ni se conservan offsets de caracteres o coordenadas.
El lector muestra fragmentos extraídos; puede haber solapamiento entre fragmentos de una página.
No reconstruye el diseño original. Los temporales y su limpieza se documentan en `legal_temporales.md`.

Solo LEGAL admite DOCX de texto y PNG/JPEG además de PDF. Usa las bibliotecas ya instaladas.
DOCX se lee sin ejecutar Office: se rechazan macros, objetos activos, referencias externas y XML
con DTD; se limita el tamaño descomprimido. No se extrae texto de imágenes incrustadas en Word.
Sus segmentos siguen los saltos explícitos, sin prometer páginas de impresión.
PNG/JPEG exige límites de tamaño/dimensiones y el adaptador OCR existente. Sin OCR o texto legible,
la indexación falla con un motivo seguro; no se inventa texto. Las pruebas de OCR usan un adaptador
sintético, no acreditan una instalación nativa de Tesseract en el equipo de producción.

GENERAL y DEVELOPER conservan la admisión de PDF. Las fichas de rechazo persistentes se habilitan
solo para LEGAL. Los errores conservan códigos técnicos y la UI recibe mensajes fijos sin trazas.

## Permisos y auditoría

Toda operación exige autorización del backend y tenant autenticado. READ permite consultar;
WRITE permite editar metadatos. Subir, borrar y marcar reindexación requieren además ADMIN o ANALYST.
Solo propietario o ADMIN puede conceder, listar y revocar permisos. No existe invitación externa
habilitada por este trabajo; su diseño se trata como propuesta independiente.
Sin acceso se responde 404/403. Crear, editar, subir, leer texto, cambiar permisos, borrar y exportar
deja auditoría encadenada. Sus metadatos nuevos no guardan nombres, contenido ni errores internos.
Los exportes usan ids en lugar de nombres de archivos y títulos del caso.

Borrar un documento elimina sus fragmentos y embeddings por claves foráneas; borrar el expediente
elimina documentos, permisos y datos derivados. Un trabajo ya iniciado no puede recrear filas
eliminadas y limpia su temporal al terminar. La auditoría inmutable se conserva sin contenido.
El borrado no equivale a purga inmediata de copias de seguridad: el operador debe definir retención
y aplicar las eliminaciones al restaurar una copia antes de ponerla en servicio.

## API aditiva

Las listas y detalles anteriores conservan su contrato. Las nuevas rutas bajo `/api/v1/expedientes` son:

| Método y ruta | Uso |
| --- | --- |
| `GET /page` | Lista paginada; `page`, `size` (máximo 100), `search`, `status`, `classification`, `order` |
| `GET /{id}/metadata` | Descripción, referencia, estado, fechas y permisos efectivos |
| `PUT /{id}/metadata` | Edita título, clasificación, descripción, referencia y estado |
| `GET /{id}/documents/page` | Documentos paginados con formato, código de error y motivo seguro |
| `GET /{id}/documents/{documentId}/detail` | Ficha técnica y motivo de error |
| `GET /{id}/documents/{documentId}/text?pageNumber=1` | Fragmentos de una página o segmento |
| `GET /{id}/activity/page` | Actividad paginada, filtrada por tenant y expediente |
| `GET /{id}/permissions` | Permisos; propietario o ADMIN |
| `DELETE /{id}/permissions/{userId}` | Revoca acceso; propietario o ADMIN |
| `DELETE /{id}/documents/{documentId}` | Elimina documento y datos derivados |
| `DELETE /{id}` | Elimina expediente y datos derivados |
| `POST /{id}/documents/mark-reindex-required` | Marca explícitamente documentos de modelo distinto |

`POST /{id}/query` acepta opcionalmente `documentIds` (máximo 100). Cada id debe pertenecer al
expediente autorizado; un id ajeno produce 404. La selección se aplica en SQL antes de ordenar
y limitar resultados, tanto en recuperación vectorial como léxica. Sin selección se conserva el alcance anterior.
Una consulta puede advertir reindexación, pero no cambia estados documentales.

V17 corrige alcance en tenants LEGAL. V18 añade metadatos, motivos/formato y reserva la tabla de
cronología con borrado en cascada. Sus comentarios describen la reversa y las pérdidas de metadatos
que implica; no se ejecuta ninguna reversa automáticamente.

La política de proveedores, consentimiento, flujo completo de UI y guía manual se completan en los
bloques siguientes. No se acredita todavía el perfil LEGAL como producto terminado.
