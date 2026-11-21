# Benchmark de Calidad del Asistente LEGAL (Q7)

> **Naturaleza del corpus:** 100% sintético y ficticio (`omega/backend-java/src/test/resources/legal_benchmark/synthetic_cases.json`). No contiene documentos ni datos personales de clientes reales.

## 1. Metodología

- **Corpus sintético:** 3 expedientes ficticios (`EXP_ARRENDAMIENTO`, `EXP_SUMINISTRO`, `EXP_LABORAL`) con documentos PDF multipágina generados en memoria e indexados en PostgreSQL (`pgvector`) mediante el flujo real de `DocumentIngestionService` + `AsyncDocumentProcessor`.
- **Conjunto de evaluación (12 preguntas):**
  - `6` preguntas con respuesta explícita en una página concreta (`ANSWERABLE`).
  - `3` preguntas sin respuesta en el expediente (`UNANSWERABLE`).
  - `3` preguntas que mezclan expedientes — consultan al Expediente A hechos que solo existen en el Expediente B (`CROSS_CASE`).
- **Ejecución reproducible:**
  ```powershell
  .\scripts\run_legal_benchmark.ps1
  # o directamente:
  cd omega/backend-java && mvn -B test -Dtest=LegalRagQualityBenchmarkTest
  ```

## 2. Umbrales mínimos (gate de regresión en CI)

| Métrica | Umbral fijado | Resultado medido (modo léxico determinista) |
| --- | --- | --- |
| Fidelidad a las fuentes (`sourceFidelityRate`) | `>= 1.00` (100%) | **1.00** (6/6) |
| Exactitud de cita documento + página (`citationExactnessRate`) | `>= 0.95` (95%) | **1.00** (6/6) |
| Tasa de abstención correcta (`correctAbstentionRate`) | `>= 1.00` (100%) | **1.00** (6/6) |
| Tasa de respuestas sin sustento (`unsupportedAnswerRate`) | `== 0.00` (0%) | **0.00** (0/12) |
| Fuga entre expedientes (`crossCaseLeakageRate`) | `== 0.00` (0%) | **0.00** (0/3) |

Si una modificación futura hace caer cualquiera de estas métricas por debajo del umbral, `LegalRagQualityBenchmarkTest` falla automáticamente la compilación de Maven (`mvn -B test`).

## 3. Limitaciones honestas

1. **Modo determinista offline:** El benchmark ejecuta recuperación real en PostgreSQL (`tsvector` / `HybridRagSearchRepository`) y validación real de `guardedLegalAnswer` + `LEGAL_ABSTENTION`, pero utiliza un generador determinista sin llamadas de red externas para evitar flakiness o fuga de datos en CI.
2. **No mide razonamiento jurídico complejo:** Evalúa precisión de recuperación, exactitud de citas y abstención sobre hechos escritos explícitamente; no evalúa interpretación jurisprudencial ni estrategia procesal (fuera de alcance: OMEGA no ofrece asesoría legal).
3. **Evaluación con LLM real:** Al conectar un modelo externo (Groq / OpenAI / Ollama), la redacción final depende del modelo elegido, si bien `guardedLegalAnswer()` sigue descartando automáticamente cualquier línea factual que carezca de cita `[n]` válida.
