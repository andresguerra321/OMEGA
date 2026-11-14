# Declaración de Alcance Técnico y Salvaguardas Éticas — Proyecto Omega

## 1. Naturaleza Exclusivamente Defensiva (RNF7)
Omega es una plataforma de correlación y consulta de inteligencia de amenazas (Cyber Threat Intelligence) diseñada bajo principios de defensa pasiva. El sistema **no** incorpora capacidades ofensivas, motores de análisis dinámico de malware, ingeniería inversa de binarios, generación de cargas útiles (payloads) ni mecanismos de inspección remota sobre dispositivos de terceros.

## 2. Procedencia Pública y Verificable del Corpus (RF1, RF7)
La totalidad del conocimiento indexado en la base vectorial y relacional de Omega proviene de investigaciones técnicas divulgadas públicamente por organizaciones reconocidas en defensa digital y seguridad de la información (Citizen Lab, Amnesty Tech y Google Threat Analysis Group), así como indicadores públicos en formato estándar STIX 2.x. Cada registro conserva su URL de origen, hash criptográfico SHA-256 y marca temporal de ingesta para auditoría académica.

## 3. Tratamiento Volátil de Evidencia Forense del Usuario (RNF4)
En el módulo de verificación de Indicadores de Compromiso (compatible con Mobile Verification Toolkit — MVT), los artefactos forenses, volcados USB/ADB y copias de seguridad de iOS enviados por el analista se procesan exclusivamente en memoria volátil (RAM) dentro del microservicio aislado `forensic-worker` (`omega/api/`, red Docker `omega-private` con `internal: true` sin acceso a Internet y autenticado por `X-Internal-Service-Token`). Ningún archivo PDF subido ni artefacto forense se retiene permanentemente en disco del VPS (`tmpfs` efímero `/tmp/omega_ingest` en `backend-java` con borrado en `finally` y `:memory:` en descifrado iOS).

## 4. Aislamiento Estricto de Proveedores Externos de Embeddings e Inferencia (`OPENAI_API_KEY`)
El adaptador externo opcional para vectorización y generación RAG (`OpenAiEmbeddingProvider` / `OpenAiRagAnswerGenerator`, desacoplado tras la interfaz `EmbeddingProvider` para sustitución por modelos locales en Fase 2) procesa **exclusivamente fragmentos de texto público CTI o documentos indexados en expedientes RAG**. Bajo ninguna circunstancia los volcados forenses MVT, respaldos cifrados iOS, artefactos binarios analizados con YARA, capturas de procesos de host ni los activos OSINT monitoreados se transmiten a `OPENAI_API_KEY` ni a APIs externas de inferencia; dicho aislamiento es garantizado tanto por flujo de código como a nivel de infraestructura por la red interna sin salida exterior `omega-private`.

## 5. Gobernanza y Consentimiento en OSINT Pasivo (RF8, RNF8)
El módulo de monitoreo de exposición opera exclusivamente mediante consultas pasivas sobre fuentes públicas legítimas (logs públicos de Certificate Transparency y registros DNS públicos SPF/DMARC) y está restringido arquitectónicamente a activos propios. La base de datos impone una restricción de integridad (`CHECK (explicit_consent = TRUE)` en `omega/db/init.sql`) verificada mediante pruebas de integración automatizadas (`SecurityHardeningIntegrationTest`), impidiendo registrar dominios, correos institucionales u organizaciones sin confirmación explícita de titularidad o autorización por parte del usuario.

