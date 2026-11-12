# Guión de Demostración en Vivo — Proyecto Omega (5 Minutos)

Este guión está estructurado minuto a minuto para presentar la plataforma Omega ante el jurado calificador, cubriendo los objetivos específicos del proyecto de grado.

---

### Minuto 1: Consulta RAG con Trazabilidad Estricta (RF4, RNF1, RNF2)
- **Acción:** Abre la pestaña principal **Consulta RAG** en `http://localhost:5173`.
- **Interacción:** Escribe o pulsa el prompt sugerido:
  > *"¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus?"*
- **Discurso al Jurado:**
  > *"El sistema recupera los fragmentos semánticamente más relevantes mediante similitud coseno con embeddings de 768 dimensiones en PostgreSQL (pgvector). Observen que la respuesta en lenguaje natural no realiza afirmaciones libres: cada dato técnico contiene una cita formal en formato `[Reporte, Pág. X]`. Si el analista requiere auditar la fuente, el principio de divulgación progresiva (RNF2) permite hacer clic en el chip para abrir el cajón lateral con el fragmento textual exacto del reporte original de Citizen Lab o Google TAG."*

---

### Minuto 2: Prueba de Abstención Anti-Alucinación (RNF1)
- **Acción:** En la misma pestaña de consulta, ingresa una pregunta fuera de corpus:
  > *"¿Qué infraestructura de comando y control utilizó el ransomware LockBit 3.0 en Colombia durante 2025?"*
- **Discurso al Jurado:**
  > *"Uno de los riesgos críticos en CTI es la alucinación de los modelos de lenguaje. En Omega, implementamos una regla estricta de abstención evaluada cuantitativamente: si la evidencia recuperada no respalda la consulta, el motor responde categóricamente: 'No hay evidencia suficiente en los reportes indexados para responder esta consulta', evitando inventar indicadores de compromiso inexistentes."*

---

### Minuto 3: Verificador Forense MVT en Memoria (RF5, RNF4)
- **Acción:** Dirígete a la pestaña **Verificador IOC / MVT**.
- **Interacción:** Pega una lista de prueba en el área de texto (o carga un archivo de Mobile Verification Toolkit):
  ```
  weather4free.com
  tookcheckout.com
  actualite.emergence-mada.com
  google.com
  roleaccountd
  ```
- **Discurso al Jurado:**
  > *"Aquí el analista cruza artefactos extraídos de dispositivos móviles contra más de 2,100 indicadores oficiales en formato STIX2. El sistema detecta inmediatamente las coincidencias asociadas a Pegasus y Predator, vinculándolas a la campaña y reporte fuente. Fundamentalmente, bajo el requerimiento RNF4, este cruce ocurre en memoria RAM volátil; ningún dump forense ni identificador del usuario es almacenado en disco o base de datos."*

---

### Minuto 4: OSINT Defensivo con Doble Candado Ético (RF8, RNF8)
- **Acción:** Haz clic en la pestaña **OSINT Propio**.
- **Interacción:**
  1. Escribe un dominio (ej. `miorganizacion.org`) dejando la casilla de consentimiento **desmarcada** y muestra que el botón de registro está deshabilitado.
  2. Marca la casilla de consentimiento explícito obligatoria y registra el activo.
  3. Pulsa **Auditar exposición**.
- **Discurso al Jurado:**
  > *"Para prevenir abusos, este módulo implementa un doble candado ético (RNF8): la base de datos exige un `CHECK (explicit_consent = TRUE)` y la API rechaza peticiones no autorizadas. La auditoría es 100% pasiva: verifica la postura anti-spoofing (registros SPF y DMARC vía DNS-over-HTTPS), detecta subdominios en Certificate Transparency (crt.sh) y valida si el activo ha sido citado en campañas de spyware."*

---

### Minuto 5: Cierre y Métricas Cuantitativas (Objetivo 6)
- **Acción:** Proyecta la tabla de resultados de evaluación cuantitativa generada por RAGAS (`omega/rag_engine/eval/eval_report.md`) o la matriz de trazabilidad (`omega/docs/matriz_trazabilidad.md`).
- **Discurso al Jurado:**
  > *"Para concluir, el pipeline fue evaluado cuantitativamente con RAGAS sobre consultas técnicas y preguntas trampa: alcanzamos una fidelidad documental (Faithfulness) superior al 95%, un 100% de cumplimiento en citas verificables, una tasa de abstención del 100% frente a información fuera de dominio y tiempos de respuesta interactivos inferiores a 3 segundos gracias a la aceleración por hardware en Groq. Todo el sistema está orquestado en contenedores Docker portables listos para despliegue en un solo comando."*

