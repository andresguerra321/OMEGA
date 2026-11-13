---
version: 1
slug: "omega-frontend-src-app-jsx"
primary_target: "omega/frontend/src/App.jsx"
related_targets:
  - "omega/frontend/src/components/SpatialNavPill.jsx"
  - "omega/frontend/src/components/SecurityPostureStage.jsx"
  - "omega/frontend/src/components/OverviewWarmInspector.jsx"
---

# Surface Brief — OMEGA Desktop Minimalist Security Reception

- **Scope:** `omega/frontend/src/App.jsx`, `SpatialNavPill.jsx`, `SecurityPostureStage.jsx`, `OverviewWarmInspector.jsx`, `CopilotDrawer.jsx`, `electron/main.js`, `electron/preload.cjs`, `index.css`
- **Mode:** `operate`

## Direction contract

THESIS: Sustituir cualquier esquema de barra lateral convencional o metáfora de mapa cartográfico por una recepción de seguridad minimalista y dual de escritorio que contrasta un lienzo atmosférico oscuro con cortinas suaves de luz vertical (`atmosphere-background`) y 4 superficies interactivas enmarcas con filetes finos (`#0B0E13`) frente a una hoja curva de piedra cálida en `Inicio` (`#EAEAE6`) que transiciona a una hoja obsidiana para los instrumentos forenses profundos, manteniendo navegación circular flotante en cápsula y Copiloto lateral no destructivo.

OWN-WORLD: Escenario oscuro atmosférico (`#0B0E13`, `<section aria-label="Postura de seguridad OMEGA">`) con cortinas verticales de luz animadas por `<canvas>`, tipografía editorial serena y filas estructurales de sensores con indicador lateral sutil; hoja derecha de piedra arquitectónica cálida (`#EAEAE6`, `.roam-stone-sheet`) con tarjetas elevadas `#FFFFFF`, ilustración vectorial contextual minimal y tiras oscuras invertidas (`#191C22`, `.roam-dark-strip`) en `Inicio`, alternando automáticamente a obsidiana (`.roam-obsidian-sheet`, `#101319`) con `titleBarOverlay` sincronizado (`light` / `dark`) en los módulos especializados.

STORY: Al abrir la aplicación, la persona es recibida con serenidad visual: a la izquierda ve la postura actual de protección y cuatro superficies claras seleccionables (`PC Windows`, `Celulares por USB`, `Escudo de enlaces`, `Base forense local`), y a la derecha un inspector cálido y claro sincronizado al elemento elegido para auditar la PC en 1 clic, verificar un enlace al instante o revisar los últimos chequeos locales sin ruido técnico ni gráficas sintéticas, pudiendo saltar por la cápsula circular superior a cualquier instrumento o abrir el Copiloto sin perder lo que ya estaba auditando.

FIRST VIEWPORT: Split espacial `58% / 42%` (`md:` en adelante) con borde curvo izquierdo (`rounded-l-[28px]`) y lengüeta vertical colapsable: recepción atmosférica oscura a la izquierda con marca `OMEGA`, cápsula flotante circular de navegación centrada, titular sobrio y 4 filas divisorias interactivas + pie `Memoria volátil · 0 bytes en disco`; hoja `#EAEAE6` a la derecha con píldora de búsqueda blanca (`⌘K`), campana de Copiloto, selector `Simple | Técnico`, vector minimal contextual sobre la piedra, tarjeta blanca solapada con acción contextual (`Analizar esta PC ahora` / `Enlace`) y bloque inferior oscuro `Últimos análisis`.

FORM: Estación espacial híbrida nativa en Electron (`minWidth: 960`, `titleBarStyle: 'hidden'`) sin barra lateral genérica y con total paridad en escritorio Electron y navegador web.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and verified desktop Electron screenshots
