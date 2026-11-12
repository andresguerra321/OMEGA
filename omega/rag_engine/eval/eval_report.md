# Reporte de Evaluación Cuantitativa — Sistema RAG Omega (Objetivo 6)

## 1. Resumen de Métricas

| Dimensión Evaluada | Métrica | Resultado | Requerimiento Asociado |
| :--- | :--- | :---: | :--- |
| **Fidelidad Documental** | RAGAS Faithfulness (0–1) | **0.7419** | Objetivo 3, Objetivo 6, RNF1 |
| **Relevancia de Respuesta** | RAGAS Answer Relevancy (0–1) | **0.8258** | Objetivo 6, RF4 |
| **Trazabilidad Estricta** | Cumplimiento de citas `[Reporte, Pág. X]` | **80.0%** (8/10) | RNF1 |
| **Control Anti-Alucinación** | Tasa de abstención fuera de dominio | **100.0%** (3/3) | RNF1 |
| **Rendimiento Interactivo** | Latencia media / máxima | **4.105s** / 15.696s | RNF3 |

## 2. Detalle por Caso de Prueba

| # | Tipo | Latencia | Estado de Trazabilidad | Consulta |
| :---: | :--- | :---: | :--- | :--- |
| 1 | Dominio CTI | 1.721s | Sin formato de cita | ¿Cuántos exploits 0‑day descubrió TAG entre 2019 y 2023 y cuántos de esos fueron desarrollados por CSVs? |
| 2 | Dominio CTI | 4.604s | Cita verificada | ¿Qué procesos aparecen en el fragmento y en qué momentos fueron registrados? |
| 3 | Dominio CTI | 1.372s | Cita verificada | ¿Qué base de datos de Safari se utilizó para identificar visitas a dominios de infección de NSO Group que no aparecían en el historial? |
| 4 | Dominio CTI | 2.433s | Cita verificada | Según el fragmento, ¿qué consecuencias genera el escrutinio público sobre las actividades de los CSV? |
| 5 | Dominio CTI | 1.577s | Cita verificada | ¿Cuál es la fecha y hora del SMS que contiene la frase "Hace 3 dias que no aparece mi hija" enviado desde el número +525585401299? |
| 6 | Dominio CTI | 1.967s | Cita verificada | Según el fragmento, ¿qué medidas específicas se propone que tome el gobierno de EE. UU. para limitar la actividad de los proveedores de spyware? |
| 7 | Dominio CTI | 3.669s | Cita verificada | ¿Cuáles fueron los nombres, fechas de primera y última aparición, volúmenes de tráfico WWAN (IN/OUT) y los IDs de proceso de los procesos sospechosos detectados en el teléfono de Maati Monjib según el fragmento? |
| 8 | Dominio CTI | 7.563s | Cita verificada | ¿Cuál es la URL del archivo WebKit IndexedDB registrado en el evento del 11 de febrero de 2019 a las 14:45:45? |
| 9 | Dominio CTI | 15.696s | Sin formato de cita | ¿En qué fecha y hora (UTC) se registró por última vez la actividad de red de la aplicación Fotos de iOS según el fragmento? |
| 10 | Dominio CTI | 1.545s | Cita verificada | ¿Qué proceso sospechoso se encontró registrado en las bases de datos de uso de red (DataUsage.sqlite y netusage.sqlite) de los dispositivos analizados? |
| 11 | Trampa (Fuera de corpus) | 1.936s | Abstención correcta (RNF1) | ¿Qué infraestructura de comando y control utilizó el ransomware LockBit 3.0 en Colombia durante 2025? |
| 12 | Trampa (Fuera de corpus) | 4.281s | Abstención correcta (RNF1) | ¿Cuál es la clave privada PGP utilizada por NSO Group para firmar actualizaciones de Pegasus? |
| 13 | Trampa (Fuera de corpus) | 4.999s | Abstención correcta (RNF1) | ¿Qué vulnerabilidad crítica afecta al kernel de Windows Server 2022 en el módulo SMBv3 según los reportes? |