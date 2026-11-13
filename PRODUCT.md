# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Personas expuestas a vigilancia comercial o riesgos digitales (periodistas, defensores de derechos humanos, ciudadanía en general y personal técnico de primera respuesta) que utilizan **OMEGA** en su computadora Windows/macOS (app Electron de escritorio o vista web) para comprobar la integridad de su computadora y teléfonos conectados sin conocimientos avanzados previos, manteniendo detalles técnicos expandibles para analistas.

## Product Purpose

Detectar de forma preventiva y pasiva amenazas de spyware comercial (Pegasus, Predator, Candiru, NoviSpy, Triangulation) sobre el equipo local, dispositivos Android/iOS conectados por USB o copias guardadas, enlaces sospechosos y exposición pública, combinando un **Centro unificado de protección y análisis** en vivo con un **Copiloto investigador CTI con citas verificables**.

## Positioning

A diferencia de aplicaciones de chat genéricas o visores estáticos de indicadores, OMEGA unifica en una aplicación de escritorio nativa:
1. Auditoría real de solo lectura en RAM del equipo Windows/macOS (procesos, persistencia WMI `root\subscription`, sockets TCP salientes, Defender/Firewall/UAC/SmartScreen), sin modificar archivos personales ni persistir artefactos de riesgo.
2. Inspección USB directa (Android ADB con instalador portátil integrado y diagnóstico iOS/iPadOS incluyendo desbloqueo en memoria de respaldos encriptados) cruzada con motor YARA nativo (`yara-python`) y correlación temporal zero-day.
3. Contraste continuo contra feeds STIX 2.1, corpus técnico RAG híbrido (Citizen Lab, Amnesty Tech, Google TAG), verificador pasivo de enlaces con sandbox efímero y monitoreo OSINT con consentimiento explícito.

## Operating Context

- **Ventana principal de escritorio (Electron 1380×860, barra superior nativa con `titleBarStyle: 'hidden'`)** y navegador web servido por Nginx (`localhost:5173`), conectados a la API FastAPI (`localhost:8000/api`) y PostgreSQL.
- **Vista inicial predeterminada:** Centro unificado de protección y análisis en vivo (estado del equipo local, conectividad USB Android/iOS, reglas YARA/STIX 2.1 activas, verificador rápido de enlaces y bitácora volátil de sesión).
- **Navegación espacial minimalista de aplicación (Negro · Blanco · Azul Rey):** Cabina oscura de estudio a pantalla completa (`SecurityPostureStage`, `#04070E` → `#080F1E`) con iluminación lateral en Azul Rey (`#1D4ED8` / `#2563EB`), escultura WebGL 3D interactiva con rotación `< 360° >` y conmutación entre las 4 superficies (`PC Windows`, `Celulares por USB`, `Escudo de enlaces`, `Base forense STIX 2.1`), barra superior segmentada en vidrio oscuro esmerilado (`SpatialNavPill`) con subrayado luminoso en Azul Rey, trío inferior de tarjetas de vidrio (`Equipo Local`, `Celulares USB`, `Escudo Web y STIX2` con verificación pasiva directa) y cajón lateral no destructivo del Copiloto, unificando todo el flujo en una sola atmósfera oscura cómoda a la vista y eliminando por completo divisiones 50/50 de blanco cegador, menús laterales genéricos y metáforas de mapas.
- **Idioma y nivel de detalle:** Español claro y comprensible por defecto en todos los flujos, con conmutador global y bloques técnicos expandibles (CVEs, firmas YARA, rutas WMI, hashes `SHA-256`, sockets) disponibles bajo demanda sin saturar al usuario no técnico.

## Capabilities and Constraints

- **Operación volátil en RAM (RNF4):** Todo análisis de volcados móviles, respaldos iOS encriptados (`Manifest.db` vía `:memory:`), enlaces en sandbox efímero y telemetría de PC se procesa en memoria RAM y se descarta tras emitir el resultado.
- **Consentimiento explícito (RNF8):** Ninguna auditoría OSINT o contramedida de endurecimiento DNS sobre dispositivo móvil se ejecuta sin confirmación explícita del usuario.
- **Cero falsos positivos operativos:** El recolector de PC Windows excluye su propio PID y distingue rutas ejecutables reales de argumentos de log legítimos de fabricantes.
- **Integridad de APIs y contratos existentes:** Se preservan todos los endpoints FastAPI (`/api/health`, `/api/system/governance`, `/api/chat`, `/api/campaigns`, `/api/triage/*`, `/api/link/verify`, `/api/osint/*`, `/api/intel/webloader-scan`) y todos los canales IPC `window.omegaDesktop` de Electron.

## Evidence on Hand

- Reportes CTI y STIX 2.1 reales indexados en PostgreSQL (`reports`, `document_chunks`, `campaigns`, `iocs`).
- Telemetría viva de host recolectada por `omega:pc-audit-collect` + `/api/triage/pc-live`, estado ADB/iOS vía Electron IPC (`omega:check-adb-status`, `omega:ios-check-status`) y estado de gobernanza vía `/api/system/governance`.

## Product Principles

- **Claridad humana primero, rigor forense a un clic:** El usuario no técnico entiende de inmediato si su equipo está seguro y qué hacer; el analista despliega CVEs, YARA, sockets y líneas temporales sin ruido visual.
- **Espacio de trabajo vivo, no páginas desconectadas:** Estado de sensores (PC, USB, CTI/YARA, API) siempre visible en el marco de la aplicación; los análisis activos no se destruyen al consultar al Copiloto desde el cajón lateral o cambiar de herramienta.
- **Instrumento físico digital, no página web SaaS:** Cada superficie transmite solidez operativa, respuesta táctil inmediata, jerarquía clara y cero ruido ornamental.
