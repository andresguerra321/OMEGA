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

## Proveedores y consentimiento

Respuestas e indexación son funciones distintas. Groq sirve respuestas; no proporciona los embeddings
de este pipeline. Al elegir Groq, AiSetupGate limpia la clave OpenAI guardada en su configuración.
Si no queda una clave OpenAI activa en el despliegue, los documentos se indexan localmente con
`lexical-only-tsvector`: la carga y las consultas exactas siguen funcionando, sin búsqueda semántica.
La prueba de integración ejecuta el proveedor OpenAI real sin clave, comprueba ese fallback y consulta
el documento con un cliente READ. No usa credenciales ni documentos reales.

Con OpenAI activo, se envían fragmentos al endpoint de embeddings y la pregunta se vectoriza con el
mismo modelo. Las respuestas pueden enviar fragmentos a los proveedores configurados: servidor
personalizado, OmniRoute, OpenAI o Groq, según la cadena activa. La política muestra todos los destinos
posibles sin claves. Un intermediario puede reenviar contenido; no se afirma que un gateway local
garantice procesamiento local. «Local» en una instalación web se refiere al servidor de OMEGA.

El camino **Configurar todo local (Ollama)** abre la configuración existente de Ollama. Ese modo activa
los adaptadores locales de respuestas y embeddings y la política soberana existente; requiere una
instancia y los modelos disponibles. No se instala ni descarga un modelo automáticamente.
Si el indexador no responde se muestra un motivo seguro y una guía hacia Cuenta → IA.

Antes de cargar o consultar en LEGAL, un ADMIN acepta explícitamente la política vigente:
`GET /api/v1/legal/document-ai/policy` y `POST /api/v1/legal/document-ai/consent` con su `fingerprint`.
V19 conserva el hash, la descripción pública de proveedores/modelos/destinos, el id del administrador
y la fecha. La acción se audita sin claves. Un cambio de modelos, destinos o dimensiones invalida la
aceptación; una aceptación de configuración anterior se rechaza con 409.

`POST /api/v1/expedientes/{id}/documents/{documentId}/reindex` exige WRITE y ADMIN/ANALYST.
Reutiliza el texto guardado y actualiza embeddings/modelos en una transacción sin volver a cargar el
original. Conserva hash, páginas, texto y orden de fragmentos; la operación queda auditada.
La prueba de cambio de modelo verifica el recorrido completo y la conservación del hash y fragmentos.

En escritorio, la implementación de `desktop_config.rs` guarda claves en `desktop-config.json`, bajo
el directorio de datos que obtiene Tauri. El archivo es JSON sin cifrado propio; en Unix se aplica
0600. Los resúmenes públicos solo devuelven indicadores de configuración. Se verificó esta ruta en
el código, sin abrir credenciales reales del usuario. No se ha verificado cifrado del sistema operativo
ni protección frente a otros procesos de la misma cuenta. Las claves no se incluyen en la política,
auditoría o dossier; los tests usan secretos sintéticos y los reportes no vuelcan cuerpos de petición.

El flujo completo de UI y la guía manual se completan en los bloques siguientes. No se acredita
todavía el perfil LEGAL como producto terminado.
