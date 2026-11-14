# OMEGA Frontend (`omega/frontend`)

Interfaz web y aplicación de escritorio Electron para **OMEGA**, construida con **React 19.3**, **Vite 8**, **Tailwind CSS v4**, **Three.js 0.187**, **Lucide React** y fuentes autoalojadas (`@fontsource/sora`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`).

## Scripts disponibles

```bash
# Servidor local de desarrollo (proxea /api -> http://localhost:8000)
npm run dev

# Linter Oxlint
npm run lint

# Build de producción (con separación de chunks vendor-three / vendor-react / vendor-markdown / vendor-icons)
npm run build

# Ejecutar aplicación de escritorio Electron en desarrollo (Vite :5174 + ventana Electron)
npm run desktop:dev
```

## Módulos y componentes clave

- `src/App.jsx`: shell principal, barra superior centrada (`SpatialNavPill`), selector `Simple | Técnico`, `⌘K` spotlight y sincronización con barra de título nativa Electron.
- `src/components/SecurityPostureStage.jsx` + `SecurityCenterpiece3D.jsx`: cabina WebGL 3D de postura local (`Esta PC Windows`, `Celulares por USB`, `Escudo de enlaces`, `Base forense STIX 2.1`).
- `src/components/ChatWorkspace.jsx` + `OmegaShaderOrb.jsx`: asistente investigativo con orbe volumétrico WebGL (`ShaderMaterial` GLSL Simplex 3D + Fresnel para `>= 72px` y fallback circular `mix-blend-screen` para tamaños `< 72px`) y cajón lateral `CopilotDrawer.jsx`.
- `src/components/ChatAtmosphere.jsx`: fondo atmosférico obsidiana con control `showWaves` para mantener despejado el Hero de `Preguntar`.
- `electron/main.js` + `preload.cjs`: puente IPC de solo lectura para telemetría de PC Windows/macOS, diagnóstico ADB portable e inspección iOS.
