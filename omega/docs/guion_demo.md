# Guión de Demostración en Vivo — Proyecto Omega (5 Minutos)

Este guión está estructurado minuto a minuto para presentar la plataforma Omega ante el jurado calificador, cubriendo los objetivos específicos del proyecto de grado.

---

### Minuto 1: Consulta RAG con Trazabilidad Estricta (RF4, RNF1, RNF2)
- **Acción:** Abre la vista **Asistente** (`Preguntar`) en `http://localhost:5173`.
- **Interacción:** Escribe o pulsa el prompt sugerido:
  > *"¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus?"*
- **Discurso al Jurado:**
  > *"El núcleo transaccional en Java 21 / Spring Boot y el corpus técnico recuperan los fragmentos más relevantes mediante búsqueda híbrida en PostgreSQL 16 (similitud coseno `pgvector` HNSW + búsqueda léxica `tsvector` GIN combinadas con Reciprocal Rank Fusion). Cada dato técnico en la respuesta incluye trazabilidad verificable hacia el reporte y número de página; al pulsar la cita se abre el cajón lateral con el fragmento textual exacto del reporte original de Citizen Lab o Google TAG (divulgación progresiva, RNF2). En expedientes privados (`omega_rag`), los embeddings (`1536` dimensiones) se generan conservando el hash SHA-256 sin almacenar PDFs en el VPS (Zero-Retention)."*

---

### Minuto 2: Prueba de Abstención Anti-Alucinación (RNF1)
- **Acción:** En la misma vista de consulta, ingresa una pregunta fuera de corpus:
  > *"¿Qué infraestructura de comando y control utilizó el ransomware LockBit 3.0 en Colombia durante 2025?"*
- **Discurso al Jurado:**
  > *"Uno de los riesgos críticos en CTI es la alucinación de los modelos de lenguaje. En OMEGA implementamos una regla estricta de abstención evaluada cuantitativamente: si la evidencia recuperada no respalda la consulta, el motor se abstiene explícitamente y evita inventar indicadores de compromiso o citas inexistentes."*

---

### Minuto 3: Verificador Forense MVT y Equipos en Memoria (RF5, RNF4)
- **Acción:** Dirígete a la vista **Equipos** (y **Enlaces** en la barra espacial superior).
- **Interacción:** Pega una lista de indicadores de prueba en el verificador MVT / IOC o carga un paquete de Mobile Verification Toolkit:
  ```
  weather4free.com
  tookcheckout.com
  actualite.emergence-mada.com
  google.com
  roleaccountd
  ```
- **Discurso al Jurado:**
  > *"El gateway Java valida JWT y RBAC multi-tenant y enruta la petición hacia el microservicio forense aislado `omega/api/` autenticado con `X-Internal-Service-Token` dentro de la red Docker privada (`omega-private`, sin salida a internet). Los artefactos móviles o de equipo se cruzan contra el catálogo oficial en formato STIX 2.1 estrictamente en memoria RAM volátil (RNF4), sin escribir volcados ni archivos del usuario en disco ni enviarlos a LLMs externos (RNF7)."*

---

### Minuto 4: OSINT Defensivo con Doble Candado Ético (RF8, RNF8)
- **Acción:** Haz clic en la vista **Exposición** (OSINT Propio).
- **Interacción:**
  1. Escribe un dominio (ej. `miorganizacion.org`) dejando la casilla de consentimiento **desmarcada** y muestra que el botón de registro permanece deshabilitado.
  2. Marca la casilla de consentimiento explícito obligatoria y registra el activo.
  3. Pulsa **Auditar exposición**.
- **Discurso al Jurado:**
  > *"Para prevenir abusos, este módulo aplica un doble candado ético (RNF8) validado mediante pruebas automatizadas: PostgreSQL impone el constraint `CHECK (explicit_consent = TRUE)` (`osint_monitored_assets`) y el backend exige autorización explícita antes de consultar la API. La auditoría es 100% pasiva: inspecciona DNS/SPF/DMARC vía DNS-over-HTTPS, logs públicos de Certificate Transparency y correlaciona coincidencias contra campañas conocidas."*

---

### Minuto 5: Cierre y Métricas Cuantitativas (Objetivo 6)
- **Acción:** Proyecta la tabla comparativa y resultados cuantitativos generados por RAGAS (`omega/rag_engine/eval/ablation_report_v1.md` y `omega/rag_engine/eval/eval_report.md`) junto con la matriz de trazabilidad (`omega/docs/matriz_trazabilidad.md`).
- **Discurso al Jurado:**
  > *"Para concluir, evaluamos cuantitativamente la ablación MVP vectorial frente a **Omega V1.0** (RRF híbrido con `to_tsquery` bilingüe y frases CVE exactas) sobre 13 casos (10 de dominio CTI muestreados estratificadamente y 3 preguntas trampa de control), usando `openai/gpt-oss-120b` como generador y `openai/gpt-oss-20b` como juez RAGAS sin truncamiento de fragmentos (10/10 muestras válidas): la precisión de contexto subió de 0.4333 a **0.5575**, `Hit@3` pasó de 50.0% a **70.0%** (`MRR@5` de 0.44 a **0.5333**) y la fidelidad documental (`Faithfulness`) subió a **0.6** (`Answer Relevancy` **0.5131**, cumplimiento de citas inline **20.0% (2/10)** debido a que con `top_k=5` el prompt conservador prefiere abstenerse antes que inferir sin respaldo completo). Alcanzamos **100.0% (3/3)** de abstención correcta fuera de corpus (`RNF1`) y una latencia media neta de **1.394s** (máx. 1.878s, sin esperas de rate limit 429). Todo el sistema corre aislado en contenedores Docker portables."*

