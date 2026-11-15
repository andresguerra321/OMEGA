![OMEGA — Visualización de Marca](../../../img/banner.png)

# Estudio Comparativo de Ablación — MVP vs. Omega V1.0 (Objetivo 6)

- **Corpus evaluado:** 10 casos (7 dominio CTI + 3 abstención RNF1)
- **Modelo generativo (idéntico en ambos):** `openai/gpt-oss-120b` (`temperature=0.0`, `top_k=3`)
- **Juez RAGAS:** `openai/gpt-oss-20b` (`max_tokens=2048`, fragmentos completos sin truncar)
- **Embeddings de recuperación:** `paraphrase-multilingual-mpnet-base-v2` (768d) sobre `public.document_chunks`

## Nota Metodológica (Corrección del Arnés y Recuperación)

La versión inicial del estudio presentó `Faithfulness = 0.0` y falsas abstenciones por defectos combinados de arnés y recuperación, ya aislados y corregidos:
1. **Reconstrucción completa de página (`(report_id, page_number)`):** Cada página PDF se divide en 2–5 chunks solapados; recuperar sub-chunks aislados privaba al generador de evidencia contigua presente en la misma página y provocaba abstenciones innecesarias.
2. **Componentización léxica compatible con `pg_catalog.simple` (`to_tsquery`):** Los identificadores con guiones (`CVE-YYYY-NNNN` y fechas `YYYY-MM-DD`) son tokenizados por PostgreSQL con prefijo negativo (`-2021`, `-1048`); se añadieron disyunciones firmadas exactas además de expansión técnica bilingüe español→inglés.
3. **Normalización de citas Unicode y sin truncamiento al juez:** Se convirtieron corchetes fullwidth (`【1】 -> [1]`) en post-procesamiento, se pasó el 100% de los fragmentos reconstruidos a RAGAS sin recortar (`[:500]`) y se evaluó secuencialmente por métrica para respetar cuotas OTPM/TPM.
4. **Medición limpia de latencia:** La latencia neta separa los `time.sleep` de backoff por cuota gratuita (8,000 TPM en Groq) del tiempo real de recuperación e inferencia.

## Resultados Comparativos

| Métrica / Dimensión | Baseline MVP (Vectorial) | Omega V1.0 (Híbrido RRF) | Variación (Δ) | Requerimiento |
| :--- | :---: | :---: | :---: | :--- |
| **RAGAS Faithfulness** (0–1) | 0.2036 (7/7) | **0.6** (5/7) | +0.3964 | Objetivo 3, RNF1 |
| **RAGAS Answer Relevancy** (0–1) | 0.2356 (7/7) | **0.6082** (7/7) | +0.3726 | Objetivo 6, RF4 |
| **RAGAS Context Precision** (0–1) | 0.2143 (7/7) | **0.7** (5/7) | +0.4857 | Objetivo 2, RF3 |
| **Recuperación Hit@3 / Hit@5** | 28.6% / 28.6% | **85.7% / 85.7%** | +57.1% (Hit@5) | Objetivo 2, RF3 |
| **MRR@5 (Ranking de Fuente Exacta)** | 0.2143 | **0.7857** | +0.5714 | Objetivo 2, RF3 |
| **Cumplimiento de Citas Inline** | 28.6% (2/7) | **85.7%** (6/7) | +57.1% | RNF1 |
| **Tasa de Abstención (Anti-Alucinación)** | 100.0% (3/3) | **100.0%** (3/3) | +0.0% | RNF1 |
| **Latencia Media Neta** (sin backoff 429) | 1.188s | **1.22s** | +0.032s | RNF3 |
