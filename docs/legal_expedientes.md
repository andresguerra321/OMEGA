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

## Abstención y citas

LEGAL consulta exclusivamente el expediente autorizado y los documentos seleccionados. No usa el
historial ni el contexto técnico enviado por el cliente como evidencia o instrucciones de análisis.
Las preguntas deben identificar explícitamente lo que se quiere consultar.
Sin documentos listos o sin fragmentos relevantes devuelve esta respuesta fija, sin invocar el generador:

> No hay fragmentos relevantes suficientes en este expediente para responder. No es asesoría legal.

La recuperación exige coincidencia léxica o similitud vectorial mínima de 0,78. Este umbral no garantiza
exhaustividad ni pertinencia jurídica. Con evidencia, las líneas del modelo deben incluir referencias
válidas a fragmentos recuperados; si no las tienen, se muestran extractos citados en su lugar.
Las referencias incluyen id documental y página o segmento; los nombres de archivo no se envían como
etiquetas de cita de LEGAL. Una referencia válida no acredita por sí sola la verdad o interpretación
de una afirmación: el usuario debe revisar el fragmento y el documento conservado localmente.

El chat principal mantiene un aviso de no asesoría y no permite cambiar a fuentes públicas en LEGAL.
Las imágenes deben cargarse e indexarse como documentos antes de consultarse; el endpoint multimodal
efímero no sustituye ese recorrido con citas. GENERAL conserva su selección de fuentes y su generador.

---

## Límites del perfil LEGAL (qué hace y qué NO hace)

> **Advertencia permanente:** OMEGA es una herramienta técnica de apoyo documental. **No ofrece asesoría legal** ni reemplaza el criterio de un abogado habilitado.

| Dimensión | Qué SÍ hace OMEGA (`LEGAL`) | Qué NO hace (fuera de alcance) |
| --- | --- | --- |
| **Naturaleza del asistente** | Responde preguntas acotadas a un expediente o a documentos seleccionados citando documento y página, y se abstiene (`LEGAL_ABSTENTION`) cuando no hay fragmentos relevantes. | No emite dictámenes jurídicos, no recomienda estrategia procesal ni sustituye revisión profesional. |
| **Almacenamiento (Zero-Retention)** | Guarda metadatos, hash SHA-256 del archivo recibido, fragmentos de texto, embeddings y eventos de cronología extraídos. | **Nunca** guarda el PDF/Word/imagen original ni usa almacenamiento en la nube. No persiste historial de chat por defecto. |
| **Formatos admitidos** | PDF (con OCR opcional), Word (`.docx` sin macros/objetos activos/DTD/referencias externas), PNG y JPEG (validación por firma binaria). | No ejecuta macros, no extrae texto de imágenes incrustadas dentro de `.docx`, ni admite `.doc` binario legado. |
| **Integridad y dossier** | Exporta dossier PDF y paquete técnico JSON con inventario SHA-256, permisos vigentes, actividad auditada y hash SHA-256 del paquete como **verificación técnica de integridad**. | No constituye firma electrónica con validez jurídica, sello de tiempo calificado ni prueba pericial certificada. |
| **Cronología** | Extrae fechas de forma determinista con enlace obligatorio a documento y página, etiquetadas como *«Extraído automáticamente, verifique»*, con confirmación/corrección/ocultación auditada. | No gestiona plazos procesales, vencimientos judiciales ni alertas de términos legales. |
| **Proveedores de IA** | Separa modelo de indexación y modelo de respuestas, muestra destinos (`Se queda en tu equipo` vs `Sale a: <proveedor>`) y exige consentimiento previo del `ADMIN` (`V19`). | No oculta envíos externos ni certifica privacidad del proveedor externo elegido por el despacho. |
| **Retención y backups** | El borrado de expediente elimina en cascada documentos, fragmentos, embeddings, cronología y permisos; `audit_logs` conserva solo IDs y hashes. | El borrado no purga automáticamente backups históricos de PostgreSQL (ver `docs/legal_retencion_y_backups.md`). |

---

## Guía de prueba manual de punta a punta (corpus sintético)

> Utiliza exclusivamente documentos ficticios (nunca archivos reales de clientes).

1. **Registro y perfil:** Crea un espacio nuevo en OMEGA, inicia sesión como `ADMIN` y cambia el perfil a `LEGAL` en **Cuenta y Ajustes** (confirmando el cambio). Verifica que la vista abre en **Expedientes**.
2. **Consentimiento de IA (`V19`):** En la tarjeta **IA de tus documentos**, comprueba que aparecen separados **Indexación de documentos** y **Modelo de respuestas** con su destino (*Se queda en tu equipo* o *Sale a: ...*). Intenta cargar un documento antes de aceptar y verifica que queda bloqueado; luego pulsa **Acepto esta política de documentos**.
3. **Crear expediente:** Pulsa **Nuevo expediente** (o **Cargar expediente de demo (ficticio)**), ingresa título, referencia y clasificación, y ábrelo.
4. **Cargar documento sintético:** En la pestaña **Documentos**, sube un PDF sintético de 2 páginas con fechas, partes y montos ficticios (o un `.docx`/`.png` sintético). Verifica que pasa a estado **Listo**, abre su ficha, revisa el texto extraído y prueba **Comparar con un archivo local** para comprobar el hash SHA-256 en tu equipo.
5. **Consulta con cita:** En la pestaña **Asistente** (dentro del expediente), pulsa una acción rápida (p. ej. *Partes, fechas y montos*) o escribe una pregunta sobre un dato presente en el PDF. Haz clic en el botón `[1]` de la cita y confirma que se abre el visor lateral en la página exacta.
6. **Consulta sin sustento (abstención):** Pregunta por un hecho inexistente en el expediente (p. ej. una hipoteca marítima ficticia). Verifica el badge **Abstención: sin sustento suficiente** y el mensaje fijo `No hay fragmentos relevantes suficientes en este expediente para responder. No es asesoría legal.`
7. **Cronología:** Abre la pestaña **Cronología**, pulsa **Extraer cronología**, comprueba la etiqueta **Extraído automáticamente, verifique**, abre la cita lateral, y prueba **Confirmar**, **Corregir** y **Ocultar**.
8. **Permisos y búsqueda:** Crea un usuario `CLIENT`, asígnale permiso `READ` sobre el expediente desde **Acceso**, inicia sesión con ese usuario y confirma que puede leer y buscar en ese expediente, pero no editar ni ver expedientes ajenos.
9. **Exportar dossier:** En la cabecera del expediente, pulsa **Exportar dossier (PDF)** y **Exportar paquete técnico (JSON)**. Comprueba que incluye inventario SHA-256, permisos vigentes, actividad y hash del paquete descrito como *verificación técnica de integridad*.
10. **Supresión en cascada:** Como `ADMIN`, pulsa **Eliminar expediente** y confirma la supresión. Verifica que el expediente desaparece de la lista y que en auditoría solo persiste el registro técnico sin contenido documental.

