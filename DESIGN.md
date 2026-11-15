# OMEGA Desktop Design System (`DESIGN.md`)

## 1. Visual World & Product Character
**Dark Frosted Glassmorphism Night Control Panel** ("vidrio esmerilado sobre un panel de control nocturno"): calm, disciplined threat-intelligence instrumentation combining a `#0A0A0C` matte chassis ground, subtle `24px` dot-grid texture, `2.5%` inline SVG film grain, beveled frosted glass panels, a single consolidated cobalt accent (`#2F6FED`), and a deferred interactive Three.js centerpiece (`SecurityCenterpiece3D.jsx`) — with strictly zero multicolor/pastel gradients.

## 2. Color Palette, Glass Surfaces & WCAG Roles (`omega/frontend/src/index.css`)
- **Base Canvas:**
  - `#0A0A0C` (`--bg-canvas`, `--color-obsidian`, `.omega-studio-bg`, `.roam-obsidian-sheet`) layered over `.omega-chassis-grid` (`24px` `radial-gradient` dot matrix), `.omega-film-grain` (`opacity: 0.025`, `mix-blend-mode: overlay` SVG noise), and low-opacity `#2F6FED` atmospheric depth pools (`.omega-fold-left`, `.omega-fold-right`) so frosted blur panels always sit over structured visual texture rather than flat empty voids.
- **Glass Surfaces:**
  - **Primary Glass Panel (`.omega-glass-panel`, `.omega-capsule`):** `rgba(20, 20, 24, 0.55)` (`--glass-bg`) + `backdrop-filter: blur(16px)`
  - **Elevated Glass Frame & Floating Nav (`.omega-glass-panel-strong`, `.roam-pill-nav`, `.omega-dock`):** `rgba(20, 20, 24, 0.60–0.62)` (`--glass-bg-nav`, `--glass-bg-strong`) + `backdrop-filter: blur(20px)`
  - **Drawer / Sidebar Vibrancy (`.apple-vibrancy`):** `rgba(20, 20, 24, 0.58)` + `backdrop-filter: blur(16px)`
  - **Active / Hover Glass Surface (`--glass-bg-hover`, `.apple-segmented-active`, `.omega-glass-card:hover`, `.omega-glass-chip:hover`):** `rgba(28, 36, 56, 0.65)` (subtle midnight-blue tint)
  - **Subordinate Unblurred Containers (`.apple-group`, `.tactile-chassis`, `.omega-glass-card`, `.apple-well`):** `rgba(20, 20, 24, 0.76)` (`--glass-bg-solid`) / `rgba(10, 10, 12, 0.72)` (`--bg-well`) with no `backdrop-filter`
- **Beveled Edge Simulation (No Gradient Borders):**
  - Top & Left highlight: `rgba(255, 255, 255, 0.08)` (`--glass-border-highlight`) paired with subtle `inset 0 1px 0 rgba(255, 255, 255, 0.06–0.10)`
  - Bottom & Right depth: `rgba(0, 0, 0, 0.40)` (`--glass-border-depth`)
- **Consolidated Single Blue Accent (`--accent-cobalt` / `--color-cobalt`):**
  - **Primary Blue:** `#2F6FED` (replaces legacy `#1D4ED8`, `#3B82F6`, `#3B7BF2`, `#5E9BFF`, `#8AB4FF`, `#93C5FD`)
  - **Interactive Glow (`--accent-glow`):** `0 0 24px rgba(47, 111, 237, 0.25)` — applied exclusively on active controls, focus-within states (`.omega-capsule:focus-within`), hovered interactive cards/chips (`.omega-glass-card:hover`, `.omega-glass-chip:hover`), and active primary CTAs. Never used as an idle decoration.
  - **WCAG AA Contrast Discipline:** Solid `#2F6FED` buttons pair with `#FFFFFF` text; small interactive badges, chips, and segmented controls use `rgba(28, 36, 56, 0.65)` fill + `#2F6FED` border opacity + `#F2F2F4` text to avoid low-contrast small blue copy over dark translucent glass.
- **Typography Ink Tokens:**
  - **Primary Text (`--text-primary`):** `#F2F2F4`
  - **Secondary Text (`--text-secondary`):** `#9A9AA2`
- **Semantic Severity States Only:**
  - Clean / Verified: `#30D158` / `#22C55E` (plus tinted soft greens inside positive verdict badges)
  - Warning / Caution: `#FF9F0A` / `#FFD60A`
  - Alert / Compromised: `#FF453A` / `#FF6961` / `#EF4444` (plus `#FFD0CE` / `#FFDAD6` high-contrast badge text)

## 3. Strict GPU Blur Budget (`<= 3–4` Simultaneous `backdrop-filter` Layers)
To keep real-time Three.js WebGL smooth without GPU compositor bottlenecks:
- Every view enforces **at most 3–4 simultaneous `backdrop-filter: blur(...)` surfaces visible on screen**:
  - **Global Shell:** Floating `SpatialNavPill` (`roam-pill-nav`, 1)
  - **`Inicio` (`SecurityPostureStage.jsx`):** Top telemetry bar (`omega-glass-panel`, 2), central 3D frame (`omega-glass-panel-strong`, 3), bottom action bento (`omega-glass-panel`, 4) — individual inner cards keep no redundant blur.
  - **`Asistente` / `Cuenta` / `Equipos` / `Enlaces` / `Amenazas` / `Exposición` / `Ajustes`:** Primary top status/verdict card or `OmegaShaderOrb` hero medallion (`backdrop-filter: blur(16px)`), search/query composer (`omega-capsule`), or open side drawer/rail (`apple-vibrancy` / `CopilotDrawer`), while `omega-glass-card` depth pills/starter cards, `.apple-group` private library/form cards, sticky footers, table headers (`<thead>`), and lists remain non-blurred (`#141418` / `#0A0A0C` alpha fills). Fullscreen modal scrims (`AuthModal.jsx`, Command Palette in `App.jsx`) use dim `bg-[#0A0A0C]/72–78` so the inner `.omega-glass-panel` dialog supplies the sole blur layer.
- **Graceful Degradation:** `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` and `@media (prefers-reduced-transparency: reduce)` disable blur and resolve glass surfaces cleanly to `#141418`.

## 4. Shell, 3D Centerpiece & Navigation Architecture (`App.jsx` + `electron/`)
- **Unified Centered Navigation (`SpatialNavPill.jsx`):** Floating frosted pill (`roam-pill-nav`, `rounded-[14px] p-1`) centered inside the symmetric `h-[60px]` header across every view with identical right-hand utility ordering (`[Simple | Técnico]` · `[Copiloto]` · `[⌘K]` · `[Cuenta / Entrar]`, expanding `Copiloto`/`⌘K` labels at `2xl:` to avoid header overflow), consistent `NAV_ITEMS` page titles matching tab labels, and clear clearance from Windows `- □ ✕` titlebar controls (`sm:mr-36`), paired with a matching `#0A0A0C` / `#F2F2F4` dark Electron `titleBarOverlay` (`electron/main.js`) and harmonized `#0A0A0C` + `#2F6FED` frosted loader card (`electron/splash.html`).
- **Standard Account & Private Library Module (`AuthModulePanel.jsx` + `AuthModal.jsx` + Mandatory Auth Gate):** Full-viewport dark frosted entry gate blocks all navigation (`SpatialNavPill`), `⌘K`/`⌘J` hotkeys, USB probes, and feature views until a verified JWT session is active (validated structurally in `lib/api.js` and against `GET /api/v1/auth/me` on boot). Once signed in, `Cuenta` provides Email + Password account switching, active session telemetry, and private Zero-Retention PDF management backed automatically by an internal personal workspace (`ensurePersonalWorkspace`).
- **Deferred Three.js Centerpiece (`SecurityCenterpiece3D.jsx` + `SecurityCenterpieceFallback.jsx`):** Renders the SVG vector seal immediately on mount to protect Time-to-Interactive (TTI), then lazy-loads WebGL (`requestIdleCallback`, skipped under `prefers-reduced-motion: reduce`), caps `pixelRatio <= 1.5`, pauses under `document.hidden`, recovers on `webglcontextlost`, and exposes live `role="region"` + `role="status"` ARIA announcements synchronized with `lib/centerpieceStatus.js` (`#2F6FED` active/ready, `#30D158` verified clean, `#FF453A` alert).
- **Glassmorphic OMEGA Emblem & Chatbot Hero (`OmegaLogo.jsx` + `OmegaShaderOrb.jsx` + `ChatWorkspace.jsx`):** Multi-layer beveled shield SVG (`OmegaLogo`) framed inside a dark frosted `backdrop-blur-[16px]` architectural medallion (`OmegaShaderOrb`, `size={62}` hero with radial `#2F6FED` ambient halo) over `ChatAtmosphere` dot-grid + horizon depth layers, concise `"OMEGA IA"` hero greeting, generous `min-h-[144px]` `.omega-capsule` composer (`Corpus CTI | Mis PDFs` + `SourceScopePills` + `Adjuntar PDF` + `+ IOC`), 4 real RAG depth selector pills (`Rápido` `topK=4`, `Estándar` `topK=6`, `En profundidad` `topK=10`, `Integral` `topK=14`), and 3 uncluttered in-flow `.omega-glass-card` starter briefs directly below — zero overlapping floating corner widgets (`3` total simultaneous `backdrop-filter` layers on empty stage).
- **Workbench Consistency (`PanelStatePrimitives.jsx` + `DeviceSetupVisuals.jsx`):** Shared `PanelSkeleton`, `PanelErrorBanner`, `PanelEmptyState`, and `ActionConfirmationBanner` primitives plus `#0A0A0C` / `#141418` / `#2F6FED` / `#30D158` setup diagrams across `MvtVerifierPanel.jsx`, `LinkVerifierPanel.jsx`, `CampaignsPanel.jsx`, `OsintPanel.jsx`, `ChatWorkspace.jsx`, `SourcesPanel.jsx`, `CitationDrawer.jsx`, `CopilotDrawer.jsx`, `AuthModulePanel.jsx`, `AuthModal.jsx`, and `SettingsPanel.jsx`.

## 5. Typography, Modes & Accessibility
- **Self-Hosted `@fontsource` Faces:**
  - Display Headings (`Sora`, `.font-display` / `h1` / `h2`, tabular numerals)
  - Body UI (`IBM Plex Sans`)
  - Technical Telemetry (`IBM Plex Mono`, `.font-tech`, tabular numerals) for sockets, CVEs, hashes, URLs, `360°` angles, timestamps, and keycaps (`⌘K`, `ESC`, `Ctrl+J`).
- **Clarity Toggle (`Simple` | `Técnico`):** Persistent header toggle adapting plain Spanish labels vs. forensic metadata without layout shift.
- **Keyboard & Reduced Motion/Transparency:** `⌘K` Command Palette, `Ctrl+J` Copilot drawer, `Escape` dismissal, `#2F6FED` `focus-visible` outlines (`2px`), semantic landmarks, and full `@media (prefers-reduced-motion: reduce)` and `@media (prefers-reduced-transparency: reduce)` support.
