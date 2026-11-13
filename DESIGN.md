# OMEGA Desktop Design System (`DESIGN.md`)

## 1. Visual World & Product Character
**Minimalist Negro · Blanco · Azul Rey Unified Dark Studio Cockpit** — inspired by sleek dark-studio instrumentation (`glass-dark-ui` × `webgl-3d-object` × `add-mouse-driven-orbit` × `dark-blue-contrasting-clean`). Eliminates the prior harsh 50/50 white/dark split (`OverviewWarmInspector.jsx` removed) in favor of one serene full-viewport obsidian-sapphire canvas (`#04070E` → `#080F1E`, `.omega-studio-bg`) illuminated by a subtle upper-right Azul Rey (`#1D4ED8` / `#2563EB`) studio light shaft and floor glow, framing a real-time interactive Three.js 3D hardware/security centerpiece (`SecurityCenterpiece3D.jsx`), studio `< 360° >` turntable, and calm frosted dark glass bottom cards (`Equipo Local`, `Celulares USB`, `Escudo Web y STIX2`).

## 2. Shell & Navigation Architecture (`App.jsx` + `electron/main.js`)
- **Zero generic left sidebar, stacked bottom dock, or blinding split screen:** Navigation lives inside a frosted dark segmented bar (`SpatialNavPill.jsx`, `aria-label="Navegación espacial OMEGA"`, `rounded-[14px] p-1`) centered in the unified header across both `Inicio` and specialized views. Active destinations expand smoothly (`w-16` full / `w-12` compact) with a subtle frosted fill, soft inner highlight, `#3B82F6` bottom indicator bar, and compact status LEDs (`pcVerdict`, `usbConnected`, `apiOnline`, `isLoadingChat`).
- **Full-Viewport `Inicio` Cockpit (`SecurityPostureStage.jsx`, `<section aria-label="Cabina de postura OMEGA">`):**
  - **Unified Top Header:** Left `OMEGA` emblem (`OmegaLogo`), center `SpatialNavPill`, right studio utility chips (`Copiloto` bell badge, `⌘K` quick palette, global `Simple | Técnico` toggle, plus miniature live telemetry pill on `xl`), with `pr-40 sm:pr-44` titlebar clearance when `isDesktop` is true.
  - **Centerpiece Stage (`SecurityCenterpiece3D.jsx`):** Centered typographic kicker + clickable surface dropdown selector (`Esta PC Windows`, `Celulares Android & iOS`, `Escudo de Enlaces`, `Base Forense STIX 2.1`) above a real Three.js WebGL 3D procedural sculpture (obsidian matte chassis, brushed silver rings/accents, Azul Rey status trim/aura, soft floor pedestal shadow, damped mouse-driven orbital parallax + pointer drag spin, `prefers-reduced-motion: reduce` static pose, and clean resource disposal).
  - **Turntable & Studio Micro-Rail:** Dashed `< 360° >` orbital arc (`Superficie anterior`, `Rotar objeto 360 grados`, `Siguiente superficie`) beneath the 3D centerpiece, plus a discreet right-edge 3-button studio stack (primary surface check, STIX2 sync, open technical view).
  - **Bottom Frosted Dark Glass Bento Trio (`.omega-glass-card`):**
    1. `Equipo Local`: Volatile RAM/WMI readiness/verdict, primary `#1D4ED8` Azul Rey CTA (`Analizar esta PC ahora` / `Reanalizar PC`) + conditional `Ver informe` after scan, and real socket/YARA counters.
    2. `Celulares USB`: Live Android ADB / iOS Lockdown cable readiness paired with a minimal circular status ring gauge.
    3. `Escudo Web y STIX2`: Active IOC/report corpus summary + embedded zero-navigation passive URL verifier (`input[aria-label="Enlace sospechoso para verificar"]` → `Detalle →`).
- **Specialized Workbench Modules (`equipo`, `enlace`, `amenazas`, `exposicion`, `preguntar`, `ajustes`):**
  - Full-width `.roam-obsidian-sheet` (`#060A14` → `#04060C`) with a unified 56px dark studio header (`OmegaLogo`, active module breadcrumb, compact `SpatialNavPill`, contextual actions, `Simple | Técnico` toggle, `Copiloto`, and `⌘K`) so every view belongs to one cohesive dark cockpit.
- **Unified Native Electron TitleBar (`electron/main.js` + `preload.cjs`):** `titleBarStyle: 'hidden'` + dark `titleBarOverlay` (`#050912` / `#CBD5E1`, `height: 40`) synchronized across `Inicio` and all forensic modules via `omega:set-titlebar-theme`.
- **Non-destructive Slide-Over Copilot (`CopilotDrawer.jsx`):** Slides in at `max-w-[470px]` over any active view (`pt-9` desktop clearance under `- □ ✕`) with pinned context support, preserving underlying scans or audits on dismiss (`Escape` or backdrop click).

## 3. Surfaces, Elevation & Color Roles (`index.css`)
- **Studio Backdrop Ground (`.omega-studio-bg`):** Multi-stop near-black navy gradient (`#03060C` / `#040812` / `#081124`) with subtle upper-right `#1D4ED8` spotlight glow and elliptical horizon floor wash under the 3D object.
- **Frosted Dark Glass Containers (`.omega-glass-card` / `.omega-glass-chip` / `.roam-pill-nav`):** Semi-transparent deep navy slate (`rgba(15, 24, 42, 0.56–0.78)`) with `backdrop-filter: blur(20px)`, `1px solid rgba(255, 255, 255, 0.09)` borders, and top inner specular edge (`inset 0 1px 0 rgba(255,255,255,0.09)`).
- **Obsidian Workbench Sheet (`.roam-obsidian-sheet`):** `#060A14` → `#04060C` full-width shell hosting `.apple-group` and `.apple-well` surfaces with WCAG AA `#F8FAFC` / `#CBD5E1` / `#94A3B8` contrast.
- **Strict Palette Discipline (Negro · Blanco · Azul Rey):**
  - Studio Obsidian / Near-Black: `#03060C` / `#04070E` / `#081124`
  - Pure Crisp Ink & White Highlights: `#FFFFFF` / `#F8FAFC` / `#CBD5E1`
  - Brand Focal Azul Rey: `#1D4ED8` / `#2563EB` / `#3B82F6`
  - Semantic Operational States Only: `#22C55E` (clean/verified), `#EF4444` (high risk/alert)

## 4. Typography & Clarity Modes
- **UI Sans (`Inter`):** High-legibility dark-mode hierarchy with `-0.03em` hero centerpiece titles and concise Spanish labels.
- **Technical Mono (`JetBrains Mono`, `.font-tech`):** Applied strictly to live sensor counts, CVEs, hashes, URLs, `360°`, timestamps, and keycap hints (`⌘K`, `ESC`, `RAM`).
- **Global `Simple` / `Técnico` Toggle:** Available directly on both the `Inicio` cockpit header and the specialized module header; switches between plain Spanish clarity and technical metadata (`HOST LOCAL · WMI / SOCKETS RAM`, `ADB local · Lockdown iOS`, `hits YARA`).

## 5. Tactile Controls & Accessibility
- Physical press feedback, explicit keyboard navigation (`⌘K`, `Ctrl+J`, `Esc`), semantic landmarks (`<section aria-label="Cabina de postura OMEGA">`, `<nav aria-label="Navegación espacial OMEGA">`, `<main>`), listbox semantics for the 3D subject switcher (`aria-haspopup="listbox"` / `role="listbox"` / `role="option"`), WCAG AA focus rings (`#3B82F6` / `#5E9BFF`), `document.hidden` WebGL throttling, and complete `@media (prefers-reduced-motion: reduce)` guards.
