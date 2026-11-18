![OMEGA — Visualización de Marca](../../img/banner.png)

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

## Arranque automático del escritorio

El `.exe` comprueba Docker Desktop, el motor Linux y Compose antes de iniciar
servicios. `electron/dockerPreflight.js` reconoce contenedores por proyecto,
servicio y etiquetas de OMEGA; para instalaciones antiguas comprueba también
la imagen. Valida las redes y el volumen antes de ejecutar Compose.

Una instalación sana se reutiliza. Los componentes detenidos se reanudan y las
actualizaciones se detectan por versión y huella de release. El nombre del proyecto,
el volumen y el puerto elegido se conservan entre aperturas y recargas del motor IA.
Si el puerto del backend está ocupado por otra aplicación, se elige otro puerto
local y Electron comunica ese puerto al cliente automáticamente.

Las credenciales de una base existente se recuperan en memoria y, cuando está
encendida, se verifican con una consulta de solo lectura. Las claves persistidas
siguen protegidas por el almacén seguro. Una configuración ambigua o credenciales
irrecuperables detienen el arranque y conservan los datos; no provocan un borrado.

El cierre solo detiene los servicios que esa sesión de escritorio inició. Se
eliminaron las recuperaciones que hacían `docker rm -f` o `compose down -v` y la
eliminación automática de huérfanos. Contenedores ajenos y servicios ya activos
no se detienen como consecuencia de cerrar OMEGA.

Validación de este cambio: 74 pruebas Node/React/Electron, build Vite y comprobación
de solo lectura contra Docker Desktop. Una base efímera confirmó que la prueba por
red rechaza una contraseña incorrecta y recupera la configuración original. No se
reinició ni sustituyó la instalación existente de la estación de desarrollo.

## Módulos y componentes clave

- `src/App.jsx`: shell principal, barra superior centrada (`SpatialNavPill`), selector `Simple | Técnico`, `⌘K` spotlight y sincronización con barra de título nativa Electron.
- `src/components/SecurityPostureStage.jsx` + `SecurityCenterpiece3D.jsx`: cabina WebGL 3D de postura local (`Esta PC Windows`, `Celulares por USB`, `Escudo de enlaces`, `Base forense STIX 2.1`).
- `src/components/ChatWorkspace.jsx` + `OmegaShaderOrb.jsx`: asistente investigativo con orbe volumétrico WebGL (`ShaderMaterial` GLSL Simplex 3D + Fresnel para `>= 72px` y fallback circular `mix-blend-screen` para tamaños `< 72px`) y cajón lateral `CopilotDrawer.jsx`.
- `src/components/ChatAtmosphere.jsx`: fondo atmosférico obsidiana con control `showWaves` para mantener despejado el Hero de `Preguntar`.
- `electron/main.js` + `preload.cjs`: puente IPC de solo lectura para telemetría de PC Windows/macOS, diagnóstico ADB portable e inspección iOS.
