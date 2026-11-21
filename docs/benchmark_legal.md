# Evaluación y Benchmark del Asistente LEGAL (Q7)

> **Naturaleza del corpus:** 100% sintético y ficticio (`synthetic_cases.json` y `hard_benchmark_cases.json`). No contiene documentos ni datos personales de clientes reales.

## 1. Separación estricta: prueba de regresión determinista vs evaluación con modelos reales

Es crítico **no confundir** ambas mediciones:

1. **Prueba de regresión determinista offline (`-Mode deterministic`, ejecutada en CI):**
   - **Qué mide:** precisión del índice léxico (`tsvector`), aislamiento SQL por `tenant_id` / `expediente_id`, exactitud de metadatos de cita (`documentId` + `pageNumber`) y cumplimiento de guardarraíles (`LEGAL_ABSTENTION` y `guardedLegalAnswer`).
   - **Qué NO mide:** capacidad de comprensión semántica, síntesis ni tendencia a alucinar de un modelo LLM real (Groq, OpenAI u Ollama), ya que el generador está stubbeado para ser 100% reproducible sin red ni claves en CI.
2. **Evaluación manual con proveedores reales (`-Mode groq` / `-Mode ollama`, nunca en CI):**
   - **Qué mide:** comportamiento real de extremo a extremo sobre un conjunto difícil ([hard_benchmark_cases.json](file:///C:/Users/andre/OneDrive/Escritorio/proyectos/CAMPUS/OMEGA/omega/backend-java/src/test/resources/legal_benchmark/hard_benchmark_cases.json)) con **11 escenarios exigentes**:
     - `CONTRADICTORY_DOCS` (`H01`–`H02`): contradicción entre contrato base y otrosí modificatorio en el mismo expediente (verifica que recupera ambos documentos).
     - `NEAR_MISS` (`H03`–`H06`): casi-aciertos que comparten nombres de partes y conceptos con el contrato, pero preguntan por datos ausentes (tasa de interés moratorio, cámara arbitral, registro sanitario, salario base).
     - `SEMANTIC_PARAPHRASE` (`H07`–`H08`): preguntas formuladas con sinónimos que no aparecen literalmente en el texto (*«situaciones extraordinarias»* -> *«fuerza mayor»*; *«desembolso único»* -> *«una sola cuota»*).
     - `CROSS_CASE` (`H09`–`H11`): preguntas que mezclan expedientes del mismo despacho.

## 2. Cómo ejecutar cada modo

```powershell
# 1. Regresión determinista (CI / offline — solo infraestructura RAG y guardarraíles)
.\scripts\run_legal_benchmark.ps1 -Mode deterministic

# 2. Evaluación manual con Groq real (requiere backend corriendo con GROQ_API_KEY; nunca en CI)
$env:GROQ_API_KEY = "gsk_..."
.\scripts\run_legal_benchmark.ps1 -Mode groq -BaseUrl http://127.0.0.1:8080

# 3. Evaluación manual con Ollama local (chat + embeddings reales; nunca en CI)
$env:OMEGA_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
.\scripts\run_legal_benchmark.ps1 -Mode ollama -BaseUrl http://127.0.0.1:8080
```

## 3. Comparativa documentada: `LOCAL_TEXT` (`tsvector`) vs embeddings reales (OpenAI / Ollama)

| Tipo de consulta | `LOCAL_TEXT` (`lexical-only-tsvector`, ej. Groq sin clave OpenAI) | Embeddings reales (OpenAI `text-embedding-3-small` / Ollama `bge-m3`) |
| --- | --- | --- |
| **Términos exactos** (montos, nombres propios, números de cláusula) | **Alta recuperación** (coincidencia exacta rápida y determinista, sin envío externo de fragmentos al indexar). | **Alta recuperación** (búsqueda híbrida RRF combina vector + léxico). |
| **Paráfrasis semánticas** (`H07`: *«exonerado de sanciones»* vs *«fuerza mayor»*; `H08`: *«desembolso único»* vs *«una sola cuota»*) | **Limitada / baja:** puede devolver `LEGAL_ABSTENTION` si la pregunta no comparte palabras literales con el documento. | **Significativamente superior:** el vector semántico recupera el fragmento aunque no coincidan las palabras exactas (siempre sujeto al umbral de similitud `>= 0.78`). |
| **Documentos contradictorios** (`H01`–`H02`) | Recupera ambos documentos si comparten los términos clave (`canon`, `plazo`, partes). | Recupera ambos documentos incluso si el otrosí usa redacción distinta (*«prórroga»* vs *«extensión del plazo»*). |
| **Casi-aciertos (`NEAR_MISS`, `H03`–`H06`)** | Puede recuperar el contrato por coincidencia léxica de las partes; depende del LLM real + `guardedLegalAnswer` no inventar el dato ausente. | Puede recuperar fragmentos temáticamente cercanos; requiere que el LLM real indique explícitamente que el dato no consta y que `guardedLegalAnswer` valide cada cita `[n]`. |

## 4. Umbrales de regresión determinista (gate en CI)

Estos umbrales aplican **exclusivamente** a la prueba de regresión determinista (`LegalRagQualityBenchmarkTest`, 12 preguntas) para evitar regresiones en aislamiento, citas y abstención:

| Métrica de infraestructura RAG | Umbral mínimo (CI) | Resultado verificado |
| --- | --- | --- |
| Cobertura de evidencia recuperada en `ANSWERABLE` | `>= 1.00` | `1.00` (6/6) |
| Exactitud de metadatos de cita (`documentId` + `pageNumber`) | `>= 0.95` | `1.00` (6/6) |
| Abstención determinista en `UNANSWERABLE` + `CROSS_CASE` | `>= 1.00` | `1.00` (6/6) |
| Fuga entre expedientes (`CROSS_CASE`) | `== 0.00` | `0.00` (0/3) |

> **Nota de honestidad:** Los valores reales de precisión del modelo LLM en `hard_benchmark_cases.json` dependen del modelo configurado (`Groq` u `Ollama`) y deben medirse manualmente con `scripts/run_legal_benchmark.ps1 -Mode groq|ollama` antes de salir a producción con cada modelo.
