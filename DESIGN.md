# OMEGA Desktop Design System (`DESIGN.md`)

## 1. Visual World & Product Character
**Minimalist Negro · Blanco · Azul Rey Architectural Instrumentation Cockpit** (`framed-tech-dark-border-gradient` × `background-grid-webgl` × `webgl-3d-object` × `add-mouse-driven-orbit`). Eliminates heavy blurred spotlight gradients and empty backgrounds in favor of a calm matte `#05070B` obsidian ground anchored by hairline `max-w-[1320px]` structural guide rails, side calibration markers (`HOST WINDOWS` · `MEMORIA VOLÁTIL`), and a full-viewport Three.js WebGL scene (`SecurityCenterpiece3D.jsx`) with a receding vertex-faded perspective floor grid and sparse atmospheric micro-motes.

## 2. Shell & Navigation Architecture (`App.jsx` + `electron/main.js`)
- **Mathematically Centered Navigation Across All Views & Sizes:** `SpatialNavPill.jsx` (`aria-label="Navegación espacial OMEGA"`, `rounded-[14px] p-1`) is pinned to exact viewport center (`md:absolute md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2`) inside a symmetric `px-5 sm:px-7` unified header (`h-14`) across every view (`Inicio` and all forensic modules), auto-compacting below `xl` (`w-12` active / `w-8` inactive) while keeping right-side controls cleanly clear of Windows `- □ ✕` controls (`sm:mr-36`).
- **Preguntar Chat Session Sub-Toolbar (`App.jsx`):** Conversation selector (`Nueva consulta` / case threads), `Fuentes`, and `Exportar` live inside a dedicated `h-10` secondary `<header aria-label="Controles de sesión de chat">` right beneath the Global Top Bar so the top navigation pill never drifts left or right between modules.
- **Full-Viewport `Inicio` Cockpit (`SecurityPostureStage.jsx`, `<section aria-label="Cabina de postura OMEGA">`):**
  - **Full-Stage WebGL Canvas (`SecurityCenterpiece3D.jsx`):** Covers the full cockpit background (`absolute inset-0`) with a receding Azul Rey/slate perspective floor grid (`buildPerspectiveFloorGrid`), sparse dust motes (`buildAtmosphericMotes`), real Three.js procedural centerpiece sculpture (`Esta PC Windows`, `Celulares Android & iOS`, `Escudo de Enlaces`, `Base Forense STIX 2.1`), smooth pointer parallax on `window`, and drag-to-orbit on open stage background.
  - **Headline Subject Switcher:** Clean editorial `h1.font-display` (`Sora`) surface dropdown selector (`Esta PC Windows`, etc.) with zero decorative eyebrow kickers above the heading.
  - **Turntable & Studio Micro-Rail:** Dashed `< 360° >` orbital arc (`Superficie anterior`, `Rotar objeto 360 grados`, `Siguiente superficie`) beneath the 3D centerpiece, plus a discreet right-edge 3-button studio stack (primary surface check, STIX2 sync, open technical view).
  - **Bottom Matte Bento Trio (`.omega-glass-card`):**
    1. `Equipo Local`: Volatile RAM/WMI readiness/verdict, primary `#1D4ED8` Azul Rey CTA (`Analizar esta PC ahora` / `Reanalizar PC`) + conditional `Ver informe` after scan, and real socket/YARA counters.
    2. `Celulares USB`: Live Android ADB / iOS Lockdown cable readiness paired with a minimal circular status ring gauge.
    3. `Escudo Web y STIX2`: Active IOC/report corpus summary + embedded zero-navigation passive URL verifier (`input[aria-label="Enlace sospechoso para verificar"]` → `Detalle →`).
- **Specialized Workbench Modules (`equipo`, `enlace`, `amenazas`, `exposicion`, `preguntar`, `ajustes`):**
  - Full-width `.roam-obsidian-sheet` (`#05070B`) sharing the exact same symmetric `h-14` centered Global Top Bar (`OmegaLogo`, `SpatialNavPill`, `Simple | Técnico`, `Copiloto`, `⌘K`, and `sm:mr-36`), framed by `ChatAtmosphere.jsx` subtle grid rails and micro-dots.
- **Unified Native Electron TitleBar (`electron/main.js` + `preload.cjs`):** `titleBarStyle: 'hidden'` + dark `titleBarOverlay` (`#05070B` / `#CBD5E1`, `height: 40`) synchronized across `Inicio` and all forensic modules via `omega:set-titlebar-theme`.
- **Non-destructive Slide-Over Copilot (`CopilotDrawer.jsx`):** Slides in at `max-w-[470px]` over any active view (`pt-9` desktop clearance under `- □ ✕`) with pinned context support, preserving underlying scans or audits on dismiss (`Escape` or backdrop click).

## 3. Surfaces, Elevation & Color Roles (`index.css`)
- **Architectural Matte Ground (`.omega-studio-bg` / `.roam-obsidian-sheet`):** Crisp matte `#05070B` base with whisper-quiet subtle depth (`rgba(29, 78, 216, 0.06)` micro-vignette) and hairline `rgba(255, 255, 255, 0.06)` frame lines — zero bloated blurred radial clouds.
- **Architectural Obsidian Cards (`.omega-glass-card` / `.omega-glass-chip` / `.roam-pill-nav`):** Controlled translucent dark slate (`rgba(9, 13, 21, 0.90)`) with `backdrop-filter: blur(12px)`, crisp `1px solid rgba(255, 255, 255, 0.09)` borders, and delicate top edge highlight.
- **Strict Palette Discipline (Negro · Blanco · Azul Rey):**
  - Studio Obsidian / Near-Black: `#05070B` / `#080C14` / `#0B101B`
  - Pure Crisp Ink & White Highlights: `#FFFFFF` / `#F8FAFC` / `#CBD5E1`
  - Brand Focal Azul Rey: `#1D4ED8` / `#2563EB` / `#3B82F6`
  - Semantic Operational States Only: `#22C55E` (clean/verified), `#EF4444` (high risk/alert)

## 4. Typography & Clarity Modes (Self-Hosted `@fontsource`)
- **Display Heading Font (`Sora`, `.font-display` / `h1` / `h2`):** Crisp geometric instrumentation display (`-0.028em` tracking), self-hosted offline via `@fontsource/sora`.
- **UI Body Sans (`IBM Plex Sans`):** High-legibility technical sans-serif self-hosted via `@fontsource/ibm-plex-sans`, eliminating generic `-apple-system` / Windows `Segoe UI` fallback.
- **Technical Mono (`IBM Plex Mono`, `.font-tech`):** Self-hosted via `@fontsource/ibm-plex-mono`; applied strictly to live sensor counts, CVEs, hashes, URLs, `360°`, timestamps, and keycap hints (`⌘K`, `ESC`, `RAM`).
- **Global `Simple` / `Técnico` Toggle:** Available directly on the unified Global Top Bar across every view; switches between plain Spanish clarity and technical metadata (`WMI / Sockets RAM · Tiempo real`, `ADB local · Lockdown iOS`, `hits YARA`).

## 5. Tactile Controls & Accessibility
- Physical press feedback, explicit keyboard navigation (`⌘K`, `Ctrl+J`, `Esc`), semantic landmarks (`<section aria-label="Cabina de postura OMEGA">`, `<nav aria-label="Navegación espacial OMEGA">`, `<header aria-label="Controles de sesión de chat">`, `<main>`), listbox semantics for the 3D subject switcher (`aria-haspopup="listbox"` / `role="listbox"` / `role="option"`), WCAG AA focus rings (`#3B82F6` / `#5E9BFF`), `document.hidden` WebGL throttling, and complete `@media (prefers-reduced-motion: reduce)` guards.
