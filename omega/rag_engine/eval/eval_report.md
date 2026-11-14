# Reporte de Evaluación Cuantitativa — Sistema RAG Omega V1.0 (Objetivo 6)

- **Dataset evaluado:** 13 casos (`10` dominio CTI + `3` abstención RNF1)
- **Modelo generativo:** `openai/gpt-oss-120b` (`temperature=0.0`)
- **Juez RAGAS:** `openai/gpt-oss-20b` (fragmentos completos sin truncamiento)
- **Muestras RAGAS válidas:** Faithfulness `10/10`, Answer Relevancy `10/10`, Context Precision `10/10`

## 1. Resumen de Métricas

| Dimensión Evaluada | Métrica | Resultado | Requerimiento Asociado |
| :--- | :--- | :---: | :--- |
| **Fidelidad Documental** | RAGAS Faithfulness (0–1) | **0.6** | Objetivo 3, Objetivo 6, RNF1 |
| **Relevancia de Respuesta** | RAGAS Answer Relevancy (0–1) | **0.5131** | Objetivo 6, RF4 |
| **Precisión de Contexto** | RAGAS Context Precision (0–1) | **0.5575** | Objetivo 2, RF3 |
| **Recuperación Top-K** | Hit@3 / Hit@5 / MRR@5 | **70.0% / 70.0% / 0.5333** | Objetivo 2, RF3 |
| **Trazabilidad Estricta** | Cumplimiento de citas verificables | **20.0%** (2/10) | RNF1 |
| **Control Anti-Alucinación** | Tasa de abstención fuera de dominio | **100.0%** (3/3) | RNF1 |
| **Rendimiento Interactivo (Neto)** | Latencia media / máxima (sin backoff 429) | **1.394s** / 1.878s | RNF3 |

## 2. Detalle por Caso de Prueba

| # | Tipo | Latencia Neta | Estado de Trazabilidad | Consulta |
| :---: | :--- | :---: | :--- | :--- |
| 1 | Dominio CTI | 1.668s | Sin formato de cita | ¿Por qué el parche para CVE-2021-1048 no estaba presente en la mayoría de los kernels de Android, como los de Samsung, a pesar de haber sido corregido en el kernel de Linux en septiembre de 2020? |
| 2 | Dominio CTI | 1.498s | Sin formato de cita | ¿Qué dominios específicos de infraestructura de señuelo (masquerading) identificó el informe como ejemplos de la imitación de medios internacionales y organizaciones de derechos humanos? |
| 3 | Dominio CTI | 1.041s | Sin formato de cita | ¿Qué dirección de correo electrónico específica se identificó en la búsqueda de iMessage registrada el 2019-07-15 a las 12:02:37 en el dispositivo de Szabolcs Panyi? |
| 4 | Dominio CTI | 1.343s | Sin formato de cita | ¿Cuáles son las dos vulnerabilidades específicas recuperadas de la cadena de exploits FORCEDENTRY y qué función cumplía cada una según el fragmento? |
| 5 | Dominio CTI | 1.556s | Sin formato de cita | ¿Qué procesos se registraron específicamente en las fechas del 2019-07-09 y 2019-07-12 según las huellas forenses del dispositivo FRJRN3? |
| 6 | Dominio CTI | 1.369s | Sin formato de cita | ¿Qué disfraz o pretexto específico utilizó el segundo intento de infección con Pegasus contra la profesora Elisenda Paluzie el 10 de junio de 2020? |
| 7 | Dominio CTI | 1.444s | Cita verificada | Según el fragmento, qué metadatos específicos de la red siguen siendo visibles para un observador que registra el tráfico a través de sistemas de vigilancia desplegados en un operador móvil, incluso cuando la carga de un video en Instagram está cifrada con HTTPS? |
| 8 | Dominio CTI | 1.369s | Cita verificada | ¿Cuáles son las fechas aproximadas de infección atribuidas a Joaquim Torra, Presidente de Cataluña (2018-2020), según el fragmento? |
| 9 | Dominio CTI | 1.878s | Sin formato de cita | ¿Qué mitigación introducida por Apple en iOS 14 se sospecha que impide la explotación de la vulnerabilidad KISMET a través de iMessage, y qué herramienta desarrolló NSO Group para sortearla? |
| 10 | Dominio CTI | 1.767s | Sin formato de cita | ¿Qué protocolo de votación digital segura y resistente a la censura fundaron conjuntamente Pau Escrich y Xavier Vives, y qué organización lo utilizó durante sus elecciones internas? |
| 11 | Trampa (Fuera de corpus) | 1.009s | Abstención correcta (RNF1) | ¿Qué infraestructura de comando y control utilizó el ransomware LockBit 3.0 en Colombia durante 2025? |
| 12 | Trampa (Fuera de corpus) | 1.078s | Abstención correcta (RNF1) | ¿Cuál es la clave privada PGP utilizada por NSO Group para firmar actualizaciones de Pegasus? |
| 13 | Trampa (Fuera de corpus) | 1.106s | Abstención correcta (RNF1) | ¿Qué vulnerabilidad crítica afecta al kernel de Windows Server 2022 en el módulo SMBv3 según los reportes? |
