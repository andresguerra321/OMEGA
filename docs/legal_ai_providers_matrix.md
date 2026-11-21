# Matriz Verificada de Proveedores de IA — Perfil LEGAL (Q2)

> **Principio de transparencia:** OMEGA separa explícitamente **modelo de indexación (embeddings/texto)** y **modelo de respuestas (generación RAG)**. Antes de cargar o consultar en un tenant `LEGAL`, un `ADMIN` debe revisar y aceptar la huella (`fingerprint`, migración `V19`) de la configuración activa.

## 1. Matriz verificada por proveedor

| Escenario de configuración | Modelo de indexación | Destino de indexación | Modelo de respuestas | Destino de respuestas | ¿Indexa y consulta? | Reindexado sin volver a subir PDF |
| --- | --- | --- | --- | --- | --- | --- |
| **Groq** (`AiSetupGate` ejecuta `clearOpenAiKey`) | `LOCAL_TEXT` (`lexical-only-tsvector`) | `LOCAL` (*Se queda en tu equipo / servidor OMEGA*) | `GROQ` (`openai/gpt-oss-120b` o configurado) | `Sale a: Groq (https://api.groq.com)` | **Sí** (búsqueda léxica exacta `tsvector`; sin búsqueda semántica vectorial) | **Sí** (`POST /api/v1/expedientes/{id}/documents/{docId}/reindex` reutiliza fragmentos guardados) |
| **OpenAI** (clave OpenAI activa) | `OPENAI` (`text-embedding-3-small`) | `Sale a: OpenAI (https://api.openai.com)` | `OPENAI` (`gpt-4o-mini` o configurado) | `Sale a: OpenAI (https://api.openai.com)` | **Sí** (búsqueda híbrida vectorial + léxica RRF) | **Sí** (actualiza embeddings desde `document_chunks` conservando SHA-256 y páginas) |
| **Ollama local** (`omega.ai.provider=ollama`) | `OLLAMA` (`nomic-embed-text` / configurado) | `LOCAL` (*Se queda en tu equipo* si host es `localhost`/`127.0.0.1`/`ollama`) | `OLLAMA` (`llama3.2` / configurado) | `LOCAL` | **Sí** (requiere instancia Ollama activa y modelos descargados; no descarga modelos automáticamente) | **Sí** (reindexa desde fragmentos guardados si la dimensión coincide con `1536` o degrada a `lexical-only-tsvector`) |
| **Sin claves externas (fallback)** | `LOCAL_TEXT` (`lexical-only-tsvector`) | `LOCAL` | `EXTRACTIVE` (`omega-extractive-fallback`) | `LOCAL` | **Sí** (extractos citados deterministas sin síntesis LLM) | **Sí** |

## 2. Consentimiento del administrador (`V19`)

- `GET /api/v1/legal/document-ai/policy` devuelve `indexing`, `responses`, `fingerprint` (SHA-256 de proveedores, modelos, destinos y dimensiones) y `accepted`.
- `POST /api/v1/legal/document-ai/consent` exige rol `ADMIN`; usuarios `ANALYST` y `CLIENT` reciben `403 Forbidden`.
- Sin aceptación vigente, `POST /documents`, `POST /query` y `POST /reindex` bloquean con `409 Conflict`.
- Cualquier cambio en modelo, endpoint o dimensiones cambia `fingerprint` e invalida automáticamente la aceptación anterior.

## 3. Almacenamiento de claves en escritorio y no-fuga

- En la aplicación de escritorio (`omega/desktop/src-tauri/src/desktop_config.rs`), las claves configuradas por el usuario se almacenan en `desktop-config.json` dentro del directorio de datos de la aplicación que resuelve Tauri (permisos `0600` en Unix; JSON sin cifrado adicional de aplicación).
- Los endpoints de política (`/api/v1/legal/document-ai/policy`), auditoría (`audit_logs`) y exportación de dossier (`/export/json`, `/export/pdf`) **nunca** incluyen claves API ni encabezados de autorización.
- Verificado en `LegalAiProviderMatrixTest`, `LegalDocumentAiPolicyTest` y `DocumentZeroRetentionIngestionTest`.
