# Declaración de Alcance Técnico y Salvaguardas Éticas — Proyecto Omega

## 1. Naturaleza Exclusivamente Defensiva (RNF7)
Omega es una plataforma de correlación y consulta de inteligencia de amenazas (Cyber Threat Intelligence) diseñada bajo principios de defensa pasiva. El sistema **no** incorpora capacidades ofensivas, motores de análisis dinámico de malware, ingeniería inversa de binarios, generación de cargas útiles (payloads) ni mecanismos de inspección remota sobre dispositivos de terceros.

## 2. Procedencia Pública y Verificable del Corpus (RF1, RF7)
La totalidad del conocimiento indexado en la base vectorial y relacional de Omega proviene de investigaciones técnicas divulgadas públicamente por organizaciones reconocidas en defensa digital y seguridad de la información (Citizen Lab, Amnesty Tech y Google Threat Analysis Group), así como indicadores públicos en formato estándar STIX 2.x. Cada registro conserva su URL de origen, hash criptográfico SHA-256 y marca temporal de ingesta para auditoría académica.

## 3. Tratamiento Volátil de Evidencia Forense del Usuario (RNF4)
En el módulo de verificación de Indicadores de Compromiso (compatible con Mobile Verification Toolkit — MVT), los archivos cargados por el analista o usuario son procesados exclusivamente en memoria volátil (RAM) durante el ciclo de vida de la petición HTTP. Omega no almacena en disco, registros de servidor ni base de datos el contenido de los dumps forenses analizados, mitigando riesgos de exposición secundaria de información sensible.

## 4. Gobernanza y Consentimiento en OSINT Pasivo (RF8, RNF8)
El módulo de monitoreo de exposición opera exclusivamente mediante consultas pasivas sobre fuentes públicas legítimas (logs públicos de Certificate Transparency y registros DNS públicos SPF/DMARC) y está restringido arquitectónicamente a activos propios. La base de datos impone una restricción de integridad (`CHECK explicit_consent = TRUE`) que impide registrar o consultar dominios, correos institucionales u organizaciones sin la confirmación explícita de titularidad o autorización por parte del usuario.

