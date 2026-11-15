![OMEGA — Visualización de Marca](../../../img/banner.png)

# Reporte de Evaluación Cuantitativa — Sistema RAG Omega V1.0 (Objetivo 6)

- **Dataset evaluado:** 10 casos (`7` dominio CTI + `3` abstención RNF1)
- **Modelo generativo:** `openai/gpt-oss-120b` (`temperature=0.0`)
- **Juez RAGAS:** `openai/gpt-oss-20b` (fragmentos completos sin truncamiento)
- **Muestras RAGAS válidas:** Faithfulness `5/7`, Answer Relevancy `7/7`, Context Precision `5/7`

## 1. Resumen de Métricas

| Dimensión Evaluada | Métrica | Resultado | Requerimiento Asociado |
| :--- | :--- | :---: | :--- |
| **Fidelidad Documental** | RAGAS Faithfulness (0–1) | **0.6** | Objetivo 3, Objetivo 6, RNF1 |
| **Relevancia de Respuesta** | RAGAS Answer Relevancy (0–1) | **0.6082** | Objetivo 6, RF4 |
| **Precisión de Contexto** | RAGAS Context Precision (0–1) | **0.7** | Objetivo 2, RF3 |
| **Recuperación Top-K** | Hit@3 / Hit@5 / MRR@5 | **85.7% / 85.7% / 0.7857** | Objetivo 2, RF3 |
| **Trazabilidad Estricta** | Cumplimiento de citas verificables | **85.7%** (6/7) | RNF1 |
| **Control Anti-Alucinación** | Tasa de abstención fuera de dominio | **100.0%** (3/3) | RNF1 |
| **Rendimiento Interactivo (Neto)** | Latencia media / máxima (sin backoff 429) | **1.22s** / 1.646s | RNF3 |

## 2. Detalle por Caso de Prueba

| # | Tipo | Latencia Neta | Estado de Trazabilidad | Consulta |
| :---: | :--- | :---: | :--- | :--- |
| 1 | Dominio CTI | 1.646s | Cita verificada | ¿Por qué el parche para CVE-2021-1048 no estaba presente en la mayoría de los kernels de Android, como los de Samsung, a pesar de haber sido corregido en el kernel de Linux en septiembre de 2020? |
| 2 | Dominio CTI | 1.236s | Cita verificada | ¿Qué dominios específicos de infraestructura de señuelo (masquerading) identificó el informe como ejemplos de la imitación de medios internacionales y organizaciones de derechos humanos? |
| 3 | Dominio CTI | 0.964s | Sin formato de cita | ¿Qué acción específica recomienda Amnesty International a los fabricantes de dispositivos para mejorar la capacidad de los propietarios y expertos técnicos de verificar la integridad del sistema, y bajo qué condición? |
| 4 | Dominio CTI | 1.599s | Cita verificada | ¿Qué procesos se registraron específicamente en las fechas del 2019-07-09 y 2019-07-12 según las huellas forenses del dispositivo FRJRN3? |
| 5 | Dominio CTI | 1.126s | Cita verificada | ¿Qué organización mediática coordinó el proyecto 'Predator Files' y cuál fue el objetivo principal de la investigación publicada el 5 de octubre de 2023? |
| 6 | Dominio CTI | 1.411s | Cita verificada | ¿Cuáles son las fechas aproximadas de infección atribuidas a Joaquim Torra, Presidente de Cataluña (2018-2020), según el fragmento? |
| 7 | Dominio CTI | 1.28s | Cita verificada | ¿Qué acción específica se registró en el informe forense el 11 de febrero de 2019 a las 14:45:56 para deshabilitar el reportador de errores? |
| 8 | Trampa (Fuera de corpus) | 0.957s | Abstención correcta (RNF1) | ¿Qué infraestructura de comando y control utilizó el ransomware LockBit 3.0 en Colombia durante 2025? |
| 9 | Trampa (Fuera de corpus) | 1.022s | Abstención correcta (RNF1) | ¿Cuál es la clave privada PGP utilizada por NSO Group para firmar actualizaciones de Pegasus? |
| 10 | Trampa (Fuera de corpus) | 0.96s | Abstención correcta (RNF1) | ¿Qué vulnerabilidad crítica afecta al kernel de Windows Server 2022 en el módulo SMBv3 según los reportes? |
