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

THESIS: Sustituir cualquier esquema de barra lateral convencional o metáfora de mapa cartográfico por una recepción de seguridad minimalista en paleta Negro · Blanco · Azul Rey que contrasta un lienzo atmosférico oscuro con cortinas verticales en Azul Rey (`atmosphere-background` + `dark-blue-contrasting-clean`, `#050811`) frente a una hoja curva blanco-alabastro (`#F5F7FB`) en `Inicio` con tarjetas negras y acentos Azul Rey (`#1D4ED8` / `#2563EB`), transicionando a una hoja obsidiana para los instrumentos forenses profundos, manteniendo navegación circular flotante en cápsula y Copiloto lateral no destructivo.

OWN-WORLD: Escenario oscuro atmosférico (`#050811`, `<section aria-label="Postura de seguridad OMEGA">`) con cortinas verticales de luz en Azul Rey animadas por `<canvas>`, tipografía blanca serena y filas estructurales de sensores con indicador lateral en `#3B82F6`; hoja derecha blanco-alabastro (`#F5F7FB`, `.roam-stone-sheet`) con tarjetas elevadas `#FFFFFF`, ilustración vectorial mate negro/azul rey y tarjetas oscuras de análisis (`#0D1322` → `#070A12`, `.roam-dark-strip`) en `Inicio`, alternando automáticamente a obsidiana (`.roam-obsidian-sheet`, `#090D16` → `#05070C`) con `titleBarOverlay` sincronizado (`light` / `dark`) en los módulos especializados.

STORY: Al abrir la aplicación, la persona es recibida con serenidad visual en Negro · Blanco · Azul Rey: a la izquierda ve la postura actual de protección y cuatro superficies claras seleccionables (`PC Windows`, `Celulares por USB`, `Escudo de enlaces`, `Base forense local`), y a la derecha un inspector blanco y nítido sincronizado al elemento elegido para auditar la PC en 1 clic en Azul Rey, verificar un enlace al instante o revisar los últimos chequeos locales sin ruido técnico, líneas heredadas ni tonalidades beige/naranja, pudiendo saltar por la cápsula circular superior a cualquier instrumento o abrir el Copiloto sin perder lo que ya estaba auditando.

FIRST VIEWPORT: Split espacial `58% / 42%` (`md:` en adelante) con borde curvo izquierdo (`rounded-l-[28px]`) y lengüeta vertical colapsable: recepción atmosférica negra/azul rey a la izquierda con marca `OMEGA`, cápsula flotante circular de navegación centrada, titular sobrio y 4 filas divisorias interactivas + pie `Memoria volátil · 0 bytes en disco`; hoja `#F5F7FB` a la derecha con píldora de búsqueda blanca (`⌘K`), campana de Copiloto en `#1D4ED8`, selector `Simple | Técnico`, vector negro/azul rey sobre el fondo blanco, tarjeta blanca solapada con celdas claras de estado y CTA azul rey (`Analizar esta PC ahora` / `Enlace`), y bloque inferior oscuro `Últimos análisis` + verificador web pasivo.

FORM: Estación espacial híbrida nativa en Electron (`minWidth: 960`, `titleBarStyle: 'hidden'`) sin barra lateral genérica y con total paridad en escritorio Electron y navegador web.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and verified desktop Electron screenshots
