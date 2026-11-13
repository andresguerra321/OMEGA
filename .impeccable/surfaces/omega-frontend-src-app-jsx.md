---
version: 1
slug: "omega-frontend-src-app-jsx"
primary_target: "omega/frontend/src/App.jsx"
related_targets: []
---

# Surface Brief — OMEGA Desktop Shell & Protection Center

- **Scope:** `omega/frontend/src/App.jsx` y shell principal (`DockBar.jsx`, `CommandCenterPanel.jsx`, `CopilotDrawer.jsx`, `index.css`)
- **Mode:** `operate`

## Direction contract

THESIS: Sustituir el esquema genérico de barra lateral izquierda de página web por una estación de seguridad táctil e industrial de escritorio centrada en un Dock flotante inferior, una cabecera de ventana nativa con sensores reales y un centro unificado de protección en vivo que explica los hallazgos en lenguaje claro por defecto y mantiene el detalle forense expandible sin destruir el análisis abierto al consultar al Copiloto.

OWN-WORLD: Chasis grafito anodizado profundo (`#090A0D` / `#121419`) con matriz micro-punteada tenue (`20px`), cavidades empotradas (`#07080B`) con bisel superior 1px y teclas táctiles moldeadas; azul cobalto (`#2F6FED`) para acción primaria y foco de módulo, más LEDs semánticos estrictos (`#30D158` limpio, `#FF9F0A` preventivo, `#FF453A` crítico) sobre texto marfil de alto contraste (`#F4F4F6`).

STORY: Al abrir la aplicación, cualquier persona confirma en segundos si el entorno OMEGA, su PC y sus sensores USB/CTI están listos, puede lanzar una auditoría local en 1 clic, pegar un enlace sospechoso o conectar un celular sin jerga opaca, y si detecta una anomalía puede abrir el cajón lateral del Copiloto sin perder el reporte de fondo ni navegar fuera.

FIRST VIEWPORT: Cabecera de ventana de 48px integrada con los controles nativos (marca OMEGA, módulo activo, pastillas vivas de PC/USB/YARA+CTI, selector Simple/Técnico, botón Copiloto y `⌘K`); zona principal asimétrica con consola superior de postura del sistema + dial vectorial de estado y botón táctil `Analizar esta PC ahora`, seguida de una matriz de sensores interactiva a la izquierda (7 cols) y bitácora volátil + atajos del Copiloto a la derecha (5 cols); dock flotante inferior centrado con los módulos de trabajo.

FORM: Estación táctil de escritorio estilo instrumentación de precisión (Teenage Engineering / Nothing OS) adaptada al marco Electron nativo (cabecera + centro vivo asimétrico + cajón deslizable de Copiloto + dock inferior flotante).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
