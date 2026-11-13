---
version: 2
slug: "omega-frontend-src-app-jsx"
primary_target: "omega/frontend/src/App.jsx"
related_targets:
  - "omega/frontend/src/components/SpatialNavPill.jsx"
  - "omega/frontend/src/components/SecurityPostureStage.jsx"
  - "omega/frontend/src/components/SecurityCenterpiece3D.jsx"
---

# Surface Brief — OMEGA Desktop Unified Dark Studio Cockpit

- **Scope:** `omega/frontend/src/App.jsx`, `SpatialNavPill.jsx`, `SecurityPostureStage.jsx`, `SecurityCenterpiece3D.jsx`, `CopilotDrawer.jsx`, `electron/main.js`, `electron/preload.cjs`, `index.css`
- **Mode:** `operate`

## Direction contract

THESIS: Reemplazar la división 50/50 claro/oscuro (`OverviewWarmInspector.jsx` eliminado) por una cabina espacial unificada de estudio oscuro en paleta estricta Negro (`#04070E` / `#080F1E`) · Blanco (`#F8FAFC` / `#FFFFFF`) · Azul Rey (`#1D4ED8` / `#2563EB` / `#3B82F6`), con barra segmentada superior en vidrio esmerilado (`SpatialNavPill`), sujeto central 3D interactivo en Three.js (`SecurityCenterpiece3D`) con plataforma giratoria `< 360° >`, y trío inferior de paneles de vidrio oscuro calmo y cómodo a la vista.

OWN-WORLD: Cabina unificada (`<section aria-label="Cabina de postura OMEGA">`, `.omega-studio-bg`) con haz de luz en ángulo Azul Rey y suelo reflejado; selector superior segmentado con ítem activo ensanchado y barra azul rey; título centrado con selector desplegable entre las cuatro superficies (`PC Windows`, `Celulares Android & iOS`, `Escudo de Enlaces`, `Base Forense STIX 2.1`); escultura 3D reactiva al ratón (`add-mouse-driven-orbit`) sobre arco `< 360° >` punteado; tres tarjetas inferiores de vidrio oscuro (`.omega-glass-card`) con acciones directas y cero saturación visual.

STORY: Al abrir OMEGA, la persona entra a una cabina serena y descansada para la vista sin contrastes agresivos ni tarjetas repetitivas: arriba elige módulo o abre Copiloto/búsqueda `⌘K` y modo `Simple | Técnico`; al centro gira o cambia la maqueta 3D de su PC, teléfono USB, escudo web o base STIX 2.1; y abajo ejecuta el escaneo local RAM, verifica cable USB o pega un enlace sospechoso en el acto, pasando en ancho completo a la hoja obsidiana unificada (`.roam-obsidian-sheet`) al abrir cualquier instrumento especializado.

FIRST VIEWPORT: `1380×860` sin barra lateral ni split: cabecera unificada (marca `OMEGA`, `SpatialNavPill`, campana `Copiloto`, `⌘K`, selector `Simple | Técnico`), protagonista centrado (kicker + `<h1 />` con selector + estado + lienzo 3D Three.js + arco `< 360° >` + 3 botones flotantes derechos), y fila inferior de 3 tarjetas de vidrio (`Equipo Local`, `Celulares USB`, `Escudo Web y STIX2`) con `titleBarOverlay` oscuro unificado (`#050912`).

FORM: Aplicación de escritorio Electron (`minWidth: 960`, `titleBarStyle: 'hidden'`) sin barra lateral web genérica y con total paridad visual y operativa en navegador web.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and verified desktop Electron screenshots
