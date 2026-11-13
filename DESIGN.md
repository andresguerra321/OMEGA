# OMEGA Desktop Design System (`DESIGN.md`)

## 1. Visual World & Product Character
**Anodized Precision Security Instrument** — inspired by tactile studio hardware and clean desktop operating systems (Teenage Engineering hardware minimalism / Nothing OS telemetry × OMEGA Cobalt). Designed as a standalone native Electron/React desktop instrument rather than a dark SaaS dashboard or web chat wrapper.

## 2. Shell & Navigation Architecture
- **No left navigation rail:** Primary modules live in a centered, floating anodized glass bottom Dock (`DockBar.jsx`) over a dedicated `74px` dock bay (`<main pb-[74px]>`), keeping zero visual collision with pinned inputs or scrollable lists.
  - Primary sensors: `Inicio` (Centro de Protección), `Equipos` (PC Windows / Android ADB / iPhone), `Enlaces` (Verificación pasiva), `Amenazas` (Campañas y STIX2), `Exposición` (OSINT autorizado).
  - Utility divider + studio tools: `Asistente` (vista completa de consulta con citas), `Ajustes` (preferencias sin barra lateral secundaria).
- **Native 48px Top Window Bar (`App.jsx` + `electron/main.js`):** Blends seamlessly into Windows `titleBarOverlay` (`#0C0E13`, `height: 48`, `pr-40` caption clearance when `isDesktop`), exposing module context, live API/corpus health pill, global `Simple / Técnico` clarity switch, `Copiloto` drawer trigger (`Ctrl+J`), and Spotlight palette trigger (`⌘K`).
- **Non-destructive Slide-Over Copilot (`CopilotDrawer.jsx`):** Slides in at `max-w-[470px]` over any active module (`role="dialog" aria-modal="true"`) with optional pinned finding context, preserving underlying scans or link traces cleanly when dismissed (`Escape` or backdrop click).

## 3. Surfaces, Elevation & Color Roles (`index.css`)
- **Primary Chassis Ground:** `#090A0D` with subtle `22px` machined dot-matrix grid (`.omega-chassis-grid`).
- **Molded Surfaces (`.apple-group` / `.tactile-chassis`):** Linear obsidian gradient `#14171F` → `#101218` with top specular edge (`inset 0 1px 0 rgba(255,255,255,0.06)`) and calibrated drop shadow.
- **Recessed Instrument Wells (`.apple-well` / `.tactile-well`):** `#0A0C10` inset bay (`inset 0 2px 6px rgba(0,0,0,0.65)`) for telemetry logs, inputs, and code/IOC readouts.
- **Foreground & Contrast Floor (WCAG AA `>= 4.5:1`):**
  - Primary text: `#F4F6FA`
  - Secondary body text: `#C4CAD4` / `#D6DAE2`
  - Muted telemetry labels & placeholders: `#9097A5` / `#9BA2B0` (avoiding dim gray `< 4.5:1` on dark)
- **Status & Semantic Signal Accents:**
  - OMEGA Cobalt Action: `#2F6FED` / `#5E9BFF`
  - Verified / Online LED: `#30D158` / `#5EE07E`
  - Caution / Review LED: `#FF9F0A` / `#FFD60A`
  - High Risk / Alert LED: `#FF453A` / `#FF7A73`

## 4. Typography & Clarity Modes
- **UI Sans (`Inter`):** Tight negative display tracking (`-0.025em`) for instrument verdicts and clear `13.5px–15px` Spanish prose.
- **Technical Mono (`JetBrains Mono`, `.font-tech`):** Applied strictly to live sensor metrics, CVEs, SHAs, URLs, timestamps, and keycap hints (`⌘K`, `ESC`, `16 REP`).
- **Global `Simple` / `Técnico` Toggle:** Defaults to plain everyday Spanish in `CommandCenterPanel.jsx`, swapping seamlessly to raw technical telemetry identifiers (`yara_matches`, `sockets`, `corpus_iocs`) on demand.

## 5. Tactile Controls & Accessibility
- Physical keycap press physics (`.tactile-key`, `.tactile-key-primary`, `.tactile-key-ivory`) with `1px` vertical depression on `:active` and distinct disabled legibility (`disabled:bg-[#1E222B] disabled:text-[#9097A5]`).
- Mandatory `:focus-visible` `2px` `#5E9BFF` outline (`outline-offset: 2px`), keyboard shortcuts (`⌘K`, `⌘J`, `Esc`), and full `@media (prefers-reduced-motion: reduce)` guards disabling animations/transitions.
