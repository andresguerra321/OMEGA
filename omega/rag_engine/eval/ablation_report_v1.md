# Estudio Comparativo de Ablación — MVP vs. Omega V1.0 (Objetivo 6)

- **Corpus evaluado:** 8 casos de prueba (dominio CTI + pruebas de abstención RNF1)
- **Modelo generativo:** `openai/gpt-oss-120b` (`temperature=0.0`)
- **Embeddings:** `paraphrase-multilingual-mpnet-base-v2` (768d)

## Resultados Comparativos

| Métrica / Dimensión | Baseline MVP (Vectorial) | Omega V1.0 (Híbrido RRF) | Variación (Δ) | Requerimiento |
| :--- | :---: | :---: | :---: | :--- |
| **RAGAS Faithfulness** (0–1) | 0.0 | **0.0** | +0.0 | Objetivo 3, RNF1 |
| **RAGAS Answer Relevancy** (0–1) | 0.4663 | **0.3719** | -0.0944 | Objetivo 6, RF4 |
| **RAGAS Context Precision** (0–1) | 0.125 | **0.0** | -0.125 | Objetivo 2, RF3 |
| **Cumplimiento de Citas Inline** | 40.0% | **60.0%** | +20.0% | RNF1 |
| **Tasa de Abstención (Anti-Alucinación)** | 100.0% | **100.0%** | +0.0% | RNF1 |
| **Latencia Media Interacción** | 5.525s | **14.522s** | +8.997s | RNF3 |