# Estudio Comparativo de Ablación — MVP vs. Omega V1.0 (Objetivo 6)

- **Corpus evaluado:** 13 casos (10 dominio CTI + 3 abstención RNF1)
- **Modelo generativo (idéntico en ambos):** `openai/gpt-oss-120b` (`temperature=0.0`, `top_k=5`)
- **Juez RAGAS:** `openai/gpt-oss-20b` (`max_tokens=2048`, fragmentos completos sin truncar)
- **Embeddings de recuperación:** `paraphrase-multilingual-mpnet-base-v2` (768d) sobre `public.document_chunks`

## Nota Metodológica (Corrección del Arnés de Evaluación)

La versión inicial del estudio presentó `Faithfulness = 0.0`, `Context Precision = 0.0` y latencia inflada debido a cuatro defectos aislados y corregidos:
1. **Amputación de contexto:** El arnés truncaba `snippet[:500]` y descartaba citas `#4–#6` (`[:3]`), ocultando a RAGAS la evidencia usada por el generador.
2. **Componente léxico roto (`websearch_to_tsquery`):** Al exigir intersección `AND` de preguntas en español contra PDFs en inglés producía **0/5** coincidencias léxicas; se reemplazó por `to_tsquery` con disyunción bilingüe `OR` + frase exacta `(cve <-> YYYY <-> NNNN)`.
3. **Submuestreo y truncamiento del juez:** Se eliminó el recorte `samples[:4]` y se calibró `max_tokens` según cuota OTPM del juez para evitar truncamientos JSON o errores `429`.
4. **Medición limpia de latencia:** La latencia neta separa los `time.sleep` de backoff por cuota gratuita (8,000 TPM en Groq) del tiempo real de recuperación e inferencia.

## Resultados Comparativos

| Métrica / Dimensión | Baseline MVP (Vectorial) | Omega V1.0 (Híbrido RRF) | Variación (Δ) | Requerimiento |
| :--- | :---: | :---: | :---: | :--- |
| **RAGAS Faithfulness** (0–1) | 0.5375 (10/10) | **0.6** (10/10) | +0.0625 | Objetivo 3, RNF1 |
| **RAGAS Answer Relevancy** (0–1) | 0.6095 (10/10) | **0.5131** (10/10) | -0.0964 | Objetivo 6, RF4 |
| **RAGAS Context Precision** (0–1) | 0.4333 (10/10) | **0.5575** (10/10) | +0.1242 | Objetivo 2, RF3 |
| **Recuperación Hit@3 / Hit@5** | 50.0% / 70.0% | **70.0% / 70.0%** | +0.0% (Hit@5) | Objetivo 2, RF3 |
| **MRR@5 (Ranking de Fuente Exacta)** | 0.44 | **0.5333** | +0.0933 | Objetivo 2, RF3 |
| **Cumplimiento de Citas Inline** | 30.0% (3/10) | **20.0%** (2/10) | -10.0% | RNF1 |
| **Tasa de Abstención (Anti-Alucinación)** | 100.0% (3/3) | **100.0%** (3/3) | +0.0% | RNF1 |
| **Latencia Media Neta** (sin backoff 429) | 1.466s | **1.394s** | -0.072s | RNF3 |
