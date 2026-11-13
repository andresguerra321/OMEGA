# OMEGA Desktop Design System (`DESIGN.md`)

## 1. Visual World & Product Character
**Spatial Telemetry Hybrid Instrument** — inspired by tactile spatial hardware interfaces (Roam spatial split × precision security instrumentation). Contrasts an atmospheric dark topographic live telemetry canvas (`#0E1317`) on the left with a curved (`rounded-l-[28px]`) sculpted warm architectural stone inspector sheet (`#EAEAE6`) on `Inicio`, transitioning seamlessly to a high-contrast dark obsidian workbench sheet (`.roam-obsidian-sheet`, `#101319`) for deep forensic investigation modules.

## 2. Shell & Navigation Architecture (`App.jsx` + `electron/main.js`)
- **Zero generic left sidebar or stacked bottom dock:** Navigation lives inside a floating frosted dark circular icon capsule (`SpatialNavPill.jsx`, `aria-label="Navegación espacial OMEGA"`), pinned top-center over the left topographic canvas on `Inicio` and centered inside the 52px instrument bar on specialized views. Active destination highlights in solid crisp ivory (`#F4F4EF`) with `#14171D` foreground and live LED indicators (`pcVerdict`, `usbConnected`, `apiOnline`, `isLoadingChat`).
- **Dual Spatial Split (`Inicio`):**
  - **Left Pane (`TelemetryMapStage.jsx`, `56%–60%` desktop width):** `#0E1317` topographic vector map with contour splines, amber directional core pointer (`#F5A623`), interactive sensor nodes (`#01 Esta PC · Windows`, `#02 Celular por USB`, `#03 Escudo de enlaces`, `#04 Corpus STIX2`, `#05 Amenazas`), floating crisp `#FFFFFF` node popover with sparkline, quick CTA & `✕` dismiss control, bottom-left volatile RAM readout pill, and bottom-right circular zoom/recenter/scan controls.
  - **Right Curved Sheet (`OverviewWarmInspector.jsx`, `.roam-stone-sheet`, `#EAEAE6`):** Curved left border seam (`rounded-l-[28px]`) with interactive vertical seam collapse/expand toggle pill, pure white search pill (`⌘K`), circular alert/Copiloto bell button (`Bell` + count badge), global `Simple | Técnico` toggle, overhead minimal hardware vector graphic directly on `#EAEAE6`, overlapping `#FFFFFF` trajectory card (`Analizar esta PC ahora` + inline quick link verify), and inverted dark charcoal `#191C22` recent analysis cards (`.roam-dark-strip`).
- **Specialized Workbench Modules (`equipo`, `enlace`, `amenazas`, `exposicion`, `preguntar`, `ajustes`):**
  - Left topographic canvas narrows on `xl` screens (`27%`, `max-w-[360px]`) into a serene ambient strip (collapsible via the vertical seam grabber button) while the right sheet transitions cleanly into `.roam-obsidian-sheet` (`#101319`) hosting the interactive dark-mode workbenches with zero contrast loss.
- **Dynamic Native Electron TitleBar (`electron/main.js` + `preload.cjs`):** `titleBarStyle: 'hidden'` + dynamic `omega:set-titlebar-theme` IPC overlay syncing Windows `- □ ✕` chrome seamlessly between light warm-stone (`#EAEAE6` / `#191C22`, `height: 40`) on `Inicio` and obsidian (`#101319` / `#A1A7B4`, `height: 40`) on all other modules, with `pt-11` / `pr-40` caption clearance when `isDesktop` is true.
- **Non-destructive Slide-Over Copilot (`CopilotDrawer.jsx`):** Slides in at `max-w-[470px]` over any active view (`pt-9` desktop clearance under `- □ ✕`) with pinned context support, preserving underlying scans or audits on dismiss (`Escape` or backdrop click).

## 3. Surfaces, Elevation & Color Roles (`index.css`)
- **Topographic Canvas Ground:** `#0E1317` radial vignette + `#0C1014` (`omega-stage-bg`) with crisp `#F4F6FA` wordmark and `rgba(182, 200, 214, 0.085)` contour splines.
- **Warm Stone Inspector (`.roam-stone-sheet`):** `#EAEAE6` primary shell paired with crisp `#FFFFFF` elevated trajectory cards (`.roam-white-card`), inverted `#191C22` strip blocks (`.roam-dark-strip`), high-contrast `#17191E` ink, `#454A54` secondary metadata, and Amber `#F5A623` accent highlights.
- **Obsidian Workbench Sheet (`.roam-obsidian-sheet`):** `#101319` → `#0C0E14` gradient with hairline left border `rgba(255,255,255,0.08)`, molded dark surfaces (`.apple-group`), and recessed telemetry wells (`.apple-well`).
- **Semantic Status Accents:**
  - Verified / Clean: `#22C55E` / `#30D158`
  - Caution / Host Accent: `#F5A623`
  - High Risk / Alert: `#FF453A`
  - OMEGA Cobalt Secondary / Focus: `#2F6FED` / `#5E9BFF`

## 4. Typography & Clarity Modes
- **UI Sans (`Inter`):** Clean editorial contrast with `-0.025em` display tracking (`Esta PC — Windows`, `Últimos análisis`) and readable Spanish copy.
- **Technical Mono (`JetBrains Mono`, `.font-tech`):** Applied strictly to live sensor counts, CVEs, hashes, URLs, timestamps, and keycap hints (`⌘K`, `ESC`, `RAM`).
- **Global `Simple` / `Técnico` Toggle:** Available directly on both the `Inicio` stone header and the dark obsidian header; switches seamlessly between everyday Spanish clarity and technical telemetry (`sockets`, `hits YARA`, raw verdicts).

## 5. Tactile Controls & Accessibility
- Physical press feedback, explicit keyboard navigation (`⌘K`, `Ctrl+J`, `Esc`), semantic landmarks (`<section aria-label="Mapa topográfico de telemetría">`, `<aside aria-label="Panel inspector de protección">`, `<nav aria-label="Navegación espacial OMEGA">`, `<main>`), WCAG AA focus rings (`2px` `#191C22` on stone, `#5E9BFF` on dark), and complete `@media (prefers-reduced-motion: reduce)` guards.
