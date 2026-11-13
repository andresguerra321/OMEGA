---
version: 1
slug: "omega-frontend-src-app-jsx"
primary_target: "omega/frontend/src/App.jsx"
related_targets:
  - "omega/frontend/src/components/SpatialNavPill.jsx"
  - "omega/frontend/src/components/TelemetryMapStage.jsx"
  - "omega/frontend/src/components/OverviewWarmInspector.jsx"
---

# Surface Brief — OMEGA Desktop Spatial Hybrid Shell

- **Scope:** `omega/frontend/src/App.jsx`, `SpatialNavPill.jsx`, `TelemetryMapStage.jsx`, `OverviewWarmInspector.jsx`, `CopilotDrawer.jsx`, `electron/main.js`, `electron/preload.cjs`, `index.css`
- **Mode:** `operate`

## Direction contract

THESIS: Sustituir cualquier esquema de barra lateral o dock inferior convencional por una arquitectura espacial dual de escritorio (inspiración táctil espacial Roam) que contrasta un lienzo topográfico oscuro en vivo con una hoja curva de piedra cálida en `Inicio` y transiciona sin fricción a una hoja curva obsidiana para los instrumentos forenses profundos, manteniendo navegación circular flotante en cápsula y Copiloto lateral no destructivo.

OWN-WORLD: Escenario oscuro topográfico (`#0E1317`) con curvas de nivel, rutas punteadas vivas y acentos ámbar (`#F5A623`); hoja derecha de piedra arquitectónica cálida (`#EAEAE6`, `.roam-stone-sheet`) con tarjetas elevadas `#FFFFFF`, objeto cenital minimal y tiras oscuras invertidas (`#191C22`, `.roam-dark-strip`) en `Inicio`, alternando automáticamente a obsidiana (`.roam-obsidian-sheet`, `#101319`) con `titleBarOverlay` sincronizado (`light` / `dark`) en los módulos especializados.

STORY: Al abrir la aplicación, la persona ve simultáneamente la topología viva de sensores de su equipo (PC Windows, USB Android/iPhone, Enlaces, Corpus STIX2 y Amenazas) y un inspector cálido y claro listo para auditar la PC en 1 clic, verificar un enlace al instante o revisar los últimos chequeos locales sin ruido técnico innecesario, pudiendo saltar por la cápsula circular superior a cualquier instrumento o abrir el Copiloto sin perder lo que ya estaba auditando.

FIRST VIEWPORT: Split espacial `58% / 42%` (`md:` en adelante) con borde curvo izquierdo (`rounded-l-[28px]`) y lengüeta vertical colapsable: mapa topográfico oscuro a la izquierda con marca `OMEGA`, cápsula flotante circular de navegación centrada y tarjetita blanca de nodo seleccionable; hoja `#EAEAE6` a la derecha con píldora de búsqueda blanca (`⌘K`), campana de Copiloto, selector `Simple | Técnico`, gráfico cenital minimalista sobre la piedra, tarjeta blanca solapada con acción `Analizar esta PC ahora` / `Enlace` y bloque inferior oscuro `Últimos análisis`.

FORM: Estación espacial híbrida nativa en Electron (`minWidth: 960`, `titleBarStyle: 'hidden'`) sin barra lateral genérica y con total paridad en escritorio Electron y navegador web.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and verified desktop Electron screenshots
